require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const db      = require('./database');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// ─── Dynamic homepage — SSR agency name into HTML (must be before express.static) ───
app.get('/', (req, res) => {
    try {
        const row = db.prepare(`SELECT value FROM settings WHERE key = 'agency_name'`).get();
        const agencyName = row ? row.value : (process.env.AGENCY_NAME || 'Sandcastle Properties');
        let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
        html = html.split('{{AGENCY_NAME}}').join(agencyName);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.send(html);
    } catch (err) {
        console.error('SSR error:', err.message);
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// Routes
const ghostRoutes = require('./routes/ghost');
const closerRoutes = require('./routes/closer');
const adminRoutes = require('./routes/admin');

app.use('/api/ghost', ghostRoutes);
app.use('/api/closer', closerRoutes);
app.use('/api/admin', adminRoutes);

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
