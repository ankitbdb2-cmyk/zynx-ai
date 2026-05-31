const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../database');
const { transcribeVoiceNote } = require('../services/transcriber');
const { detectLanguage, translateToEnglish } = require('../services/language');
const { assessLead } = require('../services/scorer');
const { sendReply, sendHotAlert } = require('../services/whatsapp');
const logger = require('../services/logger');
const { cancelPVIL } = require('../services/post-viewing');

// WhatsApp providers (Twilio, etc.) send form-urlencoded webhooks
router.use(express.urlencoded({ extended: false }));
router.use(express.json());

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// ─── In-memory conversation state for WhatsApp sessions ───────────────────
const sessions = new Map();

function getSession(from) {
    if (!sessions.has(from)) {
        sessions.set(from, {
            messages: [],
            leadProfile: { name: '', phone: '', budget: '', area: '', bedrooms: '', timeline: '' },
            detectedLanguage: { code: 'en', name: 'English' },
            lastActivity: Date.now(),
            transcriptionCost: 0,
            conversationSaved: false
        });
    }
    return sessions.get(from);
}

// ─── Inactivity timeout check (runs every 60s) ────────────────────────────
setInterval(() => {
    const now = Date.now();
    const TIMEOUT_MS = 10 * 60 * 1000;
    for (const [from, session] of sessions.entries()) {
        if (now - session.lastActivity > TIMEOUT_MS && !session.conversationSaved) {
            finalizeAndScore(from, session).catch(e => {
                logger.logEvent('whatsapp', { action: 'finalize_error', from, error: e.message });
            });
        }
    }
}, 60000);

