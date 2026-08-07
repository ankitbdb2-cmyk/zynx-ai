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
                host: 'smtp.gmail.com',
                port: 587,
                secure: false,
                connectionTimeout: 15000,
                auth: { user: process.env.AGENT_EMAIL, pass: process.env.EMAIL_PASSWORD }
            }),
            from: process.env.AGENT_EMAIL
        };
    }
    return null;
}

// ─── HTTP email relays (preferred) ─────────────────────────────────────────
// Direct Gmail SMTP is silently dropped from many cloud hosts (Render free,
// VPS IPs). HTTP APIs deliver over port 443, which is universally reachable.
//
// Supported:
//   - RESEND_API_KEY     → Resend (resend.com). NOTE: requires a verified
//                          sender DOMAIN you own; from = RESEND_FROM.
//   - SENDGRID_API_KEY   → Twilio SendGrid free tier. Use "Single Sender
//                          Verification" so from = your own email, no domain
//                          needed. from = SENDGRID_FROM (or AGENT_EMAIL).
async function sendViaHttpRelay(dest, subject, textBody, htmlBody) {
    if (process.env.RESEND_API_KEY) {
        const from = process.env.RESEND_FROM;
        if (!from) return { success: false, mode: 'email', to: dest, error: 'RESEND_FROM is required with RESEND_API_KEY' };
        try {
            const resp = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ from, to: [dest], subject, text: textBody, html: htmlBody || undefined })
            });
            const data = await resp.json().catch(() => ({}));
            if (resp.ok) return { success: true, mode: 'email', to: dest, messageId: data.id };
            return { success: false, mode: 'email', to: dest, error: (data.message && data.message[0] && data.message[0].message) || data.message || `HTTP ${resp.status}` };
        } catch (err) {
            return { success: false, mode: 'email', to: dest, error: err.message };
        }
    }
    if (process.env.SENDGRID_API_KEY) {
        const from = process.env.SENDGRID_FROM || process.env.AGENT_EMAIL;
        if (!from) return { success: false, mode: 'email', to: dest, error: 'SENDGRID_FROM/AGENT_EMAIL required' };
        try {
            const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
                method: 'POST',
                headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    personalizations: [{ to: [{ email: dest }] }],
                    from: { email: from },
                    subject,
                    content: [{ type: 'text/plain', value: textBody }].concat(htmlBody ? [{ type: 'text/html', value: htmlBody }] : [])
                })
            });
            if (resp.status === 202) return { success: true, mode: 'email', to: dest, messageId: 'sendgrid-accepted' };
            const data = await resp.json().catch(() => ({}));
            return { success: false, mode: 'email', to: dest, error: (data.errors && data.errors[0] && data.errors[0].message) || `HTTP ${resp.status}` };
        } catch (err) {
            return { success: false, mode: 'email', to: dest, error: err.message };
        }
    }
    return null;
}

async function sendEmail(dest, subject, textBody, htmlBody) {
    // HTTP relay first — survives cloud hosts that drop SMTP egress.
    const relayResult = await sendViaHttpRelay(dest, subject, textBody, htmlBody);
    if (relayResult) {
        if (relayResult.success) {
            console.log(`[EMAIL SENT via relay → ${dest}] messageId=${relayResult.messageId}`);
            logger.logEvent('notify', { action: 'email_sent', to: dest, subject, messageId: relayResult.messageId });
        } else {
            console.error(`[EMAIL RELAY FAILED → ${dest}] ${relayResult.error}`);
            logger.logEvent('notify', { action: 'email_error', to: dest, error: relayResult.error });
        }
        return relayResult;
    }

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
        const preview = process.env.SMTP_HOST && process.env.SMTP_HOST.includes('ethereal')
            ? nodemailer.getTestMessageUrl(info)
            : null;
        if (preview) console.log(`[EMAIL PREVIEW] ${preview}`);
        logger.logEvent('notify', { action: 'email_sent', to: dest, subject, messageId: info.messageId });
        return { success: true, mode: 'email', to: dest, messageId: info.messageId };
    } catch (err) {
        console.error(`[EMAIL SEND FAILED → ${dest}]`, err.message);
        logger.logEvent('notify', { action: 'email_error', to: dest, error: err.message });
        return { success: false, mode: 'email', to: dest, error: err.message };
    }
}

// ─── Map a notify result to a durable per-lead status ───────────────────────
// The lead record keeps notify_status/notify_error so a broken alert pipeline
// is visible in the dashboard instead of failing silently.
//   'sent'      → delivered (email or WhatsApp actually sent)
//   'mock'      → no SMTP/WhatsApp credentials configured; only logged
//   'no_contact'→ the agency row has no email/WhatsApp destination
//   'skipped'   → deliberately not alerted (e.g. low-scoring WhatsApp lead)
//   'failed'    → transport error (bad password, SMTP down, etc.)
function leadNotifyStatus(result, fallback) {
    if (!result) return { status: 'failed', error: fallback || 'notification returned no result' };
    if (result.reason === 'no_contact_configured') {
        return { status: 'no_contact', error: 'agency has no email/WhatsApp contact configured' };
    }
    if (result.mode === 'mock' || result.mode === 'stub' || (result.logged && !result.success)) {
        return { status: 'mock', error: 'no SMTP credentials configured (email not actually sent)' };
    }
    if (result.success) return { status: 'sent', error: null };
    return { status: 'failed', error: result.error || fallback || 'send failed' };
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

module.exports = { notifyLeadCaptured, resolveDestination, looksLikeEmail, buildLeadMessage, leadNotifyStatus };
