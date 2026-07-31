const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { db } = require('../database');
const nodemailer = require('nodemailer');
const { launchPVIL } = require('../services/post-viewing');
const { getLaunchMode } = require('../services/launch-mode');
const { buildSystemPrompt } = require('../services/system-prompt');
const { resolveAgency } = require('../services/agencies');
const { notifyLeadCaptured } = require('../services/notifications');

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// ─── Config endpoint — frontend fetches this to get the agency identity ───
// `?agency=<slug>` selects the agency; falls back to the default agency.
router.get('/config', (req, res) => {
    try {
        const { agency, agencyName, agencySlug } = resolveAgency(db, req.query.agency);
        res.json({ agencyName, agencySlug: agencySlug || null, agencyId: agency.id || null });
    } catch (e) {
        res.json({ agencyName: 'PropMind Real Estate', agencySlug: null, agencyId: null });
    }
});

// ─── Public properties listing — no auth required ───
// `?agency=<slug>` limits results to that agency's inventory.
router.get('/properties', (req, res) => {
    try {
        const { agencyId, agencySlug } = resolveAgency(db, req.query.agency);
        const rows = agencyId
            ? db.prepare(`SELECT * FROM properties WHERE agency_id = ? ORDER BY date DESC`).all(agencyId)
            : db.prepare(`SELECT * FROM properties ORDER BY date DESC`).all();
        res.json({ properties: rows, agency: agencySlug });
    } catch (e) {
        res.status(500).json({ error: 'Database error' });
    }
});

