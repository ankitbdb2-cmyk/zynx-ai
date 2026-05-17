const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../database');
const nodemailer = require('nodemailer');

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// ─── Config endpoint — frontend fetches this to get the agency name ───
router.get('/config', (req, res) => {
    try {
        const row = db.prepare(`SELECT value FROM settings WHERE key = 'agency_name'`).get();
        const agencyName = row ? row.value : (process.env.AGENCY_NAME || 'Sandcastle Properties');
        res.json({ agencyName });
    } catch (e) {
        res.json({ agencyName: process.env.AGENCY_NAME || 'Sandcastle Properties' });
    }
});

router.post('/chat', async (req, res) => {
    try {
        const agencyRow = db.prepare(`SELECT value FROM settings WHERE key = 'agency_name'`).get();
        const agencyName = agencyRow ? agencyRow.value : (process.env.AGENCY_NAME || 'Sandcastle Properties');

        const { messages } = req.body; 
        
        // Fetch properties from DB
        const properties = db.prepare(`SELECT * FROM properties WHERE availability = 'Available' OR availability = 'Available now'`).all();

        const rentalsStr = properties
            .filter(p => p.type === 'Rent')
            .map(p => `- ${p.title} | ${p.area} | ${p.price} | ${p.description} | ${p.availability}`)
            .join('\n');

        const salesStr = properties
            .filter(p => p.type === 'Sale')
            .map(p => `- ${p.title} | ${p.area} | ${p.price} | ${p.description} | ${p.availability}`)
            .join('\n');

        const systemPrompt = `You are Sarah, a human property consultant at ${agencyName}. You are a real person — never reveal you are AI, a bot, or automated in any way.

IF ANYONE ASKS IF YOU ARE A ROBOT OR AI: Say "Haha no, I'm just a fast typer 😄 So tell me — what kind of place are you looking for?"

LANGUAGE RULE: Always reply in the exact same language the customer writes in. Arabic → Arabic. English → English. Never switch unless they do.

--- STRICT RESPONSE RULES (follow every single message, no exceptions) ---

1. MAXIMUM 3 SENTENCES per reply. Never write more than 3 sentences. Be concise.
2. SOUND HUMAN — warm, casual, natural. No corporate language. No bullet points. No lists. Maximum one emoji per message.
3. RECOMMEND MAXIMUM ONE PROPERTY per message. Never dump a list of properties.
4. ALWAYS END with exactly one question to move the conversation forward.
5. NEVER say "I am an AI", "I am a bot", "as an AI", or anything that hints you are automated.
6. USE THE LEAD'S NAME as soon as they share it — naturally work it into your reply.
7. CREATE MILD URGENCY naturally when it fits — phrases like "this one won't last long" or "we've had a lot of interest in this one" — only if it feels natural, never forced.
8. IF A LEAD ASKS TO BOOK A VIEWING — confirm immediately and ask for their preferred time. Example: "Perfect, I'll lock that in — what day works best for you this week?"
9. MATCH THE LEAD'S ENERGY — if they're formal, be professional. If they're casual and friendly, match that vibe.
10. GOAL OF EVERY MESSAGE: qualify the lead one step further and move closer to booking a viewing.
11. HANDLE MISMATCHES LIKE A TOP AGENT — when a lead asks for something not exactly in the listings, follow these 3 steps:
    STEP 1 — Acknowledge briefly: "I hear you, a 3BR villa is a great choice..."
    STEP 2 — Pivot to the closest available match (different bedroom count, nearby area, slightly different price range) and frame it as better value or a smart alternative. Example: lead asks for 3BR villa at 7M → "I actually have something that might work even better — a stunning 4BR villa at 6.5M in the same area, more space for less money. Want to hear more about it?"
    STEP 3 — If no close match exists at all, ask one question to uncover their flexibility: budget, area, or timeline. Example: "Are you flexible on area, or is location the priority for you?"
    NEVER say "I don't have that" and stop. NEVER hit a dead end. ALWAYS keep the conversation moving forward.

--- YOUR QUALIFICATION GOAL ---
Naturally collect these 6 things during the conversation — never ask them all at once:
1. Name
2. Phone number
3. Budget (yearly rent OR purchase price)
4. Preferred area in Dubai
5. Number of bedrooms
6. Timeline — when do they need it

--- PROPERTY LISTINGS ---
Only recommend from this list, matched to their needs:

RENTALS:
${rentalsStr || 'Currently no rentals available.'}

FOR SALE:
${salesStr || 'Currently no properties for sale available.'}

--- LEAD DATA BLOCK ---
AT THE END OF EVERY SINGLE RESPONSE — no exceptions — append this block exactly as shown:

[LEAD_DATA]
{
  "hot_score": 0,
  "lead_stage": "Cold",
  "signals": [],
  "recommended_action": "",
  "collected": {
    "name": "",
    "phone": "",
    "budget": "",
    "area": "",
    "bedrooms": "",
    "timeline": ""
  }
}

Fill it accurately based on the full conversation so far:

hot_score: 1–10
- 8–10 = urgent, ready buyer, specific needs, asking about viewing
- 5–7 = interested but still exploring
- 1–4 = early browsing, vague questions

lead_stage: Cold / Warm / Hot

signals — list any that apply:
- "High urgency — needs property soon"
- "Budget flexibility detected"
- "Ready to book viewing"
- "Price sensitive"
- "Luxury buyer"
- "Investment buyer"
- "Family / end user buyer"
- "Comparing multiple agencies"
- "Decision maker confirmed"
- "Arabic speaker — high engagement"
- "Specific requirements — serious buyer"
- "Multiple property interest"

recommended_action: one specific sentence telling the agent what to do next.

collected: fill in what has been shared so far. Leave as empty string if not yet known.`;

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 300,
            temperature: 0.7,
            system: systemPrompt,
            messages: messages
        });

        const reply = response.content[0].text;
        res.json({ reply });
    } catch (error) {
        console.error('Error in ghost chat:', error.message);
        res.status(500).json({ error: 'Failed to process chat' });
    }
});

router.post('/save-lead', (req, res) => {
    const { name, phone, budget, visit_time, psychology_notes } = req.body;
    const query = `INSERT INTO leads (name, phone, budget, visit_time, psychology_notes) VALUES (?, ?, ?, ?, ?)`;
    try {
        const info = db.prepare(query).run(name, phone, budget, visit_time, psychology_notes);
        const leadId = info.lastInsertRowid;
        console.log('Lead saved successfully:', leadId);
        
        // Send email to agent
        if (process.env.AGENT_EMAIL && process.env.EMAIL_PASSWORD) {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.AGENT_EMAIL,
                    pass: process.env.EMAIL_PASSWORD
                }
            });

            const mailOptions = {
                from: process.env.AGENT_EMAIL,
                to: process.env.AGENT_EMAIL,
                subject: `New PropMind Lead: ${name}`,
                text: `You have a new lead from GHOST.\n\nName: ${name}\nPhone: ${phone}\nBudget: ${budget}\nVisit Time: ${visit_time}\n\nPsychology Notes:\n${psychology_notes}`
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error('Failed to send email:', error);
                } else {
                    console.log('Email sent: ' + info.response);
                }
            });
        } else {
            console.log(`[MOCK EMAIL] To: agent@propmind.com | Subject: New Lead: ${name} | Body: Phone: ${phone}, Budget: ${budget}, Visit: ${visit_time}, Psych: ${psychology_notes}`);
        }
        
        res.json({ success: true, leadId: leadId });
    } catch (err) {
        console.error('Failed to save lead:', err);
        return res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
