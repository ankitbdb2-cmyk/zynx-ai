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
const { getLaunchMode } = require('../services/launch-mode');
const { buildSystemPrompt } = require('../services/system-prompt');
const { updateLastReply } = require('../services/silence-decoder');

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

    // NIM: inject language signal into lead profile before scoring
    session.leadProfile.detectedLanguage = session.detectedLanguage || null;
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

        // NIM: write detected nationality to DB for PVIL Step 4 + NIM logging
        if (session.detectedLanguage && session.detectedLanguage.code !== 'en') {
            const nationalityMap = {
                'zh': 'Chinese', 'zh-cn': 'Chinese', 'zh-tw': 'Chinese', 'zh-hk': 'Chinese',
                'ru': 'Russian', 'uk': 'Russian/CIS', 'kk': 'Russian/CIS', 'uz': 'Russian/CIS',
                'hi': 'Indian', 'ur': 'Pakistani', 'bn': 'Indian',
                'ta': 'Indian', 'te': 'Indian', 'gu': 'Indian', 'pa': 'Indian',
                'ar': 'Arabic/Gulf', 'fa': 'Arabic/Gulf',
                'fr': 'French', 'de': 'German', 'zh-hans': 'Chinese'
            };
            const detectedNationality = nationalityMap[session.detectedLanguage.code] ||
                                         session.detectedLanguage.name;
            db.prepare(`UPDATE leads SET nationality = ? WHERE phone = ?`)
              .run(detectedNationality, leadPayload.phone);
        }
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
// NOTE: Now delegated to services/system-prompt.js

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

    const activeLaunch = getLaunchMode(db);
    const rentals = db.prepare(`SELECT * FROM properties WHERE type = 'Rent' AND (availability = 'Available' OR availability = 'Available now')`).all();
    const sales = db.prepare(`SELECT * FROM properties WHERE type = 'Sale' AND (availability = 'Available' OR availability = 'Available now')`).all();
    const systemPrompt = buildSystemPrompt(agencyName, {
        messages: session.messages,
        languageCode: session.detectedLanguage.code,
        languageName: session.detectedLanguage.name,
        leadProfile: session.leadProfile,
        properties: { rentals, sales },
        activeLaunch
    });

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

        if (existingLead) {
            updateLastReply(db, existingLead.id);
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
