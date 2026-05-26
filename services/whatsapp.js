const logger = require('./logger');

// WhatsApp sending will be configured per-client.
// For now all "sends" are logged to console.

async function sendText(to, body) {
    if (!to || !body) {
        logger.logEvent('whatsapp', { action: 'send_skipped', reason: 'Missing to or body' });
        return { success: false, error: 'Missing recipient or message body' };
    }

    logger.logEvent('whatsapp', { action: 'send_logged', to, bodyLength: body.length });
    console.log(`[WHATSAPP] To: ${to}`);
    console.log(`[WHATSAPP] Body: ${body}`);
    console.log('[WHATSAPP] WhatsApp provider not configured — message logged instead of sent.');

    return { success: true, logged: true };
}

async function sendHotAlert(leadInfo) {
    const { name, budget, interest, phone, timestamp } = leadInfo;
    const message = [
        `🔴 HOT LEAD —`,
        `Name: ${name || 'Unknown'}`,
        `Budget: ${budget || 'Unknown'}`,
        `Interest: ${interest || 'Property inquiry'}`,
        `Contact: ${phone || 'Unknown'}`,
        `Time: ${timestamp || new Date().toISOString()}`,
        `REPLY NOW.`
    ].join('\n');

    logger.logEvent('whatsapp', { action: 'hot_alert_logged', name, budget, phone });
    console.log(`[HOT ALERT] Would send WhatsApp to agency owner:`);
    console.log(message);

    return { success: true, logged: true, message };
}

async function sendReply(to, text) {
    console.log(`[WHATSAPP REPLY] To: ${to}`);
    console.log(`[WHATSAPP REPLY] ${text}`);
    return { success: true, logged: true };
}

module.exports = { sendText, sendHotAlert, sendReply };