// ─── Public stats — no auth required (for homepage analytics section) ───
router.get('/stats', (req, res) => {
    try {
        const { agencyId } = resolveAgency(db, req.query.agency);
        const scope = agencyId ? ' AND agency_id = ?' : '';
        const scopeParams = agencyId ? [agencyId] : [];
        const totalLeads = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE date >= date('now', '-7 days')${scope}`).get(...scopeParams).count;
        const hotLeads = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE hot_score >= 7${scope}`).get(...scopeParams).count;
        const allRow = db.prepare(`SELECT COUNT(*) as count FROM leads${agencyId ? ' WHERE agency_id = ?' : ''}`).get(...scopeParams).count;
        const bookedRow = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE (status IN ('Visit Scheduled', 'Closed') OR viewing_confirmed = 1)${scope}`).get(...scopeParams).count;
        const conversionRate = allRow > 0 ? Math.round((bookedRow / allRow) * 100) : 0;
        const commissionRow = db.prepare(`SELECT value FROM settings WHERE key = 'weekly_commission'`).get();
        const commission = commissionRow ? parseFloat(commissionRow.value) || 0 : 0;
        res.json({ totalLeads, hotLeads, conversionRate, commission });
    } catch (e) {
        res.status(500).json({ error: 'Database error' });
    }
});

router.post('/chat', async (req, res) => {
    try {
        const { agency, agencyId, agencyName } = resolveAgency(db, req.query.agency);
        const { messages } = req.body; 
        
        // Fetch properties for THIS agency
        const properties = db.prepare(`
            SELECT * FROM properties
            WHERE agency_id = ? AND (availability = 'Available' OR availability = 'Available now')
        `).all(agencyId);

        const activeLaunch = getLaunchMode(db);
        const rentals = properties.filter(p => p.type === 'Rent');
        const sales = properties.filter(p => p.type === 'Sale');
        // Pre-extract lead data from current messages for the system prompt
        // (runs BEFORE DB save, so Sarah sees collected data immediately)
        const allUserText = messages.filter(m => m.role === 'user').map(m => m.content).join(' ');
        const phoneInMsg = allUserText.match(/\d{7,15}/);
        const AREA_NAMES = /^(Marina|Downtown|JBR|JVC|Jumeirah|Palm|Business Bay|Creek Harbour|Dubai Islands|Dubai Hills|Meydan|Arjan|Damac Hills|Al Jaddaf|Nad Al Sheba)$/i;
        const preName = allUserText.match(/my name(?:'s| is)?\s*([A-Za-z]+(?:\s+[A-Za-z]+)?)/i)
            || allUserText.match(/I['']m\s+([A-Za-z]+)/i)
            || (() => { const m = allUserText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/); return m && !AREA_NAMES.test(m[0]) ? m : null; })()
            || (() => { const m = allUserText.match(/\b([A-Z]{2,}(?:\s+[A-Z]{2,})+)\b/); return m && !AREA_NAMES.test(m[0]) ? m : null; })();
        const preBudget = (allUserText.match(/\b\d[\d.,]*\s*[MKmk]\b/i)
            || allUserText.match(/(\d[\d.,]*(?:\s*[MKmk])?)\s*(?:million|k|m)?\s*(?:aed|dirhams?)?/i));
        const preBudgetClean = preBudget && !/\b\d{7,}\b/.test(preBudget[0]) ? preBudget[0].trim() : null;
        const preArea = allUserText.match(/\b(Marina|Downtown|JBR|JVC|Jumeirah|Palm|Business Bay|Creek Harbour|Dubai Islands|Dubai Hills|Meydan|Arjan|Damac Hills|Al Jaddaf|Nad Al Sheba)\b/i);
        const prePurpose = allUserText.match(/\b(investment|investor|investing|own use|primary|personal|move in|rental income|yield|ROI)\b/i);
        const preTimeline = allUserText.match(/(\d+)\s*(?:month|week|day)/i) || allUserText.match(/\b(urgent|asap|soon|immediately|next month|right away|move in)\b/i);
        const preCash = allUserText.match(/\b(cash|full payment|no mortgage|outright)\b/i);
        // Build live profile from messages
        const liveProfile = {
            name: preName ? (preName[1] || preName[0]).trim() : null,
            phone: phoneInMsg ? phoneInMsg[0] : null,
            budget: preBudgetClean,
            area: preArea ? preArea[0].trim() : null,
            purpose: prePurpose ? prePurpose[1].toLowerCase() : null,
            timeline: preTimeline ? preTimeline[0].trim() : null,
            hot_score: Math.min(2 + (preCash ? 3 : 0) + (prePurpose ? 1 : 0) + (preBudget ? 1 : 0) + (preArea ? 1 : 0), 10)
        };
        // Try DB lookup first (for prior turns data), fall back to live extraction
        // Scope lookups to the current agency so agencies never share leads.
        let leadProfile = null;
        if (phoneInMsg) {
            leadProfile = db.prepare('SELECT * FROM leads WHERE phone = ? AND agency_id = ?').get(phoneInMsg[0], agencyId);
        }
        if (!leadProfile && preName) {
            const rawName = (preName[1] || preName[0]).trim();
            leadProfile = db.prepare("SELECT * FROM leads WHERE phone IS NULL AND name = ? AND agency_id = ? ORDER BY id DESC LIMIT 1").get(rawName, agencyId);
        }
        // Merge DB profile (persisted data) with live-extracted data (current turn)
        const mergedProfile = { ...leadProfile, ...liveProfile };

        const systemPrompt = buildSystemPrompt(agencyName, {
            messages,
            leadProfile: mergedProfile,
            properties: { rentals, sales },
            activeLaunch
        });

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 500,
            temperature: 0.7,
            system: systemPrompt,
            messages: messages
        });

        const reply = cleanResponse(response.content[0].text);

        // ─── Lead detection and scoring ────────────────────────────────
        try {
            const userTexts = messages.filter(m => m.role === 'user').map(m => m.content).join(' ');

            const phoneMatch = userTexts.match(/\d{7,15}/);
            const AREA_NAMES = /^(Marina|Downtown|JBR|JVC|Jumeirah|Palm|Business Bay|Creek Harbour|Dubai Islands|Dubai Hills|Meydan|Arjan|Damac Hills|Al Jaddaf|Nad Al Sheba)$/i;
            const rawNameMatch = userTexts.match(/my name(?:'s| is)?\s*([A-Za-z]+(?:\s+[A-Za-z]+)?)/i)
                || userTexts.match(/I['']m\s+([A-Za-z]+)/i);
            const nameMatch = rawNameMatch
                || (() => {
                    const m = userTexts.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
                    return m && !AREA_NAMES.test(m[0]) ? m : null;
                })()
                || (() => {
                    const m = userTexts.match(/\b([A-Z]{2,}(?:\s+[A-Z]{2,})+)\b/);
                    return m && !AREA_NAMES.test(m[0]) ? m : null;
                })();
            let budgetMatch = userTexts.match(/\b\d[\d.,]*\s*[MKmk]\b/i)
                || userTexts.match(/(\d[\d.,]*(?:\s*[MKmk])?)\s*(?:million|k|m)?\s*(?:aed|dirhams?)?/i);
            if (budgetMatch && /\b\d{7,}\b/.test(budgetMatch[0])) budgetMatch = null;
            const areaMatch = userTexts.match(/\b(Marina|Downtown|JBR|JVC|Jumeirah|Palm|Business Bay|Creek Harbour|Dubai Islands|Dubai Hills|Meydan|Arjan|Damac Hills|Al Jaddaf|Nad Al Sheba)\b/i);
            const timelineMatch = userTexts.match(/(\d+)\s*(?:month|week|day)/i)
                || userTexts.match(/\b(urgent|asap|soon|immediately|next month|right away|move in)\b/i);
            const purposeMatch = userTexts.match(/\b(investment|investor|investing|own use|primary|personal|move in|rental income|yield|ROI)\b/i);
            const cashMatch = userTexts.match(/\b(cash|full payment|no mortgage|outright)\b/i);

            // Psychology scoring
            const psychSignals = [];
            let hotScore = 2;
            let leadStage = 'Cold';

            if (cashMatch) { psychSignals.push('CASH BUYER'); hotScore += 3; }
            if (purposeMatch?.toString().match(/investment|investor|investing|yield|ROI/i)) { psychSignals.push('INVESTOR'); hotScore += 1; }
            if (purposeMatch?.toString().match(/own use|primary|personal|move in/i)) { psychSignals.push('END USER'); hotScore += 1; }
            if (timelineMatch?.toString().match(/urgent|asap|immediately|next month|soon/i)) { psychSignals.push('URGENT'); hotScore += 3; }
            if (timelineMatch?.toString().match(/\b[1-3]\b/)) { psychSignals.push('CLOSING SOON'); hotScore += 2; }
            if (budgetMatch) { psychSignals.push('BUDGET STATED'); hotScore += 1; }
            if (areaMatch) { psychSignals.push('AREA DECIDED'); hotScore += 1; }

            hotScore = Math.min(hotScore, 10);
            if (hotScore >= 8) leadStage = 'Hot';
            else if (hotScore >= 5) leadStage = 'Warm';
            else leadStage = 'Cold';

            const psychNotes = psychSignals.join(' · ') || 'Browsing';
            const phoneVal = phoneMatch ? phoneMatch[0] : null;
            const nameVal = nameMatch ? (nameMatch[1] || nameMatch[0]).trim() : 'Unknown';
            const budgetVal = budgetMatch ? budgetMatch[0].trim() : null;
            const areaVal = areaMatch ? areaMatch[0].trim() : null;
            const timelineVal = timelineMatch ? timelineMatch[0].trim() : null;
            const purposeVal = purposeMatch ? purposeMatch[1].toLowerCase() : null;

            // Save on first user message regardless of phone
            const firstUserMsg = messages.find(m => m.role === 'user');
            if (!firstUserMsg) return;

            if (phoneVal) {
                const existing = db.prepare('SELECT id FROM leads WHERE phone = ? AND agency_id = ?').get(phoneVal, agencyId);
                let capturedLead;
                if (!existing) {
                    const info = db.prepare(`
                        INSERT INTO leads (name, phone, budget, timeline, hot_score, lead_stage, area, purpose, psychology_notes, agency_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(nameVal, phoneVal, budgetVal, timelineVal, hotScore, leadStage, areaVal, purposeVal, psychNotes, agencyId);
                    console.log('LEAD SAVED:', info.lastInsertRowid, '| Score:', hotScore, '| Stage:', leadStage, '| Psych:', psychNotes);
                    capturedLead = {
                        name: nameVal, phone: phoneVal, budget: budgetVal, area: areaVal,
                        timeline: timelineVal, hot_score: hotScore, lead_stage: leadStage,
                        source: 'Website widget', timestamp: new Date().toISOString()
                    };
                } else {
                    db.prepare(`
                        UPDATE leads SET
                            name = COALESCE(NULLIF(?, 'Unknown'), name),
                            hot_score = ?, lead_stage = ?,
                            budget = COALESCE(?, budget),
                            timeline = COALESCE(?, timeline),
                            area = COALESCE(?, area),
                            purpose = COALESCE(?, purpose),
                            psychology_notes = ?
                        WHERE id = ?
                    `).run(nameVal, hotScore, leadStage, budgetVal, timelineVal, areaVal, purposeVal, psychNotes, existing.id);
                    console.log('LEAD UPDATED:', existing.id, '| Score:', hotScore, '| Psych:', psychNotes);
                    capturedLead = {
                        name: nameVal, phone: phoneVal, budget: budgetVal, area: areaVal,
                        timeline: timelineVal, hot_score: hotScore, lead_stage: leadStage,
                        source: 'Website widget', timestamp: new Date().toISOString()
                    };
                }
                // Push the captured lead to the agency's own WhatsApp / email.
                notifyLeadCaptured(agency, capturedLead)
                    .catch(e => console.error('[LEAD NOTIFY ERROR]', e.message));
            } else {
                // No phone yet — save anonymous partial lead keyed on session
                const sessionKey = messages[0]?.content?.slice(0, 40) || 'anon';
                const existing = db.prepare("SELECT id FROM leads WHERE phone IS NULL AND name = ? AND agency_id = ?").get(nameVal === 'Unknown' ? sessionKey : nameVal, agencyId);
                if (!existing) {
                    db.prepare(`
                        INSERT INTO leads (name, budget, timeline, hot_score, lead_stage, area, purpose, psychology_notes, agency_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(nameVal === 'Unknown' ? 'Visitor' : nameVal, budgetVal, timelineVal, hotScore, leadStage, areaVal, purposeVal, psychNotes, agencyId);
                    console.log('PARTIAL LEAD SAVED | Score:', hotScore, '| Psych:', psychNotes);
                }
            }
        } catch (leadErr) {
            console.error('Lead scoring error:', leadErr.message);
        }

        res.json({ reply });
    } catch (error) {
        console.error('Error in ghost chat:', error.message, error.stack?.slice(0, 500));
        res.status(500).json({ error: 'Failed to process chat', detail: error.message });
    }
});

router.post('/save-lead', (req, res) => {
    const { name, phone, budget, timeline, hot_score, lead_stage, signals, recommended_action, area, bedrooms, visit_time, psychology_notes, agency_id } = req.body;
    const updateId = req.query.update;
    const { agency, agencyId } = resolveAgency(db, req.query.agency || req.body.agency);

    try {
        let leadId;

        if (updateId) {
            // Update existing lead with richer data
            db.prepare(`
                UPDATE leads SET 
                    name = ?, phone = ?, budget = ?, timeline = ?,
                    hot_score = ?, lead_stage = ?, signals = ?, recommended_action = ?,
                    area = ?, bedrooms = ?, visit_time = ?, psychology_notes = ?,
                    agency_id = COALESCE(agency_id, ?)
                WHERE id = ?
            `).run(name, phone, budget, timeline, hot_score || 0, lead_stage || 'Cold',
                   Array.isArray(signals) ? signals.join(', ') : (signals || ''),
                   recommended_action, area, bedrooms, visit_time, psychology_notes,
                   agency_id || agencyId, updateId);
            leadId = Number(updateId);
            console.log('Lead updated successfully:', leadId);
        } else {
            // Insert new lead, owned by the resolved agency
            const info = db.prepare(`
                INSERT INTO leads (name, phone, budget, timeline, hot_score, lead_stage, signals, recommended_action, area, bedrooms, visit_time, psychology_notes, agency_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(name, phone, budget, timeline, hot_score || 0, lead_stage || 'Cold',
                   Array.isArray(signals) ? signals.join(', ') : (signals || ''),
                   recommended_action, area, bedrooms, visit_time, psychology_notes,
                   agency_id || agencyId);
            leadId = info.lastInsertRowid;
            console.log('Lead saved successfully:', leadId, '| Hot score:', hot_score, '| Stage:', lead_stage, '| Agency:', agency_id || agencyId);
        }

        // Per-agency notification: WhatsApp to the agency contact (or email).
        notifyLeadCaptured(agency, {
            name, phone, budget, area, timeline, bedrooms,
            hot_score: hot_score || 0, lead_stage: lead_stage || 'Cold',
            signals: Array.isArray(signals) ? signals.join(', ') : signals,
            source: 'Website widget', timestamp: new Date().toISOString()
        }).catch(e => console.error('[LEAD NOTIFY ERROR]', e.message));

        res.json({ success: true, leadId: leadId });
    } catch (err) {
        console.error('Failed to save lead:', err);
        return res.status(500).json({ error: 'Database error' });
    }
});

function formatSlot(dt, label) {
    const d = new Date(dt);
    const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true });
    return label ? `${label} — ${day} at ${time}` : `${day} at ${time}`;
}

