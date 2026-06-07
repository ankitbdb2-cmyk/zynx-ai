import 'dotenv/config';
import { describe, test, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt } from '../services/system-prompt.js';

const BANNED_OPENERS = [
  'Absolutely', 'Of course', 'Wonderful', 'Fantastic', 'Certainly'
];

const API_KEY = process.env.ANTHROPIC_API_KEY;
const hasApiKey = !!API_KEY;

let _client;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: API_KEY });
  return _client;
}

async function callSharah(systemPrompt, messages) {
  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 150,
    system: systemPrompt,
    messages
  });
  return response.content[0].text.trim();
}

function getBasePrompt(history) {
  return buildSystemPrompt('PropMind Real Estate', {
    messages: history || []
  });
}

const runIf = (condition) => condition ? test : test.skip;

describe('Sharah system prompt tests', () => {
  runIf(hasApiKey)('TEST 1 — warm but brief, <160 chars, one question', async () => {
    const prompt = getBasePrompt();
    const reply = await callSharah(prompt, [
      { role: 'user', content: 'Hi, looking for a 2BR in Dubai Marina, budget 1.5M AED' }
    ]);

    const firstWord = reply.split(/\s+/)[0].replace(/[^a-zA-Z]/g, '');
    expect(BANNED_OPENERS).not.toContain(firstWord);
    expect(reply.length).toBeLessThan(160);
    const qMarks = (reply.match(/\?/g) || []).length;
    expect(qMarks).toBe(1);
  }, 30000);

  runIf(hasApiKey)('TEST 2 — one question only', async () => {
    const prompt = getBasePrompt();
    const reply = await callSharah(prompt, [
      { role: 'user', content: 'I want to buy something' }
    ]);

    const qMarks = (reply.match(/\?/g) || []).length;
    expect(qMarks).toBe(1);
  }, 30000);

  runIf(hasApiKey)('TEST 3 — no echoing budget/property type', async () => {
    const prompt = getBasePrompt();
    const reply = await callSharah(prompt, [
      { role: 'user', content: 'Looking for a villa in Jumeirah, 5M budget' }
    ]);

    expect(reply).not.toContain('5M');
    expect(reply.toLowerCase()).not.toContain('villa');

    const qMarks = (reply.match(/\?/g) || []).length;
    expect(qMarks).toBe(1);
  }, 30000);

  runIf(hasApiKey)('TEST 4 — no re-asking known info', async () => {
    const history = [
      { role: 'user', content: '2BR in JVC, budget 900K, investment' }
    ];
    const prompt = getBasePrompt(history);
    const reply = await callSharah(prompt, history);

    expect(reply.toLowerCase()).not.toContain('jvc');
    expect(reply).not.toContain('900');
    expect(reply.toLowerCase()).not.toContain('investment');

    const timeline = /timeline|when|move|urgent|looking to close/i.test(reply);
    expect(timeline).toBe(true);
  });

  runIf(hasApiKey)('TEST 5 — brevity hard limit <200 chars', async () => {
    const prompt = getBasePrompt();
    const reply = await callSharah(prompt, [
      { role: 'user', content: 'Tell me about Dubai Marina as an investment' }
    ]);

    expect(reply.length).toBeLessThan(200);
  }, 30000);

  runIf(hasApiKey)('TEST 6 — correct qualification sequence', async () => {
    const prompt = getBasePrompt();

    const turn1 = await callSharah(prompt, [
      { role: 'user', content: 'Buy' }
    ]);
    const areaKeywords = /where|area|location|neighborhood|community|which area/i.test(turn1);
    const budgetKeywords = /budget|price|spend|afford|range/i.test(turn1);
    const investKeywords = /invest|own.use|purpose/i.test(turn1);
    expect(areaKeywords).toBe(true);
    expect(budgetKeywords || investKeywords).toBe(false);

    const turn2 = await callSharah(prompt, [
      { role: 'user', content: 'Buy' },
      { role: 'assistant', content: turn1 },
      { role: 'user', content: 'JVC' }
    ]);
    const budgetKeywords2 = /budget|price|spend|afford|range|how much/i.test(turn2);
    const investKeywords2 = /invest|own.use|purpose/i.test(turn2);
    const timelineKeywords2 = /timeline|when|move|urgent/i.test(turn2);
    expect(budgetKeywords2).toBe(true);
    expect(investKeywords2 || timelineKeywords2).toBe(false);

    const turn3 = await callSharah(prompt, [
      { role: 'user', content: 'Buy' },
      { role: 'assistant', content: turn1 },
      { role: 'user', content: 'JVC' },
      { role: 'assistant', content: turn2 },
      { role: 'user', content: '900K' }
    ]);
    const useKeywords = /own.use|invest|purpose|yourself|moving|primary/i.test(turn3);
    const timelineKeywords3 = /timeline|when|move|urgent/i.test(turn3);
    const contactKeywords3 = /contact|name|number|phone|whatsapp|email/i.test(turn3);
    expect(useKeywords).toBe(true);
    expect(timelineKeywords3 || contactKeywords3).toBe(false);

    const turn4 = await callSharah(prompt, [
      { role: 'user', content: 'Buy' },
      { role: 'assistant', content: turn1 },
      { role: 'user', content: 'JVC' },
      { role: 'assistant', content: turn2 },
      { role: 'user', content: '900K' },
      { role: 'assistant', content: turn3 },
      { role: 'user', content: 'Investment' }
    ]);
    const timelineKw = /timeline|when|move|urgent|looking to close/i.test(turn4);
    expect(timelineKw).toBe(true);
  }, 30000);
});
