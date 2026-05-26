const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const logger = require('./logger');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const TRANSCRIPTION_TEMP_DIR = path.join(os.tmpdir(), 'propmind-transcriptions');

if (!fs.existsSync(TRANSCRIPTION_TEMP_DIR)) {
    fs.mkdirSync(TRANSCRIPTION_TEMP_DIR, { recursive: true });
}

async function downloadAudio(audioUrl) {
    const ext = path.extname(new URL(audioUrl).pathname) || '.ogg';
    const filename = crypto.randomUUID() + ext;
    const filePath = path.join(TRANSCRIPTION_TEMP_DIR, filename);

    logger.logEvent('transcription', { action: 'download_start', url: audioUrl });

    const response = await fetch(audioUrl, {
        timeout: 30000,
        headers: { 'User-Agent': 'PropMind/1.0' }
    });

    if (!response.ok) {
        throw new Error(`Failed to download audio: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    logger.logEvent('transcription', {
        action: 'download_complete',
        sizeBytes: buffer.length,
        filePath
    });

    return filePath;
}

async function transcribeAudio(audioFilePath) {
    logger.logEvent('transcription', { action: 'transcribe_start', file: audioFilePath });

    const transcription = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file: fs.createReadStream(audioFilePath),
        response_format: 'verbose_json'
    });

    const cost = estimateCost(transcription.duration || 0);

    logger.logEvent('transcription', {
        action: 'transcribe_complete',
        duration: transcription.duration,
        textLength: transcription.text.length,
        cost
    });

    try {
        fs.unlinkSync(audioFilePath);
    } catch (e) {
        logger.logEvent('transcription', { action: 'cleanup_error', error: e.message });
    }

    return {
        text: transcription.text.trim(),
        duration: transcription.duration || 0,
        confidence: transcription.segments
            ? transcription.segments.reduce((a, s) => a + (s.avg_logprob || 0), 0) / transcription.segments.length
            : 0,
        language: transcription.language || 'unknown',
        cost
    };
}

function estimateCost(durationSeconds) {
    const costPerSecond = 0.006 / 60;
    return parseFloat((durationSeconds * costPerSecond).toFixed(6));
}

async function transcribeVoiceNote(audioUrl) {
    let filePath = null;
    try {
        filePath = await downloadAudio(audioUrl);
        const result = await transcribeAudio(filePath);
        return result;
    } catch (err) {
        if (filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
        }
        logger.logEvent('transcription', { action: 'error', error: err.message, url: audioUrl });
        throw err;
    }
}

module.exports = { transcribeVoiceNote, estimateCost };
