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

  runIf(hasApiKey)('TEST 3 — asks contact when budget+area+type given', async () => {
    const prompt = getBasePrompt();
    const reply = await callSharah(prompt, [
      { role: 'user', content: 'Looking for a villa in Jumeirah, 5M budget' }
    ]);

    const asksContact = /name|whatsapp|phone|number|call|reach/i.test(reply);
    expect(asksContact).toBe(true);
    const qMarks = (reply.match(/\?/g) || []).length;
    expect(qMarks).toBe(1);
  }, 30000);

  runIf(hasApiKey)('TEST 4 — asks contact not qualifying', async () => {
    const history = [
      { role: 'user', content: '2BR in JVC, budget 900K, investment' }
    ];
    const prompt = getBasePrompt(history);
    const reply = await callSharah(prompt, history);

    const asksContact = /name|whatsapp|phone|number|call|reach/i.test(reply);
    expect(asksContact).toBe(true);
    const qualifies = /own.use|invest|timeline|when.*move|cash|financing|mortgage/i.test(reply);
    expect(qualifies).toBe(false);
  });

  runIf(hasApiKey)('TEST 5 — brevity hard limit <200 chars', async () => {
    const prompt = getBasePrompt();
    const reply = await callSharah(prompt, [
      { role: 'user', content: 'Tell me about Dubai Marina as an investment' }
    ]);

    expect(reply.length).toBeLessThan(200);
  }, 30000);

  runIf(hasApiKey)('TEST 6 — correct full sequence: contact first, qualify second', async () => {
    const prompt = getBasePrompt();

    const turn1 = await callSharah(prompt, [
      { role: 'user', content: 'Buy' }
    ]);
    const areaKw = /where|area|location|neighborhood|community|which area/i.test(turn1);
    expect(areaKw).toBe(true);

    const turn2 = await callSharah(prompt, [
      { role: 'user', content: 'Buy' },
      { role: 'assistant', content: turn1 },
      { role: 'user', content: 'JVC' }
    ]);
    const budgetKw = /budget|price|spend|afford|range|how much/i.test(turn2);
    expect(budgetKw).toBe(true);

    const turn3 = await callSharah(prompt, [
      { role: 'user', content: 'Buy' },
      { role: 'assistant', content: turn1 },
      { role: 'user', content: 'JVC' },
      { role: 'assistant', content: turn2 },
      { role: 'user', content: '900K' }
    ]);
    const contactKw = /name|whatsapp|phone|number|call|reach/i.test(turn3);
    expect(contactKw).toBe(true);

    const turn4 = await callSharah(prompt, [
      { role: 'user', content: 'Buy' },
      { role: 'assistant', content: turn1 },
      { role: 'user', content: 'JVC' },
      { role: 'assistant', content: turn2 },
      { role: 'user', content: '900K' },
      { role: 'assistant', content: turn3 },
      { role: 'user', content: 'Ankit' },
      { role: 'assistant', content: 'Thanks Ankit — best WhatsApp number?' },
      { role: 'user', content: '+971501234567' }
    ]);
    const timelineKw = /timeline|when|move|urgent|looking to close/i.test(turn4);
    expect(timelineKw).toBe(true);
  }, 30000);
});
