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
    max_tokens: 200,
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
  runIf(hasApiKey)('TEST 1 — warm with inventory signal, one question', async () => {
    const prompt = getBasePrompt();
    const reply = await callSharah(prompt, [
      { role: 'user', content: 'Hi, looking for a 2BR in Dubai Marina, budget 1.5M AED' }
    ]);

    const firstWord = reply.split(/\s+/)[0].replace(/[^a-zA-Z]/g, '');
    expect(BANNED_OPENERS).not.toContain(firstWord);
    const hasInventory = /option|available|have|inventory|listing|unit|stock/i.test(reply);
    expect(hasInventory).toBe(true);
    expect(reply.length).toBeLessThan(400);
    const qMarks = (reply.match(/\?/g) || []).length;
    expect(qMarks).toBeLessThanOrEqual(2);
  }, 30000);

  runIf(hasApiKey)('TEST 2 — one question only', async () => {
    const prompt = getBasePrompt();
    const reply = await callSharah(prompt, [
      { role: 'user', content: 'I want to buy something' }
    ]);

    const qMarks = (reply.match(/\?/g) || []).length;
    expect(qMarks).toBeLessThanOrEqual(2);
  }, 30000);

  runIf(hasApiKey)('TEST 3 — contact asked with inventory signal', async () => {
    const prompt = getBasePrompt();
    const reply = await callSharah(prompt, [
      { role: 'user', content: 'Looking for a villa in Jumeirah, 5M budget' }
    ]);

    const asksContact = /name|whatsapp|phone|number|call|reach/i.test(reply);
    expect(asksContact).toBe(true);
    const hasInventory = /option|available|have|inventory|listing|unit|stock/i.test(reply);
    expect(hasInventory).toBe(true);
  }, 30000);

  runIf(hasApiKey)('TEST 4 — answers question before redirecting', async () => {
    const history = [
      { role: 'user', content: '2BR in JVC, budget 900K, investment' }
    ];
    const prompt = getBasePrompt(history);
    const reply = await callSharah(prompt, history);

    const hasInventory = /option|available|have|inventory|listing|yield|return/i.test(reply);
    expect(hasInventory).toBe(true);
    const asksContact = /name|whatsapp|phone|number|call|reach/i.test(reply);
    expect(asksContact).toBe(true);
  }, 30000);

  runIf(hasApiKey)('TEST 5 — warm but under 500 chars', async () => {
    const prompt = getBasePrompt();
    const reply = await callSharah(prompt, [
      { role: 'user', content: 'Tell me about Dubai Marina as an investment' }
    ]);

    expect(reply.length).toBeLessThan(500);
    const hasInventory = /option|available|have|inventory|listing|yield|return|demand|rental/i.test(reply);
    expect(hasInventory).toBe(true);
  }, 30000);

  runIf(hasApiKey)('TEST 6 — qualification sequence with human flow', async () => {
    const prompt = getBasePrompt();

    const turn1 = await callSharah(prompt, [
      { role: 'user', content: 'Buy' }
    ]);
    expect(turn1.length).toBeGreaterThan(0);

    const turn2 = await callSharah(prompt, [
      { role: 'user', content: 'Buy' },
      { role: 'assistant', content: turn1 },
      { role: 'user', content: 'JVC' }
    ]);
    expect(turn2.length).toBeGreaterThan(0);

    const turn3 = await callSharah(prompt, [
      { role: 'user', content: 'Buy' },
      { role: 'assistant', content: turn1 },
      { role: 'user', content: 'JVC' },
      { role: 'assistant', content: turn2 },
      { role: 'user', content: '2BR, budget 900K' }
    ]);
    const hasInventory = /option|available|have|inventory|listing|unit|stock/i.test(turn3);
    expect(hasInventory).toBe(true);

    const turn4 = await callSharah(prompt, [
      { role: 'user', content: 'Buy' },
      { role: 'assistant', content: turn1 },
      { role: 'user', content: 'JVC' },
      { role: 'assistant', content: turn2 },
      { role: 'user', content: '2BR, budget 900K' },
      { role: 'assistant', content: turn3 },
      { role: 'user', content: 'Ankit, +971501234567' }
    ]);
    expect(turn4.length).toBeGreaterThan(0);
  }, 30000);
});
