const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ─── PERSISTENCE — production MUST use Render persistent disk ───────────────
const IS_RENDER = !!process.env.RENDER;
const RENDER_DATA_DIR = '/opt/render/project/data';
const PRODUCTION_DB_FILE = path.join(RENDER_DATA_DIR, 'propmind.db');

const DATA_DIR = IS_RENDER
    ? (process.env.DATA_DIR || RENDER_DATA_DIR)
    : (process.env.DATA_DIR || __dirname);

const dbPath = IS_RENDER
    ? PRODUCTION_DB_FILE
    : path.resolve(DATA_DIR, 'propmind.db');

let dbReady = false;
const persistenceInfo = {
    environment: IS_RENDER ? 'production' : 'local',
    dataDir: DATA_DIR,
    dbPath,
    dbExists: false,
    dbSizeBytes: 0,
    propertyCount: 0,
    leadCount: 0,
    seeded: false,
    migratedFromEphemeral: false
};

function ensureDataDirectory() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        console.log(`Created data directory: ${DATA_DIR}`);
    }
}

function migrateEphemeralDbIfNeeded() {
    if (!IS_RENDER) return;
    const ephemeralPath = path.resolve(__dirname, 'propmind.db');
    if (fs.existsSync(dbPath)) return;
    if (!fs.existsSync(ephemeralPath)) return;
    try {
        fs.copyFileSync(ephemeralPath, dbPath);
        persistenceInfo.migratedFromEphemeral = true;
        console.log(`✓ Migrated database from ephemeral path → ${dbPath}`);
        const wal = ephemeralPath + '-wal';
        const shm = ephemeralPath + '-shm';
        if (fs.existsSync(wal)) fs.copyFileSync(wal, dbPath + '-wal');
        if (fs.existsSync(shm)) fs.copyFileSync(shm, dbPath + '-shm');
    } catch (e) {
        console.error('Ephemeral DB migration failed:', e.message);
    }
}

function logStartupDiagnostics() {
    console.log('════════════════════════════════════════════════════════════');
    console.log('  DATABASE STARTUP DIAGNOSTICS');
    console.log('════════════════════════════════════════════════════════════');
    console.log(`  Environment:    ${persistenceInfo.environment}`);
    console.log(`  Data directory: ${DATA_DIR}`);
    console.log(`  Database path:  ${dbPath}`);
    persistenceInfo.dbExists = fs.existsSync(dbPath);
    console.log(`  DB file exists: ${persistenceInfo.dbExists}`);
    if (persistenceInfo.dbExists) {
        const stats = fs.statSync(dbPath);
        persistenceInfo.dbSizeBytes = stats.size;
        console.log(`  DB file size:   ${stats.size} bytes`);
        console.log(`  DB modified:    ${stats.mtime.toISOString()}`);
    }
    if (IS_RENDER && DATA_DIR !== RENDER_DATA_DIR) {
        console.warn(`  ⚠ WARNING: Expected Render disk at ${RENDER_DATA_DIR}`);
    }
    console.log('════════════════════════════════════════════════════════════');
}

ensureDataDirectory();
migrateEphemeralDbIfNeeded();
logStartupDiagnostics();

if (!fs.existsSync(dbPath) && IS_RENDER) {
    console.log('  ℹ No database on persistent disk yet — will create at:', dbPath);
}

const db = new Database(dbPath);
console.log('Connected to SQLite.');

db.pragma('journal_mode = WAL');
db.pragma('synchronous = FULL');
db.pragma('foreign_keys = ON');
console.log('Pragmas: WAL, FULL sync, foreign keys ON.');

initDb();

