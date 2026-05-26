const logger = require('./logger');

const PROVIDER = (process.env.WHATSAPP_PROVIDER || 'twilio').toLowerCase();
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const FROM_NUMBER = process.env.WHATSAPP_FROM_NUMBER || '';
const AGENT_NUMBER = process.env.AGENT_WHATSAPP_NUMBER || '';

async function sendText(to, body) {
    if (!to || !body) {
        logger.logEvent('whatsapp', { action: 'send_skipped', reason: 'Missing to or body' });
        return { success: false, error: 'Missing recipient or message body' };
    }

    logger.logEvent('whatsapp', { action: 'send_start', to, bodyLength: body.length });

    if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) {
        logger.logEvent('whatsapp', {
            action: 'send_mocked',
            to,
            body,
            reason: 'WhatsApp not configured'
        });
        console.log(`[MOCK WHATSAPP] To: ${to}\nBody: ${body}`);
        return { success: true, mocked: true };
    }

    try {
        const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');
        const response = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    To: to,
                    From: FROM_NUMBER,
                    Body: body
                })
            }
        );

        const data = await response.json();

        if (response.ok) {
            logger.logEvent('whatsapp', {
                action: 'send_success',
                to,
                sid: data.sid,
                status: data.status
            });
            return { success: true, sid: data.sid, status: data.status };
        } else {
            logger.logEvent('whatsapp', {
                action: 'send_error',
                to,
                error: data.message,
                code: data.code
            });
            return { success: false, error: data.message };
        }
    } catch (err) {
        logger.logEvent('whatsapp', {
            action: 'send_failed',
            to,
            error: err.message
        });
        return { success: false, error: err.message };
    }
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

    if (!AGENT_NUMBER) {
        logger.logEvent('whatsapp', {
            action: 'hot_alert_skipped',
            reason: 'AGENT_WHATSAPP_NUMBER not set'
        });
        console.log(`[HOT ALERT - NO WHATSAPP] Would send to agency owner:\n${message}`);
        return { success: false, mocked: true, message };
    }

    return await sendText(AGENT_NUMBER, message);
}

async function sendReply(to, text) {
    return await sendText(to, text);
}

module.exports = { sendText, sendHotAlert, sendReply };
