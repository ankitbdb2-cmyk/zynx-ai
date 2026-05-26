const OpenAI = require('openai');
const logger = require('./logger');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const SUPPORTED_LANGUAGES = {
    en: 'English',
    ar: 'Arabic',
    ru: 'Russian',
    zh: 'Chinese',
    fr: 'French',
    es: 'Spanish',
    de: 'German',
    ur: 'Urdu',
    hi: 'Hindi',
    pt: 'Portuguese',
    tr: 'Turkish',
    fa: 'Farsi / Persian',
    it: 'Italian',
    nl: 'Dutch',
    he: 'Hebrew',
    ms: 'Malay',
    id: 'Indonesian',
    ta: 'Tamil',
    bn: 'Bengali',
    fil: 'Filipino / Tagalog',
    sw: 'Swahili',
    th: 'Thai'
};

async function detectLanguage(text) {
    const textSample = text.slice(0, 500).trim();
    if (!textSample) {
        return { code: 'en', name: 'English' };
    }

    logger.logEvent('language', { action: 'detect_start', textLength: textSample.length });

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You detect languages. Return ONLY a JSON object with two fields: "code" (ISO 639-1) and "name" (full language name). Use one of: ${JSON.stringify(SUPPORTED_LANGUAGES)}. If unsure, return {"code":"en","name":"English"}.`
                },
                {
                    role: 'user',
                    content: `Detect the language of this text:\n\n${textSample}`
                }
            ],
            max_tokens: 50,
            temperature: 0
        });

        const raw = response.choices[0].message.content.trim();
        let parsed;

        try {
            const start = raw.indexOf('{');
            const end = raw.lastIndexOf('}');
            if (start !== -1 && end !== -1) {
                parsed = JSON.parse(raw.slice(start, end + 1));
            } else {
                throw new Error('No JSON found');
            }
        } catch (e) {
            parsed = { code: 'en', name: 'English' };
        }

        const result = {
            code: parsed.code || 'en',
            name: SUPPORTED_LANGUAGES[parsed.code] || parsed.name || 'English'
        };

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
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'Translate the following text to English. Return ONLY the translated text, nothing else.'
                },
                {
                    role: 'user',
                    content: text.slice(0, 2000)
                }
            ],
            max_tokens: 500,
            temperature: 0
        });

        return response.choices[0].message.content.trim();
    } catch (err) {
        logger.logEvent('language', { action: 'translate_error', error: err.message });
        return text;
    }
}

module.exports = { detectLanguage, translateToEnglish, SUPPORTED_LANGUAGES };
