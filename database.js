const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, 'propmind.db');
const db = new Database(dbPath);

console.log('Connected to the SQLite database.');
initDb();

function initDb() {
    db.exec(`
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
    `);
    console.log('Leads table initialized.');

    db.exec(`
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
    `);
    console.log('Properties table initialized.');

    // Seed with initial data if empty
    const count = db.prepare(`SELECT COUNT(*) as count FROM properties`).get().count;
    if (count === 0) {
        const seedData = [
            ['Rent', 'Studio', 'International City', 'AED 28,000/yr', 'Studio', 'Budget friendly', 'Available now'],
            ['Rent', 'Studio', 'Dubai Marina', 'AED 65,000/yr', 'Studio', 'Sea view', 'Available now'],
            ['Rent', '1BR', 'Dubai Silicon Oasis', 'AED 45,000/yr', '1BR', 'Tech hub area', 'Available now'],
            ['Sale', 'Studio', 'JVC', 'AED 450,000', 'Studio', 'High ROI investment', 'Available now'],
            ['Sale', '1BR', 'Dubai Marina', 'AED 950,000', '1BR', 'Sea view, ready to move', 'Available now']
        ];
        const stmt = db.prepare(`INSERT INTO properties (type, title, area, price, bedrooms, description, availability) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        for (const p of seedData) stmt.run(p);
        console.log('Seeded initial properties.');
    }
}

module.exports = db;
