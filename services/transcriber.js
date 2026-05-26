const logger = require('./logger');

// Transcription will be configured per-client when WhatsApp is connected.
// For now, this returns a placeholder indicating the feature is not yet wired.
async function transcribeVoiceNote(audioUrl) {
    logger.logEvent('transcription', {
        action: 'not_configured',
        url: audioUrl,
        note: 'Voice transcription requires OpenAI Whisper or a per-client STT service. No provider configured yet.'
    });

    console.log(`[TRANSCRIBE] Voice note received at ${audioUrl}`);
    console.log('[TRANSCRIBE] No transcription provider configured — would transcribe here.');

    return {
        text: '',
        duration: 0,
        confidence: 0,
        language: 'unknown',
        cost: 0
    };
}

module.exports = { transcribeVoiceNote };