function sendAgentNotification(subject, text) {
    if (!process.env.AGENT_EMAIL || !process.env.EMAIL_PASSWORD) {
        console.log(`[MOCK NOTIFY] ${subject}\n${text}`);
        return;
    }
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.AGENT_EMAIL, pass: process.env.EMAIL_PASSWORD }
    });
    transporter.sendMail({
        from: process.env.AGENT_EMAIL,
        to: process.env.AGENT_EMAIL,
        subject,
        text
    }, (err) => { if (err) console.error('Notify failed:', err.message); });
}

// ─── Auto Viewing Scheduler (score 8+) ──────────────────────────────────────
router.post('/viewing-offer', (req, res) => {
    const { leadId } = req.body;
    if (!leadId) return res.status(400).json({ error: 'leadId required' });

    try {
        const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(leadId);
        if (!lead) return res.status(404).json({ error: 'Lead not found' });
        if ((lead.hot_score || 0) < 8) {
            return res.json({ skipped: true, reason: 'Score below threshold' });
        }
        if (lead.viewing_offer_sent) {
            const existing = db.prepare(`
                SELECT * FROM viewing_offers WHERE lead_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1
            `).get(leadId);
            if (existing) {
                const slotIds = JSON.parse(existing.slot_ids);
                const slots = slotIds.map(id =>
                    db.prepare(`SELECT * FROM availability_slots WHERE id = ?`).get(id)
                ).filter(Boolean);
                return res.json({
                    offerId: existing.id,
                    slots,
                    offerMessage: buildOfferMessage(lead.name, slots)
                });
            }
        }

        const slots = db.prepare(`
            SELECT * FROM availability_slots
            WHERE is_booked = 0 AND slot_datetime > datetime('now')
            ORDER BY slot_datetime ASC LIMIT 3
        `).all();

        if (slots.length === 0) {
            return res.json({
                skipped: true,
                reason: 'no_slots',
                offerMessage: null
            });
        }

        const slotIds = slots.map(s => s.id);
        const offerInfo = db.prepare(`
            INSERT INTO viewing_offers (lead_id, slot_ids, status) VALUES (?, ?, 'pending')
        `).run(leadId, JSON.stringify(slotIds));

        db.prepare(`UPDATE leads SET viewing_offer_sent = 1 WHERE id = ?`).run(leadId);

        const offerMessage = buildOfferMessage(lead.name, slots);
        res.json({ offerId: offerInfo.lastInsertRowid, slots, offerMessage });
    } catch (err) {
        console.error('Viewing offer error:', err);
        res.status(500).json({ error: 'Failed to create viewing offer' });
    }
});

