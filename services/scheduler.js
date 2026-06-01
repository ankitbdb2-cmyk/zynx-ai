const db = require('../database');
const logger = require('./logger');
const { sendText } = require('./whatsapp');
const { checkAndFireSteps } = require('./post-viewing');
const { checkAndExpireLaunches, getLaunchMode } = require('./launch-mode');
const { checkSilentLeads } = require('./silence-decoder');

const AGENT_NUMBER = process.env.AGENT_WHATSAPP_NUMBER || '';

function formatCurrency(val) {
    const n = parseFloat(val);
    return isNaN(n) ? val || '—' : 'AED ' + n.toLocaleString();
}

function generateMorningSummary() {
    try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStr = yesterday.toISOString().slice(0, 10);

        const leads = db.prepare(`
            SELECT * FROM leads WHERE date(date) = ? ORDER BY hot_score DESC
        `).all(dateStr);

        if (leads.length === 0) {
            logger.logEvent('scheduler', { action: 'summary_skipped', date: dateStr, reason: 'No leads' });
            return null;
        }

        const hotLeads = leads.filter(l => (l.hot_score || 0) >= 7);
        const warmLeads = leads.filter(l => (l.hot_score || 0) >= 4 && (l.hot_score || 0) < 7);
        const coldLeads = leads.filter(l => (l.hot_score || 0) < 4);

        let summary = `📊 *Morning Report — ${dateStr}*\n`;
        summary += `Total leads: ${leads.length}\n\n`;

        if (hotLeads.length > 0) {
            summary += `*🔥 HOT LEADS (${hotLeads.length})*\n`;
            hotLeads.forEach(l => {
                summary += `• ${l.name || 'Unknown'} | ${l.phone || '—'} | ${formatCurrency(l.budget)} | ${l.area || '—'}\n`;
            });
            summary += '\n';
        }

        if (warmLeads.length > 0) {
            summary += `*🟡 WARM LEADS (${warmLeads.length})*\n`;
            warmLeads.forEach(l => {
                summary += `• ${l.name || 'Unknown'} | ${l.phone || '—'} | ${formatCurrency(l.budget)}\n`;
            });
            summary += '\n';
        }

        if (coldLeads.length > 0) {
            summary += `*🔵 COLD LEADS (${coldLeads.length})*\n`;
            coldLeads.forEach(l => {
                summary += `• ${l.name || 'Unknown'} | ${l.phone || '—'}\n`;
            });
        }

        return summary;
    } catch (err) {
        logger.logEvent('scheduler', { action: 'summary_error', error: err.message });
        return null;
    }
}

async function sendMorningSummary() {
    const summary = generateMorningSummary();
    if (!summary) return;

    logger.logEvent('scheduler', { action: 'summary_sending', length: summary.length });

    if (!AGENT_NUMBER) {
        console.log(`[MOCK MORNING SUMMARY]\n${summary}`);
        logger.logEvent('scheduler', { action: 'summary_mocked', reason: 'AGENT_WHATSAPP_NUMBER not set' });
        return;
    }

    const result = await sendText(AGENT_NUMBER, summary);
    logger.logEvent('scheduler', { action: 'summary_sent', result });
}

// ─── Schedule: runs daily at 8 AM ─────────────────────────────────────────
function scheduleMorningSummary() {
    const now = new Date();
    const target = new Date(now);
    target.setHours(8, 0, 0, 0);

    if (target <= now) {
        target.setDate(target.getDate() + 1);
    }

    const delayMs = target.getTime() - now.getTime();
    logger.logEvent('scheduler', { action: 'summary_scheduled', nextRun: target.toISOString(), delayMs });

    setTimeout(() => {
        sendMorningSummary();
        setInterval(sendMorningSummary, 86400000);
    }, delayMs);
}

// ─── PVIL — check and fire post-viewing steps every 30 minutes ──────────────
setInterval(() => {
    try {
        const result = checkAndFireSteps(db);
        if (result.fired > 0) {
            console.log(`[PVIL] Steps fired: ${result.fired} of ${result.processed} leads checked`);
        }
    } catch (err) {
        console.error('[PVIL scheduler error]', err);
    }

    // LAUNCH MODE: auto-expire stale launches
    try {
        const expireResult = checkAndExpireLaunches(db);
        if (expireResult.expired > 0) {
            console.log(`[Launch Mode] ${expireResult.expired} launch(es) auto-expired`);
        }
    } catch (launchExpireErr) {
        console.error('[Launch Mode expire error]', launchExpireErr);
    }

    // LAUNCH MODE: 30-minute live summary refresh when launch is active
    try {
        const activeLaunch = getLaunchMode(db);
        if (activeLaunch) {
            sendMorningSummary();
        }
    } catch (launchRefreshErr) {
        console.error('[Launch Mode refresh error]', launchRefreshErr);
    }

    checkSilentLeads(db).catch(() => {});
}, 30 * 60 * 1000);

module.exports = { scheduleMorningSummary, sendMorningSummary, generateMorningSummary };
