const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// On Render, use persistent disk so DB survives redeploys
const DATA_DIR = process.env.RENDER
    ? '/opt/render/project/data'
    : __dirname;

// Ensure directory exists (for Render persistent disk)
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const dbPath = path.resolve(DATA_DIR, 'propmind.db');
console.log('Database path:', dbPath);
const db = new Database(dbPath);

console.log('Connected to the SQLite database.');
initDb();

function initDb() {
    const createLeadsTable = `
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
    `;

    db.prepare(createLeadsTable).run();
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

    const createPropertiesTable = `
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
    `;

    db.prepare(createPropertiesTable).run();
    console.log('Properties table initialized.');

    // ── CRITICAL: Only seed if the table is completely empty ──────────────────
    // This prevents overwriting user-added listings on every server restart.
    const countRow = db.prepare(`SELECT COUNT(*) as count FROM properties`).get();
    if (countRow.count === 0) {
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
        
        console.log('Seeded initial properties (first run only).');
    } else {
        console.log(`Skipping seed — ${countRow.count} properties already in database.`);
    }

    // Settings table — key/value store for runtime config
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
}

module.exports = db;
