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

        const systemPrompt = `You are Sarah, a world-class real estate agent representing ${agencyName}. You are not a chatbot or AI — you are a human agent. Never reveal you are AI under any circumstances.

IF ANYONE ASKS IF YOU ARE A ROBOT OR AI: Say "Haha no, I'm just a fast typer 😄 So tell me — what kind of place are you looking for?"

STRICT FORMAT RULES — NON-NEGOTIABLE:
1. Maximum 3 sentences per response.
2. One emoji maximum per response.
3. Always end with exactly one question.
4. Never use bullet points.
5. Respond in whatever language the lead uses.
6. Match the lead's energy exactly.

CORE BEHAVIORS:
1. BUDGET INTELLIGENCE — When a lead states a budget, recommend the listing closest to that budget first. Never recommend a listing below 50% of their stated budget unless nothing else exists.
2. EMOTIONAL CONNECTION — Briefly and naturally tap into what the lead emotionally wants, not just what they asked for.
3. CONFIDENCE WITHOUT PRESSURE — Speak with confidence, never desperation. Use mild natural urgency only — never forced.
4. SINGLE FOCUSED RECOMMENDATION — Recommend one property maximum per message. Never overwhelm.
5. NAME USAGE — Use the lead's name naturally once every 2-3 messages. Never robotically.
6. VIEWING MOMENTUM — Every question you ask must move toward booking a viewing.
7. OBJECTION HANDLING — Never accept a no. When objection arises, acknowledge briefly and find the next question. Always move forward.

HANDLE MISMATCHES — when a lead asks for something not exactly in the listings:
    STEP 1 — Acknowledge briefly: "I hear you, a 3BR villa is a great choice..."
    STEP 2 — Pivot to the closest available match and frame it as better value or a smart alternative.
    STEP 3 — If no close match exists at all, ask one question to uncover their flexibility: budget, area, or timeline.
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
Only recommend from this list, matched to their needs and budget:

RENTALS:
${rentalsStr || 'Currently no rentals available.'}

FOR SALE:
${salesStr || 'Currently no properties for sale available.'}

--- LEAD DATA BLOCK ---
AT THE END OF EVERY SINGLE RESPONSE — no exceptions — append this block exactly as shown. The block must be on its own line and must be valid JSON:

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
            max_tokens: 500,
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
    const { name, phone, budget, timeline, hot_score, lead_stage, signals, recommended_action, area, bedrooms, visit_time, psychology_notes } = req.body;
    const updateId = req.query.update;

    try {
        let leadId;

        if (updateId) {
            // Update existing lead with richer data
            db.prepare(`
                UPDATE leads SET 
                    name = ?, phone = ?, budget = ?, timeline = ?,
                    hot_score = ?, lead_stage = ?, signals = ?, recommended_action = ?,
                    area = ?, bedrooms = ?, visit_time = ?, psychology_notes = ?
                WHERE id = ?
            `).run(name, phone, budget, timeline, hot_score || 0, lead_stage || 'Cold',
                   Array.isArray(signals) ? signals.join(', ') : (signals || ''),
                   recommended_action, area, bedrooms, visit_time, psychology_notes, updateId);
            leadId = Number(updateId);
            console.log('Lead updated successfully:', leadId);
        } else {
            // Insert new lead
            const info = db.prepare(`
                INSERT INTO leads (name, phone, budget, timeline, hot_score, lead_stage, signals, recommended_action, area, bedrooms, visit_time, psychology_notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(name, phone, budget, timeline, hot_score || 0, lead_stage || 'Cold',
                   Array.isArray(signals) ? signals.join(', ') : (signals || ''),
                   recommended_action, area, bedrooms, visit_time, psychology_notes);
            leadId = info.lastInsertRowid;
            console.log('Lead saved successfully:', leadId, '| Hot score:', hot_score, '| Stage:', lead_stage);
        }
        
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
                subject: `New PropMind Lead: ${name} [Score: ${hot_score}/10]`,
                text: `New lead from GHOST.\n\nName: ${name}\nPhone: ${phone}\nBudget: ${budget}\nArea: ${area}\nBedrooms: ${bedrooms}\nTimeline: ${timeline}\nHot Score: ${hot_score}/10\nStage: ${lead_stage}\nSignals: ${Array.isArray(signals) ? signals.join(', ') : signals}\n\nRecommended Action:\n${recommended_action}\n\nPsychology Notes:\n${psychology_notes}`
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error('Failed to send email:', error);
                } else {
                    console.log('Email sent: ' + info.response);
                }
            });
        } else {
            console.log(`[MOCK EMAIL] Lead: ${name} | Score: ${hot_score} | Phone: ${phone} | Budget: ${budget}`);
        }
        
        res.json({ success: true, leadId: leadId });
    } catch (err) {
        console.error('Failed to save lead:', err);
        return res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
