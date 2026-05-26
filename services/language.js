const Anthropic = require('@anthropic-ai/sdk');
const logger = require('./logger');

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

const SUPPORTED_LANGUAGES = {
    en: 'English', ar: 'Arabic', ru: 'Russian', zh: 'Chinese',
    fr: 'French', es: 'Spanish', de: 'German', ur: 'Urdu',
    hi: 'Hindi', pt: 'Portuguese', tr: 'Turkish', fa: 'Farsi / Persian',
    it: 'Italian', nl: 'Dutch', he: 'Hebrew', ms: 'Malay',
    id: 'Indonesian', ta: 'Tamil', bn: 'Bengali',
    fil: 'Filipino / Tagalog', sw: 'Swahili', th: 'Thai'
};

async function detectLanguage(text) {
    const textSample = text.slice(0, 500).trim();
    if (!textSample) return { code: 'en', name: 'English' };

    logger.logEvent('language', { action: 'detect_start', textLength: textSample.length });

    try {
        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 100,
            temperature: 0,
            system: `You detect languages. Return ONLY a JSON object with two fields: "code" (ISO 639-1) and "name" (full language name). Use one of: ${JSON.stringify(SUPPORTED_LANGUAGES)}. If unsure, return {"code":"en","name":"English"}.`,
            messages: [{ role: 'user', content: `Detect the language of this text:\n\n${textSample}` }]
        });

        const raw = response.content[0].text.trim();
        let parsed;
        try {
            const start = raw.indexOf('{');
            const end = raw.lastIndexOf('}');
            parsed = start !== -1 && end !== -1 ? JSON.parse(raw.slice(start, end + 1)) : { code: 'en', name: 'English' };
        } catch (e) {
            parsed = { code: 'en', name: 'English' };
        }

        const result = { code: parsed.code || 'en', name: SUPPORTED_LANGUAGES[parsed.code] || parsed.name || 'English' };
        logger.logEvent('language', { action: 'detect_complete', detected: result.code, name: result.name });
        return result;
    } catch (err) {
        logger.logEvent('language', { action: 'detect_error', error: err.message });
        return { code: 'en', name: 'English' };
    }
}

async function translateToEnglish(text) {
    if (!text || !text.trim()) return '';

    try {
        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 500,
            temperature: 0,
            system: 'Translate the following text to English. Return ONLY the translated text, nothing else.',
            messages: [{ role: 'user', content: text.slice(0, 2000) }]
        });
        return response.content[0].text.trim();
    } catch (err) {
        logger.logEvent('language', { action: 'translate_error', error: err.message });
        return text;
    }
}

module.exports = { detectLanguage, translateToEnglish, SUPPORTED_LANGUAGES };
