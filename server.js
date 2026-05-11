require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
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
