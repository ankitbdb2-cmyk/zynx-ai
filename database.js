const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

const SEED_FILE = path.resolve(__dirname, 'seed-data.json');

// ─── PERSISTENCE — production MUST use Turso (cloud SQLite, survives redeploys)
// TURSO_URL + TURSO_TOKEN → Turso cloud (Render production).
// Without those → local file: URL (dev / pre-Turso fallback).
const IS_RENDER = !!process.env.RENDER;
const IS_TURSO = !!(process.env.TURSO_URL && process.env.TURSO_TOKEN);

let clientUrl;
let authToken;
if (IS_TURSO) {
    clientUrl = process.env.TURSO_URL;
    authToken = process.env.TURSO_TOKEN;
} else {
    const DATA_DIR = process.env.DATA_DIR || __dirname;
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    clientUrl = 'file:' + path.resolve(DATA_DIR, 'propmind.db').replace(/\\/g, '/');
}

const client = createClient({ url: clientUrl, authToken });

const dbPath = clientUrl;

let dbReady = false;
const persistenceInfo = {
    environment: IS_TURSO ? 'production-turso' : IS_RENDER ? 'production-ephemeral' : 'local',
    dataDir: IS_TURSO ? 'turso' : clientUrl.replace(/^file:/, ''),
    dbPath,
    dbExists: false,
    dbSizeBytes: 0,
    propertyCount: 0,
    leadCount: 0,
    seeded: false,
    migratedFromEphemeral: false
};

if (IS_RENDER && !IS_TURSO) {
    console.error('⚠⚠⚠  WARNING: Running on Render WITHOUT TURSO_URL/TURSO_TOKEN — the database is EPHEMERAL and every redeploy wipes it. Set TURSO_URL + TURSO_TOKEN immediately.');
}

function rowToObject(result, row) {
    const out = {};
    for (let i = 0; i < result.columns.length; i++) {
        out[result.columns[i]] = row[i];
    }
    return out;
}

function normalizeArgs(args) {
    return args.map((a) => (a === undefined ? null : a));
}

function prepare(sql) {
    return {
        get: async (...args) => {
            const r = await client.execute({ sql, args: normalizeArgs(args) });
            return r.rows.length ? rowToObject(r, r.rows[0]) : undefined;
        },
        all: async (...args) => {
            const r = await client.execute({ sql, args: normalizeArgs(args) });
            return r.rows.map((row) => rowToObject(r, row));
        },
        run: async (...args) => {
            const r = await client.execute({ sql, args: normalizeArgs(args) });
            return {
                changes: r.rowsAffected ?? 0,
                lastInsertRowid: Number(r.lastInsertRowid ?? 0)
            };
        }
    };
}

async function exec(sql) {
    return client.execute({ sql });
}

async function pragma(sql) {
    try {
        await client.execute({ sql: `PRAGMA ${sql}` });
    } catch (e) {
        console.warn('pragma ignored:', e.message);
    }
}

async function close() {
    try { await client.close(); } catch (e) { /* already closed */ }
}

async function getPersistenceInfo() {
    const live = { ...persistenceInfo, ready: dbReady };
    try {
        const props = await db.prepare(`SELECT COUNT(*) as c FROM properties`).get();
        const leads = await db.prepare(`SELECT COUNT(*) as c FROM leads`).get();
        live.propertyCount = props.c;
        live.leadCount = leads.c;
    } catch (e) { /* keep boot snapshot on failure */ }
    return live;
}

const db = {
    prepare,
    exec,
    pragma,
    close,
    isReady: () => dbReady,
    getPersistenceInfo,
    dbPath
};