function buildOfferMessage(name, slots) {
    const firstName = (name && name !== 'Unknown') ? name.split(' ')[0] : 'there';
    let msg = `Great news ${firstName}! 🏠 I'd love to show you the property in person. Pick a viewing time that works for you:\n\n`;
    slots.forEach((s, i) => {
        msg += `**${i + 1}.** ${formatSlot(s.slot_datetime, s.label)}\n`;
    });
    msg += `\nJust reply with **1**, **2**, or **3** to confirm your slot.`;
    return msg;
}

router.post('/confirm-viewing', (req, res) => {
    const { leadId, choice, offerId } = req.body;
    if (!leadId || !choice) return res.status(400).json({ error: 'leadId and choice required' });

    try {
        const offer = offerId
            ? db.prepare(`SELECT * FROM viewing_offers WHERE id = ? AND lead_id = ?`).get(offerId, leadId)
            : db.prepare(`SELECT * FROM viewing_offers WHERE lead_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`).get(leadId);

        if (!offer || offer.status !== 'pending') {
            return res.status(400).json({ error: 'No pending viewing offer' });
        }

        const slotIds = JSON.parse(offer.slot_ids);
        const idx = parseInt(choice, 10) - 1;
        if (idx < 0 || idx >= slotIds.length) {
            return res.status(400).json({ error: 'Invalid choice' });
        }

        const slotId = slotIds[idx];
        const slot = db.prepare(`SELECT * FROM availability_slots WHERE id = ? AND is_booked = 0`).get(slotId);
        if (!slot) return res.status(400).json({ error: 'Slot no longer available' });

        const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(leadId);
        const slotLabel = formatSlot(slot.slot_datetime, slot.label);

        db.prepare(`UPDATE availability_slots SET is_booked = 1, lead_id = ? WHERE id = ?`).run(leadId, slotId);
        db.prepare(`UPDATE viewing_offers SET status = 'confirmed', selected_slot_id = ? WHERE id = ?`).run(slotId, offer.id);
        db.prepare(`
            UPDATE leads SET viewing_confirmed = 1, viewing_slot_id = ?, status = 'Visit Scheduled'
            WHERE id = ?
        `).run(slotId, leadId);

        const leadConfirm = `✅ Perfect! Your viewing is confirmed for **${slotLabel}**. I'll meet you there — see you soon! 🎉`;
        const agentConfirm = `Viewing booked: ${lead.name} (${lead.phone}) — ${slotLabel}`;

        sendAgentNotification(`Viewing Confirmed: ${lead.name}`, agentConfirm);

        res.json({
            success: true,
            leadMessage: leadConfirm,
            agentMessage: agentConfirm,
            slot: { id: slotId, label: slotLabel, datetime: slot.slot_datetime }
        });
    } catch (err) {
        console.error('Confirm viewing error:', err);
        res.status(500).json({ error: 'Failed to confirm viewing' });
    }
});

