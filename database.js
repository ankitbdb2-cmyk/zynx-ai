const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, 'propmind.db');
let db;

try {
    db = new Database(dbPath);
    console.log('Connected to the SQLite database.');
    initDb();
} catch (err) {
    console.error('Error connecting to the database:', err.message);
}

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

    try {
        db.exec(createLeadsTable);
        console.log('Leads table initialized.');
    } catch (err) {
        console.error('Error creating leads table:', err.message);
    }

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

    try {
        db.exec(createPropertiesTable);
        console.log('Properties table initialized.');

        // Seed with initial data if empty
        const row = db.prepare(`SELECT COUNT(*) as count FROM properties`).get();
        if (row.count === 0) {
            const seedData = [
                ['Rent', 'Studio', 'International City', 'AED 28,000/yr', 'Studio', 'Budget friendly', 'Available now'],
                ['Rent', 'Studio', 'Dubai Marina', 'AED 65,000/yr', 'Studio', 'Sea view', 'Available now'],
                ['Rent', '1BR', 'Dubai Silicon Oasis', 'AED 45,000/yr', '1BR', 'Tech hub area', 'Available now'],
                ['Sale', 'Studio', 'JVC', 'AED 450,000', 'Studio', 'High ROI investment', 'Available now'],
                ['Sale', '1BR', 'Dubai Marina', 'AED 950,000', '1BR', 'Sea view, ready to move', 'Available now']
            ];
            const stmt = db.prepare(`INSERT INTO properties (type, title, area, price, bedrooms, description, availability) VALUES (?, ?, ?, ?, ?, ?, ?)`);
            seedData.forEach(p => stmt.run(p));
            console.log('Seeded initial properties.');
        }
    } catch (err) {
        console.error('Error creating properties table:', err.message);
    }
}

module.exports = db;
