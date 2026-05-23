require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const db      = require('./database');

if (!db.isReady()) {
    console.error('FATAL: Database failed to initialize. Refusing to start.');
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

function dbGuard(req, res, next) {
    if (!db.isReady()) {
        return res.status(503).json({ status: 'starting', message: 'Database initializing' });
    }
    next();
}

app.use(dbGuard);

app.get('/', (req, res) => {
    try {
        const row = db.prepare(`SELECT value FROM settings WHERE key = 'agency_name'`).get();
        const agencyName = row ? row.value : (process.env.AGENCY_NAME || 'Sandcastle Properties');
        let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
        html = html.split('{{AGENCY_NAME}}').join(agencyName);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.send(html);
    } catch (err) {
        console.error('SSR error:', err.message);
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

app.get('/health', (req, res) => {
    const p = db.getPersistenceInfo();
    const liveProperties = db.prepare(`SELECT COUNT(*) as c FROM properties`).get().c;
    const liveLeads = db.prepare(`SELECT COUNT(*) as c FROM leads`).get().c;
    const dbExists = fs.existsSync(p.dbPath);
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        persistence: {
            ready: p.ready,
            environment: p.environment,
            dbPath: p.dbPath,
            dbExists,
            dbSizeBytes: dbExists ? fs.statSync(p.dbPath).size : 0,
            propertyCount: liveProperties,
            leadCount: liveLeads,
            seeded: p.seeded,
            migratedFromEphemeral: p.migratedFromEphemeral
        }
    });
});

app.use(express.static(path.join(__dirname, 'public')));

const ghostRoutes = require('./routes/ghost');
const closerRoutes = require('./routes/closer');
const adminRoutes = require('./routes/admin');

app.use('/api/ghost', ghostRoutes);
app.use('/api/closer', closerRoutes);
app.use('/api/admin', adminRoutes);

app.listen(PORT, () => {
    const p = db.getPersistenceInfo();
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Database: ${p.dbPath} (${p.propertyCount} properties, ${p.leadCount} leads)`);
});