function initDb() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS _meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT, phone TEXT, budget TEXT, timeline TEXT,
            hot_score INTEGER DEFAULT 0, lead_stage TEXT DEFAULT 'Cold',
            signals TEXT, recommended_action TEXT, area TEXT, bedrooms TEXT,
            visit_time TEXT, psychology_notes TEXT, status TEXT DEFAULT 'New',
            date DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    const leadMigrations = [
        { col: 'hot_score', def: 'INTEGER DEFAULT 0' },
        { col: 'lead_stage', def: "TEXT DEFAULT 'Cold'" },
        { col: 'signals', def: 'TEXT' },
        { col: 'recommended_action', def: 'TEXT' },
        { col: 'area', def: 'TEXT' },
        { col: 'bedrooms', def: 'TEXT' },
        { col: 'timeline', def: 'TEXT' },
        { col: 'viewing_offer_sent', def: 'INTEGER DEFAULT 0' },
        { col: 'viewing_confirmed', def: 'INTEGER DEFAULT 0' },
        { col: 'viewing_slot_id', def: 'INTEGER' },
        { col: 'language', def: "TEXT DEFAULT 'English'" },
        { col: 'transcription_cost', def: 'REAL DEFAULT 0' },
        { col: 'completed_at', def: 'DATETIME DEFAULT NULL' },
        { col: 'no_show', def: 'INTEGER DEFAULT 0' },
        { col: 'pv_state', def: "TEXT DEFAULT 'pending'" },
        { col: 'pv_launched_at', def: 'DATETIME DEFAULT NULL' },
        { col: 'nationality', def: "TEXT DEFAULT ''" },
        { col: 'silence_detected_at', def: 'INTEGER' },
        { col: 'silence_alerted_at', def: 'INTEGER' },
        { col: 'last_reply_at', def: 'INTEGER' },
    ];
    for (const m of leadMigrations) {
        try { db.prepare(`ALTER TABLE leads ADD COLUMN ${m.col} ${m.def}`).run(); } catch (e) { /* exists */ }
    }

    db.prepare(`
        CREATE TABLE IF NOT EXISTS availability_slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slot_datetime TEXT NOT NULL, label TEXT,
            is_booked INTEGER DEFAULT 0, lead_id INTEGER,
            date DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS viewing_offers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER NOT NULL, slot_ids TEXT NOT NULL,
            status TEXT DEFAULT 'pending', selected_slot_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS properties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT, title TEXT, area TEXT, price TEXT,
            bedrooms TEXT, description TEXT,
            availability TEXT DEFAULT 'Available',
            date DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY, value TEXT NOT NULL
        )
    `).run();

    try {
        db.prepare(`CREATE TABLE IF NOT EXISTS launches (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            developer   TEXT NOT NULL,
            project     TEXT NOT NULL,
            payment_plan     TEXT DEFAULT '',
            handover_date    TEXT DEFAULT '',
            price_floor      INTEGER DEFAULT 0,
            golden_visa      INTEGER DEFAULT 0,
            roi_projection   TEXT DEFAULT '',
            notes            TEXT DEFAULT '',
            active           INTEGER DEFAULT 0,
            expires_at       TEXT DEFAULT NULL,
            created_at       TEXT DEFAULT (datetime('now'))
        )`).run();
    } catch(e) { /* table exists */ }

    db.exec(`
        CREATE TABLE IF NOT EXISTS silence_profiles (
            id              INTEGER  PRIMARY KEY AUTOINCREMENT,
            lead_id         INTEGER  NOT NULL REFERENCES leads(id),
            generated_at    INTEGER  NOT NULL,
            fear            TEXT     NOT NULL,
            what_not_to_do  TEXT     NOT NULL,
            counter_move    TEXT     NOT NULL,
            stage           TEXT,
            nationality     TEXT,
            budget          INTEGER,
            dismissed       INTEGER  DEFAULT 0,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_silence_lead
            ON silence_profiles(lead_id);
        CREATE INDEX IF NOT EXISTS idx_silence_dismissed
            ON silence_profiles(dismissed)
    `);

    const propertyCount = db.prepare(`SELECT COUNT(*) as count FROM properties`).get().count;
    const leadCount = db.prepare(`SELECT COUNT(*) as count FROM leads`).get().count;
    persistenceInfo.propertyCount = propertyCount;
    persistenceInfo.leadCount = leadCount;

    console.log('────────────────────────────────────────────────────────────');
    console.log(`  PERSISTENCE CHECK: ${propertyCount} properties, ${leadCount} leads`);
    console.log('────────────────────────────────────────────────────────────');

    console.log(`  ✓ DATA PRESERVED — ${propertyCount} properties, ${leadCount} leads. No overwrite.`);

    const agencyRow = db.prepare(`SELECT value FROM settings WHERE key = 'agency_name'`).get();
    if (!agencyRow) {
        db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('agency_name', ?)`)
          .run(process.env.AGENCY_NAME || 'PropMind Real Estate');
    }

    db.pragma('wal_checkpoint(PASSIVE)');
    persistenceInfo.dbExists = fs.existsSync(dbPath);
    if (persistenceInfo.dbExists) persistenceInfo.dbSizeBytes = fs.statSync(dbPath).size;

    dbReady = true;
    console.log('════════════════════════════════════════════════════════════');
    console.log('  DATABASE READY — serving requests allowed');
    console.log(`    Path: ${dbPath}`);
    console.log(`    Properties: ${persistenceInfo.propertyCount} | Leads: ${persistenceInfo.leadCount}`);
    console.log('════════════════════════════════════════════════════════════');
}

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
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { /* closed */ }
});

db.isReady = () => dbReady;
db.getPersistenceInfo = () => ({ ...persistenceInfo, ready: dbReady });
db.dbPath = dbPath;

function parseBudget(str) {
  if (!str) return 0;
  const s = String(str).toLowerCase().trim();

  // Handle shorthand: 1.2M → 1200000, 2.5m → 2500000, 500k → 500000
  const mMatch = s.match(/([\d.]+)\s*m/);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1_000_000);

  const kMatch = s.match(/([\d.]+)\s*k/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1_000);

  // Strip non-numeric except dot, parse as number
  const numeric = parseFloat(s.replace(/[^0-9.]/g, ''));
  return isNaN(numeric) ? 0 : Math.round(numeric);
}

module.exports = { db, parseBudget };