async function finalizeAndScore(from, session) {
    if (session.conversationSaved || session.messages.length < 2) return;
    session.conversationSaved = true;

    const lang = session.detectedLanguage;
    let translatedName = session.leadProfile.name;

    if (lang.code !== 'en' && session.leadProfile.name) {
        translatedName = await translateToEnglish(session.leadProfile.name);
    }

    const scoring = assessLead(session.messages, session.leadProfile);

    const leadPayload = {
        name: translatedName || session.leadProfile.name || 'Unknown',
        phone: session.leadProfile.phone || from,
        budget: session.leadProfile.budget || '',
        timeline: session.leadProfile.timeline || '',
        hot_score: scoring.hot_score,
        lead_stage: scoring.lead_stage,
        signals: scoring.signals,
        recommended_action: scoring.recommended_action,
        area: session.leadProfile.area || '',
        bedrooms: session.leadProfile.bedrooms || '',
        visit_time: '',
        psychology_notes: `Language: ${lang.name} (${lang.code}). Transcription cost: $${session.transcriptionCost.toFixed(4)}`
    };

    try {
        db.prepare(`
            INSERT INTO leads (name, phone, budget, timeline, hot_score, lead_stage, signals, recommended_action, area, bedrooms, visit_time, psychology_notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            leadPayload.name, leadPayload.phone, leadPayload.budget, leadPayload.timeline,
            leadPayload.hot_score, leadPayload.lead_stage,
            Array.isArray(scoring.signals) ? scoring.signals.join(', ') : '',
            scoring.recommended_action,
            leadPayload.area, leadPayload.bedrooms, '', leadPayload.psychology_notes
        );
        logger.logEvent('scorer', { action: 'lead_saved', from, name: leadPayload.name, score: scoring.hot_score });
    } catch (err) {
        logger.logEvent('scorer', { action: 'save_error', from, error: err.message });
    }

    if (scoring.is_hot) {
        const hotInfo = {
            name: leadPayload.name,
            budget: leadPayload.budget || 'Unknown',
            interest: scoring.signals.join(', ') || 'Property inquiry',
            phone: leadPayload.phone || from,
            timestamp: new Date().toISOString()
        };
        const alertResult = await sendHotAlert(hotInfo);
        logger.logEvent('scorer', { action: 'hot_alert_sent', from, result: alertResult });
    }
}

// ─── Build the Sarah system prompt (same pattern as ghost.js) ────────────
function buildSystemPrompt(agencyName, languageCode, languageName) {
    const rentals = db.prepare(`SELECT * FROM properties WHERE type = 'Rent' AND (availability = 'Available' OR availability = 'Available now')`).all();
    const sales = db.prepare(`SELECT * FROM properties WHERE type = 'Sale' AND (availability = 'Available' OR availability = 'Available now')`).all();

    const rentalsStr = rentals.map(p => `- ${p.title} | ${p.area} | ${p.price} | ${p.description} | ${p.availability}`).join('\n') || 'Currently no rentals available.';
    const salesStr = sales.map(p => `- ${p.title} | ${p.area} | ${p.price} | ${p.description} | ${p.availability}`).join('\n') || 'Currently no properties for sale available.';

    const langInstruction = languageCode !== 'en'
        ? `IMPORTANT — The lead speaks ${languageName} (${languageCode}). Respond in ${languageName} ONLY. Never switch to English. Match their language exactly.`
        : '';

    return `You are Sarah, a world-class real estate agent representing ${agencyName}. You are not a chatbot or AI — you are a human agent. Never reveal you are AI under any circumstances.

${langInstruction}

IF ANYONE ASKS IF YOU ARE A ROBOT OR AI: Say "Haha no, I'm just a fast typer 😄 So tell me — what kind of place are you looking for?"

STRICT FORMAT RULES — NON-NEGOTIABLE:
1. Maximum 3 sentences per response.
2. One emoji maximum per response.
3. Always end with exactly one question.
4. Never use bullet points.
5. Respond in whatever language the lead uses.
6. Match the lead's energy exactly.

CORE BEHAVIORS:
1. BUDGET INTELLIGENCE — When a lead states a budget, recommend the listing closest to that budget first. Never recommend a listing below 50% of their stated budget unless nothing else exists.
2. EMOTIONAL CONNECTION — Briefly and naturally tap into what the lead emotionally wants, not just what they asked for.
3. CONFIDENCE WITHOUT PRESSURE — Speak with confidence, never desperation. Use mild natural urgency only — never forced.
4. SINGLE FOCUSED RECOMMENDATION — Recommend one property maximum per message. Never overwhelm.
5. NAME USAGE — Use the lead's name naturally once every 2-3 messages. Never robotically.
6. VIEWING MOMENTUM — Every question you ask must move toward booking a viewing.
7. OBJECTION HANDLING — Never accept a no. When objection arises, acknowledge briefly and find the next question. Always move forward.

HANDLE MISMATCHES — when a lead asks for something not exactly in the listings:
    STEP 1 — Acknowledge briefly: "I hear you, a 3BR villa is a great choice..."
    STEP 2 — Pivot to the closest available match and frame it as better value or a smart alternative.
    STEP 3 — If no close match exists at all, ask one question to uncover their flexibility: budget, area, or timeline.
    NEVER say "I don't have that" and stop. NEVER hit a dead end. ALWAYS keep the conversation moving forward.

--- YOUR QUALIFICATION GOAL ---
Naturally collect these 6 things during the conversation — never ask them all at once:
1. Name
2. Phone number
3. Budget (yearly rent OR purchase price)
4. Preferred area in Dubai
5. Number of bedrooms
6. Timeline — when do they need it

--- PROPERTY LISTINGS ---
Only recommend from this list, matched to their needs and budget:

RENTALS:
${rentalsStr}

FOR SALE:
${salesStr}

--- LEAD DATA BLOCK ---
AT THE END OF EVERY SINGLE RESPONSE — no exceptions — append this block exactly as shown. The block must be on its own line and must be valid JSON:

[LEAD_DATA]
{
  "hot_score": 0,
  "lead_stage": "Cold",
  "signals": [],
  "recommended_action": "",
  "collected": {
    "name": "",
    "phone": "",
    "budget": "",
    "area": "",
    "bedrooms": "",
    "timeline": ""
  }
}

Fill it accurately based on the full conversation so far:

hot_score: 1–10
- 8–10 = urgent, ready buyer, specific needs, asking about viewing
- 5–7 = interested but still exploring
- 1–4 = early browsing, vague questions

lead_stage: Cold / Warm / Hot

signals — list any that apply:
- "High urgency — needs property soon"
- "Budget flexibility detected"
- "Ready to book viewing"
- "Price sensitive"
- "Luxury buyer"
- "Investment buyer"
- "Family / end user buyer"
- "Comparing multiple agencies"
- "Decision maker confirmed"
- "Arabic speaker — high engagement"
- "Specific requirements — serious buyer"
- "Multiple property interest"

recommended_action: one specific sentence telling the agent what to do next.

collected: fill in what has been shared so far. Leave as empty string if not yet known.`;
}

function parseLeadData(reply) {
    try {
        const marker = '[LEAD_DATA]';
        const idx = reply.lastIndexOf(marker);
        if (idx === -1) return null;

        const jsonStr = reply.slice(idx + marker.length).trim();
        const start = jsonStr.indexOf('{');
        const end = jsonStr.lastIndexOf('}');
        if (start === -1 || end === -1) return null;

        return JSON.parse(jsonStr.slice(start, end + 1));
    } catch (e) {
        return null;
    }
}

function cleanReply(reply) {
    return reply.replace(/\[LEAD_DATA\][\s\S]*$/, '').trim();
}

async function processMessage(from, userText, isVoice = false, transcriptionCost = 0) {
    const session = getSession(from);
    session.lastActivity = Date.now();
    session.transcriptionCost += transcriptionCost;

    const userMessage = { role: 'user', content: userText };
    session.messages.push(userMessage);

    // Language detection on first user message
    if (session.messages.filter(m => m.role === 'user').length <= 2) {
        const lang = await detectLanguage(userText);
        session.detectedLanguage = lang;
        logger.logEvent('language', {
            action: 'session_language_set',
            from,
            language: lang.code,
            name: lang.name
        });
    }

    const agencyRow = db.prepare(`SELECT value FROM settings WHERE key = 'agency_name'`).get();
    const agencyName = agencyRow ? agencyRow.value : (process.env.AGENCY_NAME || 'Sandcastle Properties');

    const systemPrompt = buildSystemPrompt(
        agencyName,
        session.detectedLanguage.code,
        session.detectedLanguage.name
    );

    const claudeMessages = session.messages.map(m => ({
        role: m.role,
        content: m.content
    }));

    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 500,
        temperature: 0.7,
        system: systemPrompt,
        messages: claudeMessages
    });

    const rawReply = response.content[0].text;
    const leadData = parseLeadData(rawReply);
    const cleanText = cleanReply(rawReply);

    session.messages.push({ role: 'assistant', content: cleanText });

    if (leadData && leadData.collected) {
        Object.assign(session.leadProfile, leadData.collected);
        logger.logEvent('whatsapp', {
            action: 'lead_data_updated',
            from,
            profile: session.leadProfile
        });
    }

    return { reply: cleanText, leadData };
}

// ─── WhatsApp webhook: incoming message ───────────────────────────────────
router.post('/webhook', async (req, res) => {
    try {
        const { From, Body, NumMedia, MediaUrl0, MediaContentType0 } = req.body;

        const from = From || req.body.from || 'unknown';
        logger.logEvent('whatsapp', { action: 'webhook_received', from, hasMedia: NumMedia > 0 });

        // PVIL auto-cancel: if lead replies during active sequence, stop it
        const existingLead = db.prepare('SELECT * FROM leads WHERE phone = ?').get(from);
        if (existingLead && !['pending', 'engaged', 'complete'].includes(existingLead.pv_state)) {
            cancelPVIL(db, existingLead.id);
            console.log(`[PVIL] Sequence cancelled for lead ${existingLead.id} — inbound reply received`);
        }

        let userText = '';
        let isVoice = false;
        let transcriptionCost = 0;

        if (NumMedia > 0 && MediaUrl0) {
            if (MediaContentType0 && MediaContentType0.startsWith('audio/')) {
                isVoice = true;
                logger.logEvent('transcription', { action: 'voice_note_received', from, mediaUrl: MediaUrl0, contentType: MediaContentType0 });

                const transcription = await transcribeVoiceNote(MediaUrl0);
                userText = transcription.text;
                transcriptionCost = transcription.cost;
                const confidence = transcription.confidence;

                logger.logEvent('transcription', {
                    action: 'voice_note_processed',
                    from,
                    text: userText,
                    confidence,
                    cost: transcriptionCost,
                    duration: transcription.duration,
                    detectedLang: transcription.language
                });

                if (confidence < -2 || !userText || userText.length < 3) {
                    const clarifyMsg = "I received your voice note but couldn't understand it clearly. Could you please type your message or send another voice note?";
                    const session = getSession(from);
                    session.messages.push({ role: 'assistant', content: clarifyMsg });
                    // NEW: Actually send the clarifying reply back to WhatsApp before responding to the webhook
                    await sendReply(from, clarifyMsg).catch(e => logger.logEvent('whatsapp', { action: 'clarify_send_error', from, error: e.message }));
                    res.json({ reply: clarifyMsg });
                    return;
                }
            } else {
                userText = 'The user sent an image or video. Ask if they can describe what they want in text.';
            }
        } else {
            userText = (Body || req.body.body || '').trim();
        }

        if (!userText) {
            return res.status(400).json({ error: 'No message content' });
        }

        const result = await processMessage(from, userText, isVoice, transcriptionCost);

        // If sender provided their number, use it
        if (from && from !== 'unknown' && !getSession(from).leadProfile.phone) {
            getSession(from).leadProfile.phone = from;
        }

        // Send the reply back to the user via WhatsApp
        const sendResult = await sendReply(from, result.reply);

        res.json({
            reply: result.reply,
            from,
            leadData: result.leadData,
            sent: sendResult
        });
    } catch (err) {
        logger.logEvent('whatsapp', { action: 'webhook_error', error: err.message });
        console.error('WhatsApp webhook error:', err.message);
        res.status(500).json({ error: 'Failed to process message' });
    }
});

// ─── Trigger finalize/score for a conversation ────────────────────────────
router.post('/end-conversation', async (req, res) => {
    const { from } = req.body;
    if (!from) return res.status(400).json({ error: 'from required' });

    const session = sessions.get(from);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    try {
        await finalizeAndScore(from, session);
        sessions.delete(from);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Get conversation history (for debugging) ────────────────────────────
router.get('/sessions', (req, res) => {
    const summary = {};
    for (const [from, s] of sessions.entries()) {
        summary[from] = {
            messageCount: s.messages.length,
            language: s.detectedLanguage,
            leadProfile: s.leadProfile,
            lastActivity: new Date(s.lastActivity).toISOString(),
            transcriptionCost: s.transcriptionCost,
            saved: s.conversationSaved
        };
    }
    res.json({ sessions: summary, count: sessions.size });
});

module.exports = router;
