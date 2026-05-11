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
    db.all(`SELECT * FROM leads ORDER BY date DESC`, [], (err, rows) => {
        if (err) {
            console.error('Failed to get leads:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ leads: rows });
    });
});

router.post('/leads/:id/status', (req, res) => {
    const { status } = req.body;
    db.run(`UPDATE leads SET status = ? WHERE id = ?`, [status, req.params.id], function(err) {
        if (err) {
            console.error('Failed to update lead status:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true });
    });
});

router.get('/stats', (req, res) => {
    // Basic stats: total leads this week, conversion rate, hot leads count
    // For simplicity we will consider URGENT and EXCITED as hot
    const queries = {
        total: new Promise((resolve, reject) => {
            db.get(`SELECT COUNT(*) as count FROM leads WHERE date >= date('now', '-7 days')`, (err, row) => err ? reject(err) : resolve(row.count));
        }),
        hot: new Promise((resolve, reject) => {
            db.get(`SELECT COUNT(*) as count FROM leads WHERE psychology_notes LIKE '%URGENT%' OR psychology_notes LIKE '%EXCITED%' OR psychology_notes LIKE '%HOT%'`, (err, row) => err ? reject(err) : resolve(row.count));
        }),
        closed: new Promise((resolve, reject) => {
            db.get(`SELECT COUNT(*) as count FROM leads WHERE status = 'Closed'`, (err, row) => err ? reject(err) : resolve(row.count));
        })
    };

    Promise.all([queries.total, queries.hot, queries.closed])
        .then(([total, hot, closed]) => {
            const conversionRate = total > 0 ? Math.round((closed / total) * 100) : 0;
            res.json({ total, hot, conversionRate });
        })
        .catch(err => {
            console.error('Failed to get stats:', err);
            res.status(500).json({ error: 'Database error' });
        });
});

// Property Management
router.get('/properties', (req, res) => {
    db.all(`SELECT * FROM properties ORDER BY date DESC`, [], (err, rows) => {
        if (err) {
            console.error('Failed to get properties:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ properties: rows });
    });
});

router.post('/properties', (req, res) => {
    const { type, title, area, price, bedrooms, description, availability } = req.body;
    const query = `INSERT INTO properties (type, title, area, price, bedrooms, description, availability) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    db.run(query, [type, title, area, price, bedrooms, description, availability], function(err) {
        if (err) {
            console.error('Failed to add property:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true, id: this.lastID });
    });
});

router.delete('/properties/:id', (req, res) => {
    db.run(`DELETE FROM properties WHERE id = ?`, [req.params.id], function(err) {
        if (err) {
            console.error('Failed to delete property:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true });
    });
});

module.exports = router;
