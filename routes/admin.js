const express = require('express');
const router = express.Router();
const db = require('../database');

router.post('/login', (req, res) => {
    const { username, password } = req.body;
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    
    if (username === adminUser && password === adminPass) {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

router.get('/leads', (req, res) => {
    try {
        const rows = db.prepare(`SELECT * FROM leads ORDER BY date DESC`).all();
        res.json({ leads: rows });
    } catch (err) {
        console.error('Failed to get leads:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

router.post('/leads/:id/status', (req, res) => {
    const { status } = req.body;
    try {
        db.prepare(`UPDATE leads SET status = ? WHERE id = ?`).run(status, req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('Failed to update lead status:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

router.get('/stats', (req, res) => {
    try {
        const total = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE date >= date('now', '-7 days')`).get().count;
        const hot = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE psychology_notes LIKE '%URGENT%' OR psychology_notes LIKE '%EXCITED%' OR psychology_notes LIKE '%HOT%'`).get().count;
        const closed = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE status = 'Closed'`).get().count;
        const conversionRate = total > 0 ? Math.round((closed / total) * 100) : 0;
        res.json({ total, hot, conversionRate });
    } catch (err) {
        console.error('Failed to get stats:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Property Management
router.get('/properties', (req, res) => {
    try {
        const rows = db.prepare(`SELECT * FROM properties ORDER BY date DESC`).all();
        res.json({ properties: rows });
    } catch (err) {
        console.error('Failed to get properties:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

router.post('/properties', (req, res) => {
    const { type, title, area, price, bedrooms, description, availability } = req.body;
    const query = `INSERT INTO properties (type, title, area, price, bedrooms, description, availability) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    try {
        const result = db.prepare(query).run(type, title, area, price, bedrooms, description, availability);
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (err) {
        console.error('Failed to add property:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

router.delete('/properties/:id', (req, res) => {
    try {
        db.prepare(`DELETE FROM properties WHERE id = ?`).run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('Failed to delete property:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