async function initDb() {
    await db.pragma('journal_mode = DELETE');
    await db.pragma('synchronous = FULL');
    await db.pragma('foreign_keys = ON');

    await db.prepare(`
        CREATE TABLE IF NOT EXISTS _meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `).run();

    await db.prepare(`
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
        { col: 'purpose', def: 'TEXT' },
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
        try { await db.prepare(`ALTER TABLE leads ADD COLUMN ${m.col} ${m.def}`).run(); } catch (e) { /* exists */ }
    }

    await db.prepare(`
        CREATE TABLE IF NOT EXISTS availability_slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slot_datetime TEXT NOT NULL, label TEXT,
            is_booked INTEGER DEFAULT 0, lead_id INTEGER,
            date DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    await db.prepare(`
        CREATE TABLE IF NOT EXISTS viewing_offers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER NOT NULL, slot_ids TEXT NOT NULL,
            status TEXT DEFAULT 'pending', selected_slot_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    await db.prepare(`
        CREATE TABLE IF NOT EXISTS properties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT, title TEXT, area TEXT, price TEXT,
            bedrooms TEXT, description TEXT,
            availability TEXT DEFAULT 'Available',
            date DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    await db.prepare(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY, value TEXT NOT NULL
        )
    `).run();

    // ─── Agencies (multi-tenant) ─────────────────────────────────────────────
    await db.prepare(`
        CREATE TABLE IF NOT EXISTS agencies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            whatsapp TEXT DEFAULT '',
            contact TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
    try { await db.prepare(`ALTER TABLE agencies ADD COLUMN contact TEXT DEFAULT ''`).run(); } catch (e) { /* exists */ }

    // ─── agency_id column migrations ─────────────────────────────────────────
    const agencyIdMigrations = [
        { table: 'properties', col: 'agency_id', def: 'INTEGER DEFAULT NULL' },
        { table: 'leads',      col: 'agency_id', def: 'INTEGER DEFAULT NULL' },
    ];
    for (const m of agencyIdMigrations) {
        try { await db.prepare(`ALTER TABLE ${m.table} ADD COLUMN ${m.col} ${m.def}`).run(); } catch (e) { /* exists */ }
    }

    // ─── Ensure a default agency exists (seeded from env / legacy settings) ──
    const defaultAgencyName = process.env.AGENCY_NAME || 'PropMind Real Estate';
    const defaultAgencySlug = process.env.AGENCY_SLUG
        || defaultAgencyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
        || 'propmind';
    const defaultContact = process.env.AGENT_EMAIL || process.env.AGENT_WHATSAPP_NUMBER || process.env.AGENCY_WHATSAPP || '';
    await db.prepare(`
        INSERT OR IGNORE INTO agencies (slug, name, whatsapp, contact)
        VALUES (?, ?, ?, ?)
    `).run(defaultAgencySlug, defaultAgencyName, defaultContact, defaultContact);
    const defaultAgency = await db.prepare(`SELECT * FROM agencies ORDER BY id ASC LIMIT 1`).get();

    // Idempotent contact fill: a redeploy with AGENT_EMAIL set must activate
    // email notifications even if an older boot already created the row empty.
    if (defaultAgency && !defaultAgency.contact) {
        await db.prepare(`UPDATE agencies SET contact = ? WHERE id = ?`).run(defaultContact, defaultAgency.id);
    }

    // Backfill legacy rows so nothing is left orphaned
    await db.prepare(`
        UPDATE properties SET agency_id = ? WHERE agency_id IS NULL
    `).run(defaultAgency.id);
    await db.prepare(`
        UPDATE leads SET agency_id = ? WHERE agency_id IS NULL
    `).run(defaultAgency.id);
    await db.prepare(`
        UPDATE agencies SET contact = whatsapp WHERE (contact IS NULL OR contact = '') AND whatsapp IS NOT NULL AND whatsapp != ''
    `).run();

    try {
        await db.prepare(`CREATE TABLE IF NOT EXISTS launches (
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

    await db.exec(`
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

    await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_silence_lead
            ON silence_profiles(lead_id)
    `).run();
    await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_silence_dismissed
            ON silence_profiles(dismissed)
    `).run();

    const propertyCount = (await db.prepare(`SELECT COUNT(*) as count FROM properties`).get()).count;
    const leadCount = (await db.prepare(`SELECT COUNT(*) as count FROM leads`).get()).count;
    if (propertyCount === 0 && fs.existsSync(SEED_FILE)) {
        try {
            const seedData = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
            const stmt = db.prepare('INSERT INTO properties (type, title, area, price, bedrooms, description, availability, agency_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            for (const p of seedData) {
                await stmt.run(p.type, p.title, p.area, p.price, p.bedrooms, p.description, 'Available now', defaultAgency.id);
            }
            console.log(`  Seeded ${seedData.length} properties from seed-data.json`);
            persistenceInfo.seeded = true;
        } catch (e) { console.error('Seed failed:', e.message); }
    }

    const finalPropCount = (await db.prepare(`SELECT COUNT(*) as count FROM properties`).get()).count;
    persistenceInfo.propertyCount = finalPropCount;
    persistenceInfo.leadCount = leadCount;

    console.log(`  ✓ DATA PRESERVED — ${finalPropCount} properties, ${leadCount} leads. No overwrite.`);

    const agencyRow = await db.prepare(`SELECT value FROM settings WHERE key = 'agency_name'`).get();
    if (!agencyRow) {
        await db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('agency_name', ?)`)
          .run(process.env.AGENCY_NAME || 'PropMind Real Estate');
    }

    persistenceInfo.dbExists = IS_TURSO ? true : fs.existsSync(clientUrl.replace(/^file:/, ''));
    if (!IS_TURSO && persistenceInfo.dbExists) {
        try { persistenceInfo.dbSizeBytes = fs.statSync(clientUrl.replace(/^file:/, '')).size; } catch (e) { /* ignore */ }
    }

    dbReady = true;
    console.log('════════════════════════════════════════════════════════════');
    console.log('  DATABASE READY — serving requests allowed');
    console.log(`    Target: ${dbPath}`);
    console.log(`    Properties: ${persistenceInfo.propertyCount} | Leads: ${persistenceInfo.leadCount}`);
    console.log('════════════════════════════════════════════════════════════');
}

db.ready = initDb();
db.ready.catch((e) => {
    console.error('DATABASE INIT FAILED:', e.message);
});

function gracefulShutdown() {
    try {
        console.log('Closing database...');
        db.close();
        console.log('Database closed cleanly.');
    } catch (e) {
        console.error('Error during database shutdown:', e.message);
    }
}

process.on('SIGINT', () => { gracefulShutdown(); process.exit(0); });
process.on('SIGTERM', () => { gracefulShutdown(); process.exit(0); });

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

module.exports = { db, parseBudget, initDb };
