const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../database');

const PARSE_LISTINGS_PROMPT = `You extract Dubai real estate listings from unstructured paste text (Property Finder, Bayut, emails, WhatsApp, etc.).
Return ONLY valid JSON — no markdown, no explanation:
{
  "listings": [
    {
      "type": "Rent" or "Sale",
      "title": "e.g. Studio Apartment, 1BR Villa",
      "area": "Dubai area/neighborhood",
      "price": "e.g. AED 65,000/yr or AED 950,000",
      "bedrooms": "Studio, 1BR, 2BR, etc.",
      "description": "key features in one line"
    }
  ]
}
Rules:
- Extract every distinct property mentioned.
- type must be exactly "Rent" or "Sale".
- If rent vs sale unclear, infer from price format (/yr = Rent).
- Never invent properties not in the text.
- If a field is missing, use best guess from context or "—".`;

async function parseListingsWithGemini(rawText) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
        model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 }
    });
    const result = await model.generateContent(`${PARSE_LISTINGS_PROMPT}\n\n---\nPASTED TEXT:\n${rawText}`);
    return result.response.text();
}

router.post('/login', (req, res) => {
    const { username, password } = req.body;
    const adminUser = (process.env.ADMIN_USERNAME || 'admin').trim();
    const adminPass = (process.env.ADMIN_PASSWORD || 'admin123').trim();
    
    const inputUser = (username || '').trim();
    const inputPass = (password || '').trim();
    
    if (inputUser === adminUser && inputPass === adminPass) {
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
        const info = db.prepare(`INSERT INTO properties (type, title, area, price, bedrooms, description, availability) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(type, title, area, price, bedrooms, description, availability || 'Available now');
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
        console.error('Failed to add property:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ─── Smart Paste — AI extract from Property Finder text ─────────────────────
router.post('/properties/parse-paste', async (req, res) => {
    const { rawText } = req.body;
    if (!rawText || !String(rawText).trim()) {
        return res.status(400).json({ error: 'rawText required' });
    }
    if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: 'GEMINI_API_KEY not configured. Get a free key at https://aistudio.google.com/apikey' });
    }

    try {
        const text = (await parseListingsWithGemini(String(rawText).trim())).trim();
        const jsonStart = text.indexOf('{');
        const jsonEnd = text.lastIndexOf('}');
        if (jsonStart === -1 || jsonEnd === -1) {
            return res.status(422).json({ error: 'AI could not parse listings. Try pasting more detail.' });
        }

        const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
        const listings = (parsed.listings || []).map(l => ({
            type: l.type === 'Sale' ? 'Sale' : 'Rent',
            title: l.title || 'Property',
            area: l.area || 'Dubai',
            price: l.price || '—',
            bedrooms: l.bedrooms || '—',
            description: l.description || '',
            availability: 'Available now'
        }));

        res.json({ listings, count: listings.length });
    } catch (err) {
        console.error('Parse paste error:', err.message);
        res.status(500).json({ error: 'Failed to parse listings: ' + err.message });
    }
});

router.post('/properties/bulk', (req, res) => {
    const { listings } = req.body;
    if (!Array.isArray(listings) || listings.length === 0) {
        return res.status(400).json({ error: 'listings array required' });
    }
    try {
        const stmt = db.prepare(`
            INSERT INTO properties (type, title, area, price, bedrooms, description, availability)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const insertAll = db.transaction((rows) => {
            const ids = [];
            for (const l of rows) {
                const info = stmt.run(
                    l.type === 'Sale' ? 'Sale' : 'Rent',
                    l.title || 'Property',
                    l.area || 'Dubai',
                    l.price || '—',
                    l.bedrooms || '—',
                    l.description || '',
                    l.availability || 'Available now'
                );
                ids.push(info.lastInsertRowid);
            }
            return ids;
        });
        const ids = insertAll(listings);
        res.json({ success: true, saved: ids.length, ids });
    } catch (err) {
        console.error('Bulk save error:', err);
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
