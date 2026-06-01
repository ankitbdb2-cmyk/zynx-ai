// ─── LAUNCH MODE ENGINE ─────────────────────────────────────────────────────
// Synchronous only — all DB calls use better-sqlite3 (no async/await)

function getLaunchMode(db) {
    const launch = db.prepare(`
        SELECT * FROM launches
        WHERE active = 1
          AND (expires_at IS NULL OR expires_at > datetime('now'))
        ORDER BY created_at DESC
        LIMIT 1
    `).get();
    return launch || null;
}

function activateLaunch(db, launchData) {
    // Step 1 — deactivate any currently active launch
    db.prepare('UPDATE launches SET active = 0 WHERE active = 1').run();

    // Step 2 — insert new launch with 72-hour auto-expiry
    const result = db.prepare(`
        INSERT INTO launches
            (developer, project, payment_plan, handover_date,
             price_floor, golden_visa, roi_projection, notes,
             active, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', '+72 hours'))
    `).run(
        launchData.developer,
        launchData.project,
        launchData.payment_plan || '',
        launchData.handover_date || '',
        launchData.price_floor || 0,
        launchData.golden_visa ? 1 : 0,
        launchData.roi_projection || '',
        launchData.notes || ''
    );

    // Step 3 — return the full inserted record
    return db.prepare('SELECT * FROM launches WHERE id = ?')
             .get(result.lastInsertRowid);
}

function deactivateLaunch(db, launchId) {
    db.prepare('UPDATE launches SET active = 0 WHERE id = ?').run(launchId);
    return { deactivated: true, id: launchId };
}

function extendLaunch(db, launchId, hours) {
    hours = parseInt(hours) || 24;
    db.prepare(
        `UPDATE launches SET expires_at = datetime(expires_at, '+${hours} hours')
         WHERE id = ?`
    ).run(launchId);
    return { extended: true, id: launchId, hoursAdded: hours };
}

function checkAndExpireLaunches(db) {
    const expired = db.prepare(`
        SELECT id FROM launches
        WHERE active = 1
          AND expires_at IS NOT NULL
          AND expires_at < datetime('now')
    `).all();

    for (const row of expired) {
        db.prepare('UPDATE launches SET active = 0 WHERE id = ?').run(row.id);
    }

    return { expired: expired.length };
}

function buildLaunchOverlay(launch) {
    const goldenVisaLine = launch.golden_visa
        ? 'Golden Visa Eligible: YES — units above AED 2,000,000 qualify'
        : 'Golden Visa Eligible: Not applicable for this project';

    const roiLine = launch.roi_projection
        ? `Projected ROI: ${launch.roi_projection}`
        : '';

    const notesLine = launch.notes
        ? `Additional context: ${launch.notes}`
        : '';

    const priceLine = launch.price_floor
        ? `Starting from: AED ${Number(launch.price_floor).toLocaleString()}`
        : 'Pricing: Contact agency for current availability';

    return [
        '=== LAUNCH MODE ACTIVE ===',
        `Developer: ${launch.developer}`,
        `Project: ${launch.project}`,
        `Payment Plan: ${launch.payment_plan || 'Contact agency for details'}`,
        `Expected Handover: ${launch.handover_date || 'TBC'}`,
        priceLine,
        goldenVisaLine,
        roiLine,
        notesLine,
        '',
        'LAUNCH MODE INSTRUCTIONS:',
        'The buyer contacting you has very likely already attended the developer',
        'presentation or roadshow for this project. They know the project.',
        'They have contacted multiple agencies in the same 15-minute window.',
        '',
        'CRITICAL BEHAVIORS IN LAUNCH MODE:',
        '- Do NOT ask generic discovery questions like "What area are you interested in?"',
        '  They already chose the project. Your job is to win the agency comparison.',
        '- Reference the developer and project by name in your first response.',
        '- Focus qualification on: unit type preference, floor level, payment structure.',
        '- If buyer mentions showroom, developer event, or launch: acknowledge it directly.',
        '  Example: "Yes, I have full details on [project] — I can walk you through',
        '  exactly what was covered at the presentation and go deeper on the specifics."',
        '- If budget is above AED 2,000,000 and project is Golden Visa eligible:',
        '  mention Golden Visa proactively, framed as information not sales pressure.',
        '  Example: "Worth noting — this project qualifies for the UAE Golden Visa',
        '  programme, which some buyers find useful context at this price point."',
        '- Decision window is compressed. Buyer decides within 24 hours.',
        '  Move to specifics immediately. Do not use slow discovery sequences.',
        '=== END LAUNCH MODE ===',
    ].filter(line => line !== null && line !== undefined)
     .join('\n');
}

function getLaunchScoringAdjustments(db) {
    const launch = getLaunchMode(db);

    if (!launch) return { active: false };

    return {
        active: true,
        launchId: launch.id,
        project: launch.project,
        developer: launch.developer,
        goldenVisa: launch.golden_visa === 1,
        priceFloor: launch.price_floor,
        showroomAutoHot: true,
        paymentPlanBonus: 3,
        questionVolumeMultiplier: 1.5,
        urgencyBonus: 2
    };
}

module.exports = {
    getLaunchMode,
    activateLaunch,
    deactivateLaunch,
    extendLaunch,
    checkAndExpireLaunches,
    buildLaunchOverlay,
    getLaunchScoringAdjustments
};
