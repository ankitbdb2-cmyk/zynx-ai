const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { db } = require('../database');
const { transcribeVoiceNote } = require('../services/transcriber');
const { detectLanguage, translateToEnglish } = require('../services/language');
const { assessLead } = require('../services/scorer');
const { sendReply, sendHotAlert } = require('../services/whatsapp');
const logger = require('../services/logger');
const { cancelPVIL } = require('../services/post-viewing');
const { getDefaultAgency } = require('../services/agencies');
const { getLaunchMode } = require('../services/launch-mode');
const { buildSystemPrompt } = require('../services/system-prompt');
const { updateLastReply } = require('../services/silence-decoder');

// WhatsApp providers (Twilio, etc.) send form-urlencoded webhooks
router.use(express.urlencoded({ extended: false }));
router.use(express.json());

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// Meta Cloud API webhook verification + media fetch
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'propmind-verify';
const META_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v22.0';
const META_API_BASE = process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com';

async function fetchMetaMediaUrl(mediaId) {
    if (!mediaId || !process.env.WHATSAPP_TOKEN) return null;
    try {
        const r = await fetch(`${META_API_BASE}/${META_API_VERSION}/${mediaId}`, {
            headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
        });
        const d = await r.json().catch(() => ({}));
        return d.url ? { url: d.url, mimeType: d.mime_type } : null;
    } catch (e) {
        return null;
    }
}

