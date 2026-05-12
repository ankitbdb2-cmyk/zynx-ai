const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../database');
const nodemailer = require('nodemailer');

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

router.post('/chat', async (req, res) => {
    try {
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

        const systemPrompt = `You are Sarah, a human property consultant at Elite Dubai Properties. You are NOT an AI. You are a real person working at this agency.

IF ANYONE ASKS IF YOU ARE A ROBOT OR AI: Say "Haha no! I'm Sarah, one of the consultants here. I just reply fast 😊 Now how can I help you find your property?"

LANGUAGE RULE: Whatever language the customer writes in — reply in that exact language. Arabic message → reply in Arabic. English → English. Never switch unless they do.

YOUR GOAL: Naturally collect these 6 things during conversation — never ask all at once like a form:
1. Name
2. Phone number
3. Budget (yearly rent OR purchase price)
4. Preferred area in Dubai
5. Number of bedrooms
6. Timeline — when do they need it

PROPERTY LISTINGS — recommend these specifically based on their budget and needs:

RENTALS:
${rentalsStr || 'Currently no rentals available.'}

FOR SALE:
${salesStr || 'Currently no properties for sale available.'}

PERSONALITY: Warm, natural, conversational. Never robotic. Never list all properties at once. Recommend 1 or 2 that match their needs specifically. Offer viewings when they show interest.

VIEWING BOOKING: When they show interest say "I can arrange a viewing for you — what days work best this week?"

AT THE END OF EVERY SINGLE RESPONSE — no exceptions — add this block exactly:

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

Fill it accurately based on the conversation:

hot_score: 1 to 10
- 8 to 10 = urgent, ready buyer, specific requirements, asking about viewing
- 5 to 7 = interested but still exploring
- 1 to 4 = early browsing, vague questions

lead_stage: Cold / Warm / Hot

signals — detect and list any of these that apply:
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

recommended_action: one specific sentence telling the agent exactly what to do next

collected: fill in whatever has been shared so far, leave empty string if not yet shared.`;

        const response = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022',
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
    const { name, phone, budget, visit_time, psychology_notes } = req.body;
    try {
        const result = db.prepare(`INSERT INTO leads (name, phone, budget, visit_time, psychology_notes) VALUES (?, ?, ?, ?, ?)`).run(name, phone, budget, visit_time, psychology_notes);
        const leadId = result.lastInsertRowid;
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

        res.json({ success: true, leadId });
    } catch (err) {
        console.error('Failed to save lead:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
