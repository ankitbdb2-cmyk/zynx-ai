const logger = require('./logger');

// ─── REAL WHATSAPP SENDING — Meta WhatsApp Cloud API ────────────────────────
// Official API, no third-party markup, works worldwide. Requires (once-only,
// done by the account owner in the Meta dashboard — see scripts/test-whatsapp.js):
//   WHATSAPP_TOKEN      → permanent access token for your WhatsApp Business account
//   WHATSAPP_PHONE_ID   → ID of your business number's phone (from the Meta dashboard)
//   WHATSAPP_VERIFY_TOKEN → any string you choose, used to verify the webhook
//
// Without those env vars the service degrades to the old console-log stub so
// nothing crashes during development.

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID || '';
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'propmind-verify';
const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v22.0';
const API_BASE = process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com';

function isConfigured() {
    return !!(WHATSAPP_TOKEN && WHATSAPP_PHONE_ID);
}

// Strip to digits (optionally keep a leading +) so "whatsapp:+971..." etc. work.
function normalizeNumber(to) {
    return String(to).replace(/[^\d+]/g, '');
}

function truncate(str, max) {
    const s = String(str);
    return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

// ─── Verify token + phone id are valid (used by the smoke-test script) ─────
async function verifyCredentials() {
    if (!isConfigured()) {
        return { configured: false, error: 'WHATSAPP_TOKEN / WHATSAPP_PHONE_ID not set' };
    }
    try {
        const resp = await fetch(`${API_BASE}/${API_VERSION}/${WHATSAPP_PHONE_ID}?fields=name,display_phone_number,quality_rating`, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data.display_phone_number) {
            logger.logEvent('whatsapp', { action: 'credentials_ok', provider: 'meta', name: data.name, number: data.display_phone_number });
            return { configured: true, ok: true, name: data.name, displayPhoneNumber: data.display_phone_number, qualityRating: data.quality_rating };
        }
        const msg = (data.error && data.error.message) || `HTTP ${resp.status}`;
        logger.logEvent('whatsapp', { action: 'credentials_failed', provider: 'meta', error: msg });
        return { configured: true, ok: false, error: msg, details: data.error || data };
    } catch (err) {
        return { configured: true, ok: false, error: err.message };
    }
}

// ─── Send a free-form text message ──────────────────────────────────────────
// Works for recipients who messaged the business within the last 24h, OR (in
// dev mode) numbers registered as test recipients. Outbound-only follow-ups to
// cold numbers need an approved template — see sendTemplateMessage().
async function sendText(to, body) {
    if (!to || !body) {
        logger.logEvent('whatsapp', { action: 'send_skipped', reason: 'Missing to or body' });
        return { success: false, error: 'Missing recipient or message body' };
    }

    if (!isConfigured()) {
        logger.logEvent('whatsapp', { action: 'send_logged', to, bodyLength: body.length });
        console.log(`[WHATSAPP (STUB) → ${to}] ${String(body).slice(0, 120)}${String(body).length > 120 ? '…' : ''}`);
        console.log('[WHATSAPP] Not sent — set WHATSAPP_TOKEN + WHATSAPP_PHONE_ID to go live.');
        return { success: false, logged: true, provider: null, mode: 'stub', to };
    }

    const recipient = normalizeNumber(to);
    const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'text',
        text: { body: truncate(body, 4000) }
    };

    try {
        const resp = await fetch(`${API_BASE}/${API_VERSION}/${WHATSAPP_PHONE_ID}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const data = await resp.json().catch(() => ({}));

        if (resp.ok) {
            const waId = data.messages && data.messages[0] && data.messages[0].id;
            logger.logEvent('whatsapp', { action: 'sent', provider: 'meta', to: recipient, waId });
            console.log(`[WHATSAPP SENT → ${recipient}] waId=${waId}`);
            return { success: true, provider: 'meta', mode: 'api', to: recipient, waId };
        }

        const errMsg = (data.error && data.error.message) || `HTTP ${resp.status}`;
        console.error(`[WHATSAPP SEND FAILED → ${recipient}] ${errMsg}`);
        logger.logEvent('whatsapp', { action: 'send_error', provider: 'meta', to: recipient, status: resp.status, error: data.error || data });
        return { success: false, provider: 'meta', to: recipient, error: errMsg, details: data.error || data };
    } catch (err) {
        console.error('[WHATSAPP SEND ERROR]', err.message);
        logger.logEvent('whatsapp', { action: 'send_error', provider: 'meta', to, error: err.message });
        return { success: false, provider: 'meta', to, error: err.message };
    }
}

// ─── Send an approved template (required for outbound to COLD recipients) ───
// Meta only allows free-form messages inside a 24h session. For proactive
// follow-ups to people who never messaged you, you must send an APPROVED
// template. Params map to {{1}}, {{2}}... placeholders in the template body.
async function sendTemplateMessage(to, templateName, language = 'en', params = []) {
    if (!isConfigured()) {
        logger.logEvent('whatsapp', { action: 'template_logged', to, templateName });
        return { success: false, logged: true, mode: 'stub', to, templateName };
    }

    const recipient = normalizeNumber(to);
    const components = params.length
        ? [{ type: 'body', parameters: params.map(p => ({ type: 'text', text: String(p) })) }]
        : undefined;

    const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'template',
        template: { name: templateName, language: { code: language }, components }
    };

    try {
        const resp = await fetch(`${API_BASE}/${API_VERSION}/${WHATSAPP_PHONE_ID}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) {
            const waId = data.messages && data.messages[0] && data.messages[0].id;
            logger.logEvent('whatsapp', { action: 'template_sent', to: recipient, templateName, waId });
            return { success: true, provider: 'meta', waId };
        }
        logger.logEvent('whatsapp', { action: 'template_send_error', to: recipient, templateName, status: resp.status, error: data.error || data });
        return { success: false, error: (data.error && data.error.message) || `HTTP ${resp.status}`, details: data.error || data };
    } catch (err) {
        logger.logEvent('whatsapp', { action: 'template_send_error', to: recipient, templateName, error: err.message });
        return { success: false, error: err.message };
    }
}

// ─── Hot-lead alert to the agency contact ───────────────────────────────────
async function sendHotAlert(to, leadInfo) {
    const { name, budget, interest, phone, timestamp, hot_score, lead_stage } = leadInfo;
    const message = [
        `🔴 HOT LEAD —`,
        `Name: ${name || 'Unknown'}`,
        `Score: ${hot_score}/10 (${lead_stage || ''})`,
        `Budget: ${budget || 'Unknown'}`,
        `Interest: ${interest || 'Property inquiry'}`,
        `Contact: ${phone || 'Unknown'}`,
        `Time: ${timestamp || new Date().toISOString()}`,
        `REPLY NOW.`
    ].filter(Boolean).join('\n');

    const result = await sendText(to, message);
    logger.logEvent('whatsapp', { action: 'hot_alert_result', to, result });
    return result;
}

// Alias — reply to a lead is just a text send.
async function sendReply(to, text) {
    return sendText(to, text);
}

module.exports = {
    sendText,
    sendReply,
    sendHotAlert,
    sendTemplateMessage,
    verifyCredentials,
    isConfigured,
    normalizeNumber
};
