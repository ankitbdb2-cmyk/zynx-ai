const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
const MAX_LOG_AGE_DAYS = 7;

if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

function ensureDir() {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
}

function logEvent(category, data) {
    ensureDir();
    const timestamp = new Date().toISOString();
    const entry = { timestamp, category, ...data };
    const line = JSON.stringify(entry) + '\n';
    const dateStr = timestamp.slice(0, 10);
    const filePath = path.join(LOG_DIR, `${category}-${dateStr}.log`);
    try {
        fs.appendFileSync(filePath, line);
    } catch (e) {
        console.error(`[LOGGER] Failed to write ${filePath}:`, e.message);
    }
    if (process.env.NODE_ENV !== 'production' || process.env.DEBUG) {
        console.log(`[${category}]`, JSON.stringify(data));
    }
}

function cleanupOldLogs() {
    ensureDir();
    const files = fs.readdirSync(LOG_DIR);
    const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 86400000;
    for (const f of files) {
        const fp = path.join(LOG_DIR, f);
        try {
            const stat = fs.statSync(fp);
            if (stat.isFile() && stat.mtimeMs < cutoff) {
                fs.unlinkSync(fp);
            }
        } catch (e) { /* skip */ }
    }
}

setInterval(cleanupOldLogs, 86400000);
cleanupOldLogs();

module.exports = { logEvent, cleanupOldLogs };
