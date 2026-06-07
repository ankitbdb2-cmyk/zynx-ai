const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { db } = require('../database');
const nodemailer = require('nodemailer');
const { launchPVIL } = require('../services/post-viewing');
const { getLaunchMode } = require('../services/launch-mode');
const { buildSystemPrompt } = require('../services/system-prompt');

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// ─── Config endpoint — frontend fetches this to get the agency name ───
router.get('/config', (req, res) => {
    try {
        const row = db.prepare(`SELECT value FROM settings WHERE key = 'agency_name'`).get();
        const agencyName = row ? row.value : (process.env.AGENCY_NAME || 'Sandcastle Properties');
        res.json({ agencyName });
    } catch (e) {
        res.json({ agencyName: process.env.AGENCY_NAME || 'Sandcastle Properties' });
    }
});

// ─── Public properties listing — no auth required ───
router.get('/properties', (req, res) => {
    try {
        const rows = db.prepare(`SELECT * FROM properties ORDER BY date DESC`).all();
        res.json({ properties: rows });
    } catch (e) {
        res.status(500).json({ error: 'Database error' });
    }
});

// ─── Public stats — no auth required (for homepage analytics section) ───
router.get('/stats', (req, res) => {
    try {
        const totalLeads = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE date >= date('now', '-7 days')`).get().count;
        const hotLeads = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE hot_score >= 7`).get().count;
        const allRow = db.prepare(`SELECT COUNT(*) as count FROM leads`).get().count;
        const bookedRow = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE status IN ('Visit Scheduled', 'Closed') OR viewing_confirmed = 1`).get().count;
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
        const agencyRow = db.prepare(`SELECT value FROM settings WHERE key = 'agency_name'`).get();
        const agencyName = agencyRow ? agencyRow.value : (process.env.AGENCY_NAME || 'Sandcastle Properties');

        const { messages } = req.body; 
        
        // Fetch properties from DB
        const properties = db.prepare(`SELECT * FROM properties WHERE availability = 'Available' OR availability = 'Available now'`).all();

        const activeLaunch = getLaunchMode(db);
        const rentals = properties.filter(p => p.type === 'Rent');
        const sales = properties.filter(p => p.type === 'Sale');
        const systemPrompt = buildSystemPrompt(agencyName, {
            messages,
            properties: { rentals, sales },
            activeLaunch
        });

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 500,
            temperature: 0.7,
            system: systemPrompt,
            messages: messages
        });

        const reply = cleanResponse(response.content[0].text);
        res.json({ reply });
    } catch (error) {
        console.error('Error in ghost chat:', error.message, error.stack?.slice(0, 500));
        res.status(500).json({ error: 'Failed to process chat', detail: error.message });
    }
});

router.post('/save-lead', (req, res) => {
    const { name, phone, budget, timeline, hot_score, lead_stage, signals, recommended_action, area, bedrooms, visit_time, psychology_notes } = req.body;
    const updateId = req.query.update;

    try {
        let leadId;

        if (updateId) {
            // Update existing lead with richer data
            db.prepare(`
                UPDATE leads SET 
                    name = ?, phone = ?, budget = ?, timeline = ?,
                    hot_score = ?, lead_stage = ?, signals = ?, recommended_action = ?,
                    area = ?, bedrooms = ?, visit_time = ?, psychology_notes = ?
                WHERE id = ?
            `).run(name, phone, budget, timeline, hot_score || 0, lead_stage || 'Cold',
                   Array.isArray(signals) ? signals.join(', ') : (signals || ''),
                   recommended_action, area, bedrooms, visit_time, psychology_notes, updateId);
            leadId = Number(updateId);
            console.log('Lead updated successfully:', leadId);
        } else {
            // Insert new lead
            const info = db.prepare(`
                INSERT INTO leads (name, phone, budget, timeline, hot_score, lead_stage, signals, recommended_action, area, bedrooms, visit_time, psychology_notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(name, phone, budget, timeline, hot_score || 0, lead_stage || 'Cold',
                   Array.isArray(signals) ? signals.join(', ') : (signals || ''),
                   recommended_action, area, bedrooms, visit_time, psychology_notes);
            leadId = info.lastInsertRowid;
            console.log('Lead saved successfully:', leadId, '| Hot score:', hot_score, '| Stage:', lead_stage);
        }
        
        // Send email to agent
        if (process.env.AGENT_EMAIL && process.env.EMAIL_PASSWORD) {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.AGENT_EMAIL,
                    pass: process.env.EMAIL_PASSWORD
                }
            });

            const mailOptions = {
                from: process.env.AGENT_EMAIL,
                to: process.env.AGENT_EMAIL,
                subject: `New PropMind Lead: ${name} [Score: ${hot_score}/10]`,
                text: `New lead from GHOST.\n\nName: ${name}\nPhone: ${phone}\nBudget: ${budget}\nArea: ${area}\nBedrooms: ${bedrooms}\nTimeline: ${timeline}\nHot Score: ${hot_score}/10\nStage: ${lead_stage}\nSignals: ${Array.isArray(signals) ? signals.join(', ') : signals}\n\nRecommended Action:\n${recommended_action}\n\nPsychology Notes:\n${psychology_notes}`
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error('Failed to send email:', error);
                } else {
                    console.log('Email sent: ' + info.response);
                }
            });
        } else {
            console.log(`[MOCK EMAIL] Lead: ${name} | Score: ${hot_score} | Phone: ${phone} | Budget: ${budget}`);
        }
        
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
