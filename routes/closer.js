const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

router.post('/analyze', async (req, res) => {
    try {
        const { buyerInput, context } = req.body;
        
        const systemPrompt = `You are CLOSER, an elite real estate negotiation co-pilot for agents.
The agent will provide what the buyer just said.
You must instantly give the agent a JSON response with exactly these 4 keys:
{
  "exact_words": "The exact script the agent should say back right now.",
  "psychology": "Psychological insight about what the buyer really means.",
  "tactic": "The negotiation tactic to use right now.",
  "danger_signals": "Any danger signals to watch out for."
}
Keep it short, punchy, and highly effective. DO NOT include any other text besides the JSON.`;

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 300,
            temperature: 0.7,
            system: systemPrompt,
            messages: [
                { role: 'user', content: `Buyer said: "${buyerInput}". Additional context: ${context || 'None'}` }
            ]
        });

        let resultText = response.content[0].text.trim();
        let resultJson;
        try {
            resultJson = JSON.parse(resultText);
        } catch (e) {
            resultText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
            resultJson = JSON.parse(resultText);
        }

        res.json(resultJson);
    } catch (error) {
        console.error('Error in closer analyze:', error.message);
        res.status(500).json({ error: 'Failed to analyze' });
    }
});

router.post('/followup', async (req, res) => {
    try {
        const { sessionHistory } = req.body;
        
        const systemPrompt = `You are an elite real estate assistant. Generate a highly personalized follow-up message (SMS/Email) for a buyer based on the session history. Reference specific things the buyer said to show you listened. End with a strong but polite call to action to close the deal or schedule the next step.
Return only the message text.`;

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 400,
            temperature: 0.7,
            system: systemPrompt,
            messages: [
                { role: 'user', content: `Session History:\n${sessionHistory.join('\n')}` }
            ]
        });

        res.json({ message: response.content[0].text });
    } catch (error) {
        console.error('Error in closer followup:', error.message);
        res.status(500).json({ error: 'Failed to generate followup' });
    }
});

router.post('/emergency', async (req, res) => {
    try {
        const { buyerInput } = req.body;
        
        const systemPrompt = `You are a master real estate closer. The agent pressed the "CLOSE NOW" emergency button.
Give the single most powerful, high-conversion closing script for the exact situation provided.
Just return the script, nothing else. Make it sound natural but compelling.`;

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 200,
            temperature: 0.8,
            system: systemPrompt,
            messages: [
                { role: 'user', content: `Situation: ${buyerInput}` }
            ]
        });

        res.json({ script: response.content[0].text });
    } catch (error) {
        console.error('Error in closer emergency:', error.message);
        res.status(500).json({ error: 'Failed to generate emergency script' });
    }
});

module.exports = router;
