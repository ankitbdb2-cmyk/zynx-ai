const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, 'propmind.db');
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
            visit_time TEXT,
            psychology_notes TEXT,
            status TEXT DEFAULT 'New',
            date DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;

    db.prepare(createLeadsTable).run();
    console.log('Leads table initialized.');

    const createPropertiesTable = `
        CREATE TABLE IF NOT EXISTS properties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT, -- 'Rent' or 'Sale'
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

    // Seed with initial data if empty
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
        
        // Use a transaction for fast bulk insert
        const insertMany = db.transaction((properties) => {
            for (const p of properties) stmt.run(p);
        });
        insertMany(seedData);
        
        console.log('Seeded initial properties.');
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
