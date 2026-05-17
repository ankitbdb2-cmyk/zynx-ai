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
        const totalRow = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE date >= date('now', '-7 days')`).get();
        const hotRow = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE psychology_notes LIKE '%URGENT%' OR psychology_notes LIKE '%EXCITED%' OR psychology_notes LIKE '%HOT%'`).get();
        const closedRow = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE status = 'Closed'`).get();
        
        const total = totalRow.count;
        const hot = hotRow.count;
        const closed = closedRow.count;
        
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
    try {
        const info = db.prepare(`INSERT INTO properties (type, title, area, price, bedrooms, description, availability) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(type, title, area, price, bedrooms, description, availability);
        res.json({ success: true, id: info.lastInsertRowid });
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

// ─── Settings ───────────────────────────────────────────────────────────────
router.get('/settings', (req, res) => {
    try {
        const rows = db.prepare(`SELECT key, value FROM settings`).all();
        const settings = {};
        rows.forEach(r => settings[r.key] = r.value);
        res.json({ settings });
    } catch (err) {
        console.error('Failed to get settings:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

router.post('/settings', (req, res) => {
    const { key, value } = req.body;
    if (!key || value === undefined) return res.status(400).json({ error: 'key and value required' });
    try {
        db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
          .run(key, value);
        res.json({ success: true });
    } catch (err) {
        console.error('Failed to update setting:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
