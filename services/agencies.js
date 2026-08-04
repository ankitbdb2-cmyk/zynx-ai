// ─── AGENCY RESOLUTION ─────────────────────────────────────────────────────
// Multi-tenant helpers. All DB access is async (libSQL client).
// The agencies table is created and backfilled by database.js on startup.

async function getAgencies(db) {
    return db.prepare(`SELECT id, slug, name, whatsapp, contact FROM agencies ORDER BY id ASC`).all();
}

async function getAgencyBySlug(db, slug) {
    if (!slug) return null;
    return db.prepare(`SELECT * FROM agencies WHERE slug = ?`).get(String(slug).trim().toLowerCase());
}

async function getAgencyById(db, id) {
    if (!id) return null;
    return db.prepare(`SELECT * FROM agencies WHERE id = ?`).get(id);
}

async function getDefaultAgency(db) {
    return db.prepare(`SELECT * FROM agencies ORDER BY id ASC LIMIT 1`).get() || null;
}

// Resolve a requested slug to an agency row.
//   - valid slug  → that agency
//   - missing/invalid slug → the default agency (legacy behaviour)
// Always returns an agency object (never throws).
async function resolveAgency(db, slug) {
    const requested = slug ? await getAgencyBySlug(db, slug) : null;
    const agency = requested || await getDefaultAgency(db) || {
        id: null,
        slug: null,
        name: 'PropMind Real Estate',
        whatsapp: '',
        contact: ''
    };
    return {
        agency,
        agencyId: agency.id,
        agencyName: agency.name,
        agencySlug: agency.slug,
        matched: !!requested
    };
}

module.exports = {
    getAgencies,
    getAgencyBySlug,
    getAgencyById,
    getDefaultAgency,
    resolveAgency
};
