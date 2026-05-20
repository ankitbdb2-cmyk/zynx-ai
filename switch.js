#!/usr/bin/env node
const agencies = require('./demo-agencies.json');
const BASE = 'https://zynx-ai.onrender.com';

async function switchAgency(num) {
    const data = agencies[num];
    if (!data) {
        console.log('\n❌ Invalid number. Pick 1-23:\n');
        Object.entries(agencies).forEach(([k, v]) => console.log(`  ${k.padStart(2)}. ${v.name}`));
        process.exit(1);
    }

    console.log(`\n🔄 Switching to: ${data.name}\n`);

    // 1. Update agency name
    await fetch(BASE + '/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'agency_name', value: data.name })
    });
    console.log(`✅ Agency name → ${data.name}`);

    // 2. Delete all existing properties
    const existing = await fetch(BASE + '/api/admin/properties').then(r => r.json());
    for (const p of existing.properties) {
        await fetch(BASE + '/api/admin/properties/' + p.id, { method: 'DELETE' });
    }
    console.log(`🗑️  Cleared ${existing.properties.length} old listings`);

    // 3. Add new listings
    for (const listing of data.listings) {
        await fetch(BASE + '/api/admin/properties', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...listing, availability: 'Available' })
        });
        console.log(`  ➕ ${listing.title} | ${listing.price}`);
    }

    console.log(`\n✅ DONE — ${data.name} is now live with ${data.listings.length} listings`);
    console.log(`🌐 https://zynx-ai.onrender.com\n`);
}

// Show menu if no argument
const arg = process.argv[2];
if (!arg) {
    console.log('\n📋 DEMO AGENCY SWITCHER\n');
    console.log('Usage: node switch.js <number>\n');
    Object.entries(agencies).forEach(([k, v]) =>
        console.log(`  ${k.padStart(2)}. ${v.name} (${v.listings.length} listings)`)
    );
    console.log('\nExample: node switch.js 1  →  switches to IMARA\n');
} else {
    switchAgency(arg).catch(e => console.error('Error:', e.message));
}
