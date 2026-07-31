// ─── WHATSAPP CREDENTIAL CHECK ─────────────────────────────────────────────
// Verifies WHATSAPP_TOKEN + WHATSAPP_PHONE_ID against Meta's Graph API and
// optionally sends a real test message so you know lead alerts will arrive.
//   Run: node scripts/test-whatsapp.js                (check only)
//        node scripts/test-whatsapp.js --to +9715XXXX  (check + send test)

require('dotenv').config();
const { verifyCredentials, sendText, isConfigured } = require('../services/whatsapp');

async function main() {
    const to = process.argv.includes('--to')
        ? process.argv[process.argv.indexOf('--to') + 1]
        : process.env.AGENT_WHATSAPP_NUMBER;

    console.log('── WhatsApp Cloud API credential check ──');

    if (!isConfigured()) {
        console.log('\nNOT CONFIGURED: set WHATSAPP_TOKEN + WHATSAPP_PHONE_ID in .env');
        console.log('See README.md → WhatsApp setup, or ask the assistant for step-by-step.');
        return process.exit(1);
    }

    const res = await verifyCredentials();
    if (!res.ok) {
        console.log('\n[FAIL] Meta rejected the credentials:');
        console.log('   ', res.error || JSON.stringify(res.details || ''));
        const code = res.details && res.details.code;
        if (code === 190) console.log('   → Token invalid/expired. Generate a fresh one in the Meta dashboard.');
        if (code === 100) console.log('   → Phone ID wrong. Copy it from Meta App → WhatsApp → API Setup.');
        return process.exit(1);
    }

    console.log(`\n[OK] Connected to "${res.name}" — ${res.displayPhoneNumber}`);

    if (!to) {
        console.log('\nNo test recipient. Pass --to +9715XXXXXXXX to send a real message.');
        return;
    }

    const sent = await sendText(to, 'PropMind test message — WhatsApp alerts are working.');
    if (sent.success) {
        console.log(`\n[OK] Test message delivered to ${sent.to} (waId=${sent.waId})`);
    } else {
        console.log(`\n[WARN] Send failed: ${sent.error}`);
        if (/24[- ]hour/.test(sent.error || '')) {
            console.log('   → Free-form messages only work inside a 24h window or with test recipients.');
            console.log('     Add the number as a test recipient, or send an approved template.');
        }
    }
}

main().catch(err => { console.error(err); process.exit(1); });
