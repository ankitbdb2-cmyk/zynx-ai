const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ─── PERSISTENCE STRATEGY ───────────────────────────────────────────────────
// On Render: use /opt/render/project/data (persistent disk mount point).
//   → Render sets the RENDER env var automatically on all Render services.
//   → You MUST configure a persistent disk in the Render dashboard mounted
//     at /opt/render/project/data for data to survive redeploys.
// Locally: use the project directory (__dirname).
// ────────────────────────────────────────────────────────────────────────────

const IS_RENDER = !!process.env.RENDER;
const DATA_DIR = IS_RENDER
    ? (process.env.DATA_DIR || '/opt/render/project/data')
    : __dirname;

// Ensure directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`Created data directory: ${DATA_DIR}`);
}

const dbPath = path.resolve(DATA_DIR, 'propmind.db');

// ─── STARTUP DIAGNOSTICS ────────────────────────────────────────────────────
console.log('════════════════════════════════════════════════════════════');
console.log('  DATABASE STARTUP DIAGNOSTICS');
console.log('════════════════════════════════════════════════════════════');
console.log(`  Environment:   ${IS_RENDER ? 'RENDER (production)' : 'LOCAL (development)'}`);
console.log(`  Data directory: ${DATA_DIR}`);
console.log(`  Database path:  ${dbPath}`);
console.log(`  DB file exists: ${fs.existsSync(dbPath)}`);
if (fs.existsSync(dbPath)) {
    const stats = fs.statSync(dbPath);
    console.log(`  DB file size:   ${stats.size} bytes`);
    console.log(`  DB last modified: ${stats.mtime.toISOString()}`);
}
console.log('════════════════════════════════════════════════════════════');

// Open database connection
const db = new Database(dbPath);
console.log('Connected to the SQLite database.');

// ─── CRITICAL: Enable WAL mode for crash recovery and better concurrency ────
db.pragma('journal_mode = WAL');
db.pragma('synchronous = FULL');   // Maximum durability — flush to disk on every write
db.pragma('foreign_keys = ON');
console.log('Database pragmas set: WAL mode, FULL synchronous, foreign keys ON.');

// ─── Initialize all tables and seed ONLY on first-ever run ──────────────────
initDb();