// ─── PVIL: Mark Viewing Complete ───────────────────────────────────────────
router.post('/complete-viewing', (req, res) => {
    const { lead_id, no_show } = req.body;

    if (!lead_id) {
        return res.status(400).json({ error: 'lead_id required' });
    }

    try {
        const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(lead_id);

        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        if (no_show) {
            db.prepare(`UPDATE leads SET no_show = 1, status = 'No Show' WHERE id = ?`).run(lead_id);

            if (process.env.AGENT_EMAIL && process.env.EMAIL_PASSWORD) {
                const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: {
                        user: process.env.AGENT_EMAIL,
                        pass: process.env.EMAIL_PASSWORD
                    }
                });
                transporter.sendMail({
                    from: `"PVIL System" <${process.env.AGENT_EMAIL}>`,
                    to: process.env.AGENT_EMAIL,
                    subject: `No Show: ${lead.name}`,
                    text:
`Lead: ${lead.name}
Phone: ${lead.phone || 'not recorded'}
Score: ${lead.hot_score} | Stage: ${lead.lead_stage}

${lead.name} did not attend their scheduled viewing.

NEXT STEP:
Wait 24 hours. Then reach out with a low-pressure reschedule offer:
"No problem at all — happy to arrange another time when it suits you better."

Do not express frustration. Do not drop the lead yet.
No Show leads re-engage at ~25% with a single patient follow-up.

PVIL sequence was NOT launched for this lead.`
                }, (err) => { if (err) console.error('[PVIL email fail]', err); });
            }

            return res.json({ success: true, pvil_launched: false, status: 'No Show' });
        }

        db.prepare(`UPDATE leads SET completed_at = datetime('now'), status = 'Viewing Completed' WHERE id = ?`).run(lead_id);

        const { alreadyLaunched } = launchPVIL(db, lead_id);

        if (process.env.AGENT_EMAIL && process.env.EMAIL_PASSWORD) {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.AGENT_EMAIL,
                    pass: process.env.EMAIL_PASSWORD
                }
            });
            transporter.sendMail({
                from: `"PVIL System" <${process.env.AGENT_EMAIL}>`,
                to: process.env.AGENT_EMAIL,
                subject: `Viewing Complete: ${lead.name} — PVIL Active`,
                text:
`Lead: ${lead.name}
Phone: ${lead.phone || 'not recorded'}
Score: ${lead.hot_score} | Stage: ${lead.lead_stage}
Budget: ${lead.budget || 'not recorded'}
Nationality: ${lead.nationality || 'not recorded'}

Viewing marked complete. PVIL sequence is now running.

WHAT HAPPENS NEXT (automated — no action needed from you):
  T+2h  → Re-engagement WhatsApp sent to lead
  T+24h → Competitive positioning script sent to you
  T+48h → Golden Visa or value script sent to you
  T+72h → Nationality-calibrated closing script sent to you

Each step fires only if the lead has not responded.
If they reply at any point — the sequence stops automatically.

${alreadyLaunched ? '⚠️  NOTE: PVIL was already running for this lead. Sequence continues from current position.' : '✅ PVIL sequence started fresh.'}

Your only job right now: do nothing. Let Step 1 land first.`
            }, (err) => { if (err) console.error('[PVIL email fail]', err); });
        }

        return res.json({ success: true, pvil_launched: !alreadyLaunched, status: 'Viewing Completed' });

    } catch (err) {
        console.error('[PVIL /complete-viewing error]', err);
        return res.status(500).json({ error: 'Failed to process viewing completion' });
    }
});

// ─── Cleanup: strip any JSON/data blocks from Claude before sending to user ──
function cleanResponse(text) {
    return text
        .replace(/\[LEAD_DATA\][^\n]*\n?/gi, '')
        .replace(/```json[\s\S]*?```/g, '')
        .replace(/```[\s\S]*?```/g, '')
        .trim();
}

module.exports = router;
