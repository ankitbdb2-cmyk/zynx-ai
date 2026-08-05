require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const { db } = require('./database');
const { getDefaultAgency } = require('./services/agencies');

const app = express();
const PORT = process.env.PORT || 8080;

// Behind a reverse proxy (Render, Railway, Fly, nginx) use the real client IP
// from X-Forwarded-For so rate limits are enforced per visitor, not per proxy.
app.set('trust proxy', true);

// ─── CORS ───────────────────────────────────────────────────────────────────
// The widget UI runs inside an iframe on THIS origin, so the chat itself is
// same-origin. CORS is enabled anyway so external sites can call the public
// /api/ghost/* endpoints directly (e.g. render an agency's listings into their
// own pages). `origin: true` reflects the caller's Origin header back instead
// of `*`, which plays nicely with credentialed/browser tooling.
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

// ─── Liveness probe for uptime pingers (UptimeRobot / cron-job.org) ─────────
// Registered BEFORE dbGuard so it always answers 200 during startup/restarts.
// Deliberately cheap: two COUNTs + one stat. Keeps Render free instances awake.
app.get('/health', async (req, res) => {
    const p = await db.getPersistenceInfo();
    const liveProperties = (await db.prepare(`SELECT COUNT(*) as c FROM properties`).get()).c;
    const liveLeads = (await db.prepare(`SELECT COUNT(*) as c FROM leads`).get()).c;
    const isRemote = p.dbPath.startsWith('libsql://');
    const localPath = p.dbPath.startsWith('file:') ? p.dbPath.replace(/^file:/, '') : p.dbPath;
    const dbExists = isRemote ? p.dbExists : fs.existsSync(localPath);
    let dbSizeBytes = 0;
    if (!isRemote && dbExists) {
        try { dbSizeBytes = fs.statSync(localPath).size; } catch (e) { /* ignore */ }
    }
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
        persistence: {
            ready: p.ready,
            environment: p.environment,
            dbPath: p.dbPath,
            dbExists,
            dbSizeBytes,
            propertyCount: liveProperties,
            leadCount: liveLeads,
            seeded: p.seeded,
            migratedFromEphemeral: p.migratedFromEphemeral
        }
    });
});

function dbGuard(req, res, next) {
    if (!db.isReady()) {
        return res.status(503).json({ status: 'starting', message: 'Database initializing' });
    }
    next();
}

app.use(dbGuard);

app.get('/', async (req, res) => {
    try {
        const agency = await getDefaultAgency(db);
        const agencyName = agency ? agency.name : (process.env.AGENCY_NAME || 'PropMind Real Estate');
        const agencySlug = agency ? agency.slug : (process.env.AGENCY_SLUG || '');
        let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
        html = html.split('{{AGENCY_NAME}}').join(agencyName);
        html = html.split('{{AGENCY_SLUG}}').join(agencySlug || 'propmind');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.send(html);
    } catch (err) {
        console.error('SSR error:', err.message);
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// ─── Embedded widget page — rendered inside the loader's iframe ─────────────
// Isolated by construction: its CSS/DOM never touches the host site.
app.get('/widget', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'widget.html'));
});

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

const ghostRoutes = require('./routes/ghost');
const closerRoutes = require('./routes/closer');
const adminRoutes = require('./routes/admin');
const whatsappRoutes = require('./routes/whatsapp');
const { scheduleMorningSummary } = require('./services/scheduler');
const { createRateLimiter } = require('./services/rate-limit');

// Public, cost-bearing endpoints get rate limited per IP. /api/ghost/chat and
// /api/closer/* call Claude, so a tighter cap protects the budget; lead
// endpoints write rows, so a higher cap still stops floods.
const llmLimiter = createRateLimiter({ max: 30, windowMs: 60000 });
const writeLimiter = createRateLimiter({ max: 60, windowMs: 60000 });

app.use('/api/ghost/chat', llmLimiter);
app.use('/api/closer', llmLimiter);
app.use('/api/ghost/save-lead', writeLimiter);
app.use('/api/ghost/viewing-offer', writeLimiter);
app.use('/api/ghost/confirm-viewing', writeLimiter);
app.use('/api/ghost/complete-viewing', writeLimiter);
app.use('/api/whatsapp/end-conversation', writeLimiter);

app.use('/api/ghost', ghostRoutes);
app.use('/api/closer', closerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// ─── Start daily morning summary scheduler ─────────────────────────────────
db.ready
    .then(async () => {
        scheduleMorningSummary();
        app.listen(PORT, () => {
            db.getPersistenceInfo().then((p) => {
                console.log(`Server running on http://localhost:${PORT}`);
                console.log(`Database: ${p.dbPath} (${p.propertyCount} properties, ${p.leadCount} leads)`);
            });
        });
    })
    .catch((err) => {
        console.error('FATAL: Database failed to initialize.', err);
        process.exit(1);
    });
