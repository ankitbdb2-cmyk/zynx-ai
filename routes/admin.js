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
        const rows = db.prepare(`SELECT * FROM leads ORDER BY hot_score DESC, date DESC`).all();
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
        const hotRow = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE hot_score >= 7`).get();
        const bookedRow = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE status IN ('Visit Scheduled', 'Closed') OR viewing_confirmed = 1`).get();
        const allRow = db.prepare(`SELECT COUNT(*) as count FROM leads`).get();
        
        const total = totalRow.count;
        const hot = hotRow.count;
        const booked = bookedRow.count;
        const allTime = allRow.count;
        
        const conversionRate = allTime > 0 ? Math.round((booked / allTime) * 100) : 0;
        res.json({ total, hot, conversionRate, allTime });
    } catch (err) {
        console.error('Failed to get stats:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ─── Weekly Analytics Report ────────────────────────────────────────────────
router.get('/analytics/weekly', (req, res) => {
    try {
        const totalLeads = db.prepare(`
            SELECT COUNT(*) as count FROM leads WHERE date >= datetime('now', '-7 days')
        `).get().count;

        const bookedViewings = db.prepare(`
            SELECT COUNT(*) as count FROM leads
            WHERE date >= datetime('now', '-7 days')
            AND (status IN ('Visit Scheduled', 'Closed') OR viewing_confirmed = 1)
        `).get().count;

        const conversionRate = totalLeads > 0 ? Math.round((bookedViewings / totalLeads) * 100) : 0;

        const hotContacted = db.prepare(`
            SELECT COUNT(*) as count FROM leads
            WHERE date >= datetime('now', '-7 days') AND hot_score >= 8
            AND status IN ('Contacted', 'Visit Scheduled', 'Closed')
        `).get().count;

        const hotMissed = db.prepare(`
            SELECT COUNT(*) as count FROM leads
            WHERE date >= datetime('now', '-7 days') AND hot_score >= 8
            AND status = 'New'
        `).get().count;

        const commissionRow = db.prepare(`SELECT value FROM settings WHERE key = 'weekly_commission'`).get();
        const commission = commissionRow ? parseFloat(commissionRow.value) || 0 : 0;

        const leadsByDay = db.prepare(`
            SELECT strftime('%Y-%m-%d', date) as day, COUNT(*) as count
            FROM leads WHERE date >= datetime('now', '-7 days')
            GROUP BY strftime('%Y-%m-%d', date) ORDER BY day ASC
        `).all();

        const funnel = {
            captured: totalLeads,
            hot: db.prepare(`SELECT COUNT(*) as count FROM leads WHERE date >= datetime('now', '-7 days') AND hot_score >= 8`).get().count,
            contacted: hotContacted,
            booked: bookedViewings
        };

        const stageBreakdown = db.prepare(`
            SELECT COALESCE(lead_stage, 'Cold') as stage, COUNT(*) as count
            FROM leads WHERE date >= datetime('now', '-7 days')
            GROUP BY lead_stage
        `).all();

        res.json({
            totalLeads,
            bookedViewings,
            conversionRate,
            hotContacted,
            hotMissed,
            commission,
            leadsByDay,
            funnel,
            stageBreakdown
        });
    } catch (err) {
        console.error('Failed to get weekly analytics:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

router.post('/analytics/commission', (req, res) => {
    const { amount } = req.body;
    if (amount === undefined || isNaN(Number(amount))) {
        return res.status(400).json({ error: 'Valid amount required' });
    }
    try {
        db.prepare(`INSERT INTO settings (key, value) VALUES ('weekly_commission', ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
          .run(String(amount));
        res.json({ success: true, commission: parseFloat(amount) });
    } catch (err) {
        console.error('Failed to save commission:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ─── Availability Calendar ────────────────────────────────────────────────────
router.get('/availability', (req, res) => {
    try {
        const slots = db.prepare(`
            SELECT s.*, l.name as lead_name
            FROM availability_slots s
            LEFT JOIN leads l ON s.lead_id = l.id
            ORDER BY s.slot_datetime ASC
        `).all();
        res.json({ slots });
    } catch (err) {
        console.error('Failed to get availability:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

router.post('/availability', (req, res) => {
    const { slot_datetime, label } = req.body;
    if (!slot_datetime) return res.status(400).json({ error: 'slot_datetime required' });
    try {
        const info = db.prepare(`
            INSERT INTO availability_slots (slot_datetime, label) VALUES (?, ?)
        `).run(slot_datetime, label || '');
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
        console.error('Failed to add slot:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

router.delete('/availability/:id', (req, res) => {
    try {
        const slot = db.prepare(`SELECT is_booked FROM availability_slots WHERE id = ?`).get(req.params.id);
        if (!slot) return res.status(404).json({ error: 'Slot not found' });
        if (slot.is_booked) return res.status(400).json({ error: 'Cannot delete a booked slot' });
        db.prepare(`DELETE FROM availability_slots WHERE id = ?`).run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('Failed to delete slot:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

router.get('/viewings', (req, res) => {
    try {
        const viewings = db.prepare(`
            SELECT l.id, l.name, l.phone, l.area, l.hot_score, l.status,
                   s.slot_datetime, s.label, s.id as slot_id
            FROM leads l
            JOIN availability_slots s ON l.viewing_slot_id = s.id
            WHERE l.viewing_confirmed = 1
            ORDER BY s.slot_datetime DESC
        `).all();
        res.json({ viewings });
    } catch (err) {
        console.error('Failed to get viewings:', err);
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