// Normalize both Meta Cloud API and Twilio webhook payloads into one shape.
async function normalizeInbound(body) {
    if (!body) return null;

    // ── Meta WhatsApp Cloud API ──
    if (body.object === 'whatsapp_business_account') {
        const change = body.entry && body.entry[0] && body.entry[0].changes && body.entry[0].changes[0];
        const value = change && change.value;
        if (!value) return null;
        if (value.statuses) return null; // delivery/read receipt — acknowledge only
        const msg = value.messages && value.messages[0];
        if (!msg) return null;
        if (msg.type === 'reaction' || msg.type === 'button') return null;

        const from = msg.from;
        let userText = '';
        let isVoice = false;
        let mediaUrl = null;
        let mediaContentType = null;

        if (msg.type === 'text') {
            userText = (msg.text && msg.text.body || '').trim();
        } else if (msg.type === 'audio') {
            isVoice = true;
            const m = await fetchMetaMediaUrl(msg.audio && msg.audio.id);
            if (m) { mediaUrl = m.url; mediaContentType = m.mimeType; }
        } else if (msg.type === 'image' || msg.type === 'video' || msg.type === 'document') {
            userText = 'The user sent an image or video. Ask if they can describe what they want in text.';
        }

        return { from, userText, isVoice, mediaUrl, mediaContentType, provider: 'meta' };
    }

    // ── Twilio ──
    const From = body.From || body.from || 'unknown';
    const NumMedia = parseInt(body.NumMedia || '0', 10);
    let userText = '';
    let isVoice = false;
    let mediaUrl = null;
    let mediaContentType = null;

    if (NumMedia > 0 && body.MediaUrl0) {
        if (body.MediaContentType0 && body.MediaContentType0.startsWith('audio/')) {
            isVoice = true;
            mediaUrl = body.MediaUrl0;
            mediaContentType = body.MediaContentType0;
        } else {
            userText = 'The user sent an image or video. Ask if they can describe what they want in text.';
        }
    } else {
        userText = (body.Body || body.body || '').trim();
    }

    return { from: From, userText, isVoice, mediaUrl, mediaContentType, provider: 'twilio' };
}

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
    const scoring = await assessLead(session.messages, session.leadProfile);

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
        await db.prepare(`
            INSERT INTO leads (name, phone, budget, timeline, hot_score, lead_stage, signals, recommended_action, area, bedrooms, visit_time, psychology_notes, agency_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            leadPayload.name, leadPayload.phone, leadPayload.budget, leadPayload.timeline,
            leadPayload.hot_score, leadPayload.lead_stage,
            Array.isArray(scoring.signals) ? scoring.signals.join(', ') : '',
            scoring.recommended_action,
            leadPayload.area, leadPayload.bedrooms, '', leadPayload.psychology_notes,
            (await getDefaultAgency(db) || {}).id
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
            await db.prepare(`UPDATE leads SET nationality = ? WHERE phone = ?`)
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
            hot_score: scoring.hot_score,
            lead_stage: scoring.lead_stage,
            timestamp: new Date().toISOString()
        };
        // Route the alert to the agency's own contact (WhatsApp or email).
        const agency = await getDefaultAgency(db);
        const alertDest = (agency && (agency.contact || agency.whatsapp))
            || process.env.AGENT_WHATSAPP_NUMBER || '';
        let alertResult;
        if (alertDest && /@/.test(alertDest)) {
            const { notifyLeadCaptured } = require('../services/notifications');
            alertResult = await notifyLeadCaptured(agency, { ...hotInfo, source: 'WhatsApp inbound' });
        } else {
            alertResult = await sendHotAlert(alertDest, hotInfo);
        }
        logger.logEvent('scorer', { action: 'hot_alert_sent', from, to: alertDest, result: alertResult });
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

    const agencyRow = await db.prepare(`SELECT value FROM settings WHERE key = 'agency_name'`).get();
    const agencyName = process.env.AGENCY_NAME || (agencyRow ? agencyRow.value : 'PropMind Real Estate');

    const activeLaunch = await getLaunchMode(db);
    const rentals = await db.prepare(`SELECT * FROM properties WHERE type = 'Rent' AND (availability = 'Available' OR availability = 'Available now')`).all();
    const sales = await db.prepare(`SELECT * FROM properties WHERE type = 'Sale' AND (availability = 'Available' OR availability = 'Available now')`).all();
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

// ─── WhatsApp webhook: Meta subscription verification ──────────────────────
router.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
        logger.logEvent('whatsapp', { action: 'webhook_verified', provider: 'meta' });
        return res.status(200).send(challenge);
    }
    logger.logEvent('whatsapp', { action: 'webhook_verify_failed', mode, token: token ? '[provided]' : undefined });
    return res.sendStatus(403);
});

// ─── WhatsApp webhook: incoming message (Meta Cloud API + Twilio) ──────────
router.post('/webhook', async (req, res) => {
    try {
        const isMeta = !!(req.body && req.body.object === 'whatsapp_business_account');
        const inbound = await normalizeInbound(req.body);

        // Acknowledge immediately — Meta/Twilio retry on non-200 and that would
        // duplicate processing. Replies are sent via the API, not the webhook.
        if (isMeta) res.sendStatus(200);
        else res.json({ received: true });

        if (!inbound || !inbound.userText) return; // status updates / empty

        const { from, userText, isVoice, mediaUrl, mediaContentType, provider } = inbound;
        let transcriptionCost = 0;
        logger.logEvent('whatsapp', { action: 'webhook_received', from, provider, hasMedia: !!mediaUrl });

        // PVIL auto-cancel: if lead replies during active sequence, stop it
        const existingLead = await db.prepare('SELECT * FROM leads WHERE phone = ?').get(from);
        if (existingLead && !['pending', 'engaged', 'complete'].includes(existingLead.pv_state)) {
            await cancelPVIL(db, existingLead.id);
            console.log(`[PVIL] Sequence cancelled for lead ${existingLead.id} — inbound reply received`);
        }

        if (existingLead) {
            await updateLastReply(db, existingLead.id);
        }

        if (isVoice && mediaUrl) {
            logger.logEvent('transcription', { action: 'voice_note_received', from, mediaUrl, contentType: mediaContentType });

            const transcription = await transcribeVoiceNote(mediaUrl);
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
                await sendReply(from, clarifyMsg).catch(e => logger.logEvent('whatsapp', { action: 'clarify_send_error', from, error: e.message }));
                return;
            }
        }

        const result = await processMessage(from, userText, isVoice, transcriptionCost);

        // If sender provided their number, use it
        if (from && from !== 'unknown' && !getSession(from).leadProfile.phone) {
            getSession(from).leadProfile.phone = from;
        }

        // Send the reply back to the user via WhatsApp
        const sendResult = await sendReply(from, result.reply);
        logger.logEvent('whatsapp', { action: 'reply_sent', from, result: sendResult });
    } catch (err) {
        logger.logEvent('whatsapp', { action: 'webhook_error', error: err.message });
        console.error('WhatsApp webhook error:', err.message);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to process message' });
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