function initDb() {
    // ── 1. LEADS TABLE ──────────────────────────────────────────────────────
    db.prepare(`
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            phone TEXT,
            budget TEXT,
            timeline TEXT,
            hot_score INTEGER DEFAULT 0,
            lead_stage TEXT DEFAULT 'Cold',
            signals TEXT,
            recommended_action TEXT,
            area TEXT,
            bedrooms TEXT,
            visit_time TEXT,
            psychology_notes TEXT,
            status TEXT DEFAULT 'New',
            date DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
    console.log('Leads table initialized.');

    // Migrate existing leads table if new columns don't exist yet
    const migrations = [
        { col: 'hot_score', def: 'INTEGER DEFAULT 0' },
        { col: 'lead_stage', def: "TEXT DEFAULT 'Cold'" },
        { col: 'signals', def: 'TEXT' },
        { col: 'recommended_action', def: 'TEXT' },
        { col: 'area', def: 'TEXT' },
        { col: 'bedrooms', def: 'TEXT' },
        { col: 'timeline', def: 'TEXT' },
    ];
    for (const m of migrations) {
        try {
            db.prepare(`ALTER TABLE leads ADD COLUMN ${m.col} ${m.def}`).run();
            console.log(`Migrated: added ${m.col} column to leads.`);
        } catch (e) { /* column already exists — safe to ignore */ }
    }

    // ── 2. PROPERTIES TABLE ─────────────────────────────────────────────────
    db.prepare(`
        CREATE TABLE IF NOT EXISTS properties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT,
            title TEXT,
            area TEXT,
            price TEXT,
            bedrooms TEXT,
            description TEXT,
            availability TEXT DEFAULT 'Available',
            date DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
    console.log('Properties table initialized.');

    // ── 3. BACKUP CHECK: Count existing data BEFORE any seeding ─────────────
    const propertyCount = db.prepare(`SELECT COUNT(*) as count FROM properties`).get().count;
    const leadCount = db.prepare(`SELECT COUNT(*) as count FROM leads`).get().count;

    console.log('────────────────────────────────────────────────────────────');
    console.log(`  PERSISTENCE CHECK:`);
    console.log(`    Properties in database: ${propertyCount}`);
    console.log(`    Leads in database:      ${leadCount}`);
    console.log('────────────────────────────────────────────────────────────');

    // ── 4. SEED ONLY ON FIRST-EVER DEPLOYMENT (empty properties table) ──────
    if (propertyCount === 0) {
        console.log('  ⚠ Properties table is EMPTY — running first-time seed...');
        const seedData = [
            ['Rent', 'Studio', 'International City', 'AED 28,000/yr', 'Studio', 'Budget friendly', 'Available now'],
            ['Rent', 'Studio', 'Dubai Marina', 'AED 65,000/yr', 'Studio', 'Sea view', 'Available now'],
            ['Rent', '1BR', 'Dubai Silicon Oasis', 'AED 45,000/yr', '1BR', 'Tech hub area', 'Available now'],
            ['Sale', 'Studio', 'JVC', 'AED 450,000', 'Studio', 'High ROI investment', 'Available now'],
            ['Sale', '1BR', 'Dubai Marina', 'AED 950,000', '1BR', 'Sea view, ready to move', 'Available now']
        ];
        const stmt = db.prepare(`INSERT INTO properties (type, title, area, price, bedrooms, description, availability) VALUES (?, ?, ?, ?, ?, ?, ?)`);

        const insertMany = db.transaction((properties) => {
            for (const p of properties) stmt.run(p);
        });
        insertMany(seedData);

        console.log(`  ✓ Seeded ${seedData.length} initial properties (first run only).`);
    } else {
        console.log(`  ✓ Skipping seed — ${propertyCount} properties already in database. DATA PRESERVED.`);
    }

    if (leadCount > 0) {
        console.log(`  ✓ ${leadCount} leads preserved in database. No data lost.`);
    }

    // ── 5. SETTINGS TABLE ───────────────────────────────────────────────────
    db.prepare(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `).run();
    console.log('Settings table initialized.');

    // Seed agency_name from env if not already set
    const agencyRow = db.prepare(`SELECT value FROM settings WHERE key = 'agency_name'`).get();
    if (!agencyRow) {
        db.prepare(`INSERT INTO settings (key, value) VALUES ('agency_name', ?)`)
          .run(process.env.AGENCY_NAME || 'Sandcastle Properties');
    }

    // ── FINAL STATUS ────────────────────────────────────────────────────────
    const finalPropertyCount = db.prepare(`SELECT COUNT(*) as count FROM properties`).get().count;
    const finalLeadCount = db.prepare(`SELECT COUNT(*) as count FROM leads`).get().count;
    console.log('════════════════════════════════════════════════════════════');
    console.log('  DATABASE READY');
    console.log(`    Total properties: ${finalPropertyCount}`);
    console.log(`    Total leads:      ${finalLeadCount}`);
    console.log('════════════════════════════════════════════════════════════');
}

// ─── Graceful shutdown — ensure WAL is checkpointed ─────────────────────────
function gracefulShutdown() {
    try {
        console.log('Checkpointing WAL and closing database...');
        db.pragma('wal_checkpoint(TRUNCATE)');
        db.close();
        console.log('Database closed cleanly.');
    } catch (e) {
        console.error('Error during database shutdown:', e.message);
    }
}

process.on('SIGINT', () => { gracefulShutdown(); process.exit(0); });
process.on('SIGTERM', () => { gracefulShutdown(); process.exit(0); });
process.on('exit', () => {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { /* already closed */ }
});

module.exports = db;
