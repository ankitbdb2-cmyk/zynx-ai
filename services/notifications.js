const nodemailer = require('nodemailer');
const logger = require('./logger');
const { sendText } = require('./whatsapp');

// ─── PER-AGENCY LEAD NOTIFICATIONS ──────────────────────────────────────────
// Every captured lead is pushed to the owning agency's contact (the `contact` /
// `whatsapp` field on the agencies table).
//
// Destination resolution:
//   "…@…"        → email (Gmail app password or any SMTP server, env-configured)
//   anything else → WhatsApp via Meta Cloud API (WHATSAPP_TOKEN/PHONE_ID)
//   nothing set  → detailed console log (dev mode) so leads are never silent
//
// Day-one stopgap: set a Gmail app password (AGENT_EMAIL + EMAIL_PASSWORD) or
// generic SMTP (SMTP_HOST etc.) and captured leads reach you by email TODAY,
// with zero WhatsApp approval. When Meta creds arrive, switch the agency's
// contact to a number and it goes out as WhatsApp automatically.

function resolveDestination(agency) {
    if (!agency) return '';
    const contact = (agency.contact || agency.whatsapp || '').trim();
    return contact;
}

function looksLikeEmail(dest) {
    return /@/.test(dest);
}

function formatBudget(b) {
    if (!b) return 'Not stated';
    return String(b);
}

function buildLeadMessage(lead) {
    const lines = [
        `⚡ NEW LEAD CAPTURED`,
        ``,
        `Name: ${lead.name || 'Unknown'}`,
        `Phone: ${lead.phone || 'Not captured'}`,
        `Budget: ${formatBudget(lead.budget)}`,
        lead.area ? `Area: ${lead.area}` : null,
        lead.timeline ? `Timeline: ${lead.timeline}` : null,
        `Score: ${lead.hot_score || 0}/10 (${lead.lead_stage || 'Cold'})`,
        lead.source ? `Source: ${lead.source}` : null,
        `Time: ${lead.timestamp || new Date().toISOString()}`,
        ``,
        `Open the dashboard to respond.`
    ].filter(Boolean);
    return lines.join('\n');
}

function buildEmailHtml(lead) {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const row = (label, val) => val ? `<tr><td style="padding:6px 14px;color:#8b8b9e;font-weight:600">${esc(label)}</td><td style="padding:6px 14px;color:#fff">${esc(val)}</td></tr>` : '';
    return `<div style="font-family:Inter,Arial,sans-serif;background:#0d0b14;padding:28px;border-radius:14px;max-width:520px;margin:auto;color:#e6e6f0">
      <div style="font-size:18px;font-weight:800;color:#E1306C;margin-bottom:16px">⚡ New PropMind Lead</div>
      <table style="width:100%;border-collapse:collapse;background:#1a1528;border-radius:10px;overflow:hidden">
        ${row('Name', lead.name)}${row('Phone', lead.phone)}${row('Budget', lead.budget)}
        ${row('Area', lead.area)}${row('Timeline', lead.timeline)}
        ${row('Score', `${lead.hot_score || 0}/10 — ${lead.lead_stage || 'Cold'}`)}
        ${row('Source', lead.source)}${row('Time', lead.timestamp)}
      </table>
      <div style="margin-top:18px;font-size:13px;color:#8b8b9e">Open the PropMind dashboard to respond to this lead.</div>
    </div>`;
}

async function getTransporter() {
    if (process.env.SMTP_HOST) {
        return {
            transporter: nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT || '587', 10),
                secure: process.env.SMTP_SECURE === 'true',
                auth: process.env.SMTP_USER
                    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                    : undefined
            }),
            from: process.env.SMTP_FROM || process.env.SMTP_USER
        };
    }
    if (process.env.AGENT_EMAIL && process.env.EMAIL_PASSWORD) {
        return {
            transporter: nodemailer.createTransport({
                service: 'gmail',
                auth: { user: process.env.AGENT_EMAIL, pass: process.env.EMAIL_PASSWORD }
            }),
            from: process.env.AGENT_EMAIL
        };
    }
    return null;
}

async function sendEmail(dest, subject, textBody, htmlBody) {
    const cfg = await getTransporter();
    if (!cfg) {
        console.log(`[MOCK EMAIL → ${dest}] Subject: ${subject}\n${textBody}`);
        logger.logEvent('notify', { action: 'email_mocked', to: dest, subject });
        return { success: false, logged: true, mode: 'mock', to: dest };
    }
    try {
        const info = await cfg.transporter.sendMail({
            from: cfg.from,
            to: dest,
            subject,
            text: textBody,
            html: htmlBody || undefined
        });
        console.log(`[EMAIL SENT → ${dest}] messageId=${info.messageId}`);
        logger.logEvent('notify', { action: 'email_sent', to: dest, subject, messageId: info.messageId });
        return { success: true, mode: 'email', to: dest, messageId: info.messageId };
    } catch (err) {
        console.error(`[EMAIL SEND FAILED → ${dest}]`, err.message);
        logger.logEvent('notify', { action: 'email_error', to: dest, error: err.message });
        return { success: false, mode: 'email', to: dest, error: err.message };
    }
}

// ─── Main entry: push a captured lead to its agency ─────────────────────────
async function notifyLeadCaptured(agency, lead) {
    const dest = resolveDestination(agency);
    const text = buildLeadMessage(lead);
    const subject = `New PropMind Lead: ${lead.name || 'Unknown'} [${lead.hot_score || 0}/10]`;

    if (!dest) {
        console.log(`[LEAD NOTIFY — NO CONTACT CONFIGURED for agency "${agency ? agency.name || agency.slug : '?'}"]\n${text}`);
        logger.logEvent('notify', { action: 'no_contact', agency: agency ? agency.slug : null, lead: lead.phone });
        return { success: false, reason: 'no_contact_configured', agency: agency ? agency.slug : null };
    }

    if (looksLikeEmail(dest)) {
        const result = await sendEmail(dest, subject, text, buildEmailHtml(lead));
        logger.logEvent('notify', { action: 'lead_notified', agency: agency ? agency.slug : null, channel: 'email', to: dest, result: result.success });
        return result;
    }

    // WhatsApp number → Meta Cloud API
    const result = await sendText(dest, text);
    logger.logEvent('notify', { action: 'lead_notified', agency: agency ? agency.slug : null, channel: 'whatsapp', to: dest, result: result.success });
    return result;
}

module.exports = { notifyLeadCaptured, resolveDestination, looksLikeEmail, buildLeadMessage };
