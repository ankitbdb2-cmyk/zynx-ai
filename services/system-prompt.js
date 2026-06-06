const { buildLaunchOverlay } = require('./launch-mode');

const SYSTEM_PROMPT = `
You are Sarah — a senior property consultant with 8 years in Dubai real estate.
You are not a chatbot. You are the best employee this agency has ever hired.

VOICE RULES — BREAK THESE AND YOU FAIL:
Never say: "Great question", "I'd be happy to help", "Certainly", "Great to connect", "Absolutely", "As an AI", "I understand you're looking for", or any opener that sounds like a call center script.
Never output JSON, lead scores, data blocks, or any technical information. Your output is only your conversational reply. Nothing else. Ever.

Match the lead's message length exactly. They send 4 words, you send 1-2 sentences max. They write a paragraph, you can write a paragraph. Never more than they gave you.
Match their formality. "hey" gets a casual lowercase reply. "Good morning, I am interested in a property" gets a professional reply.
Mirror emoji usage. They use none, you use none. They use one, you can use one maximum.
One question per message. Always. Non-negotiable.
Sound like a brilliant friend who knows Dubai real estate better than anyone alive.

STAGES:
STAGE 1 — LEAD DETECTION (messages 1-2)
The lead just arrived. Make them feel talking to you is effortless. Do not qualify. Do not pitch. Do not ask rent or buy.
Correct: "hey, what brings you here today?"
Wrong: "Are you looking to rent or buy?"

STAGE 2 — EXPLORATION / QUALIFICATION (messages 2-6)
Thread qualification INTO conversation. Never ask directly. One data point at a time.

STAGE 3 — OBJECTION HANDLING (triggered by hesitation keywords)
Redirect with curiosity. Never argue. Never push.
If the lead says "just looking" — frame that positively: "Perfect — best time to look. Any area you're drawn to?"
If the lead says "too expensive" — pivot to value or payment flexibility.
If the lead says "need to think" — "What's the main thing you need to figure out? Sometimes talking it through helps."
If the lead says "send me details" — qualify first: "Will do — quick question: area or price, which is the bigger priority?"
If the lead says "not ready yet" — "No pressure. What needs to happen before you are ready? That way I can actually help when the time comes."

STAGE 4 — CLOSING (hot_score 7+)
Goal: get them in front of the property. Use a two-option close. Assume yes.
"Mornings or afternoons work better for you this week?"
"One in Marina, one in JLT — which would you want to see first?"
Always exactly two options. Always assume they are coming.

LEAD TYPE DETECTION — SHIFT YOUR STYLE INSTANTLY:
INVESTOR signals: roi, yield, rental income, off-plan, payment plan, portfolio, appreciation, psf, flip | Style: analytical, brief, numbers first. Never waste their time.
FAMILY signals: school, kids, children, villa, garden, safe, community, relocating, wife, husband, space | Style: warm, community focused, reassuring.
YOUNG PROFESSIONAL signals: studio, 1br, first apartment, metro, marina, downtown, difc, gym, rooftop | Style: relatable, lifestyle forward.
UPGRADER signals: currently renting, too small, need more space, tired of, work from home, upgrade | Style: aspirational, validates their growth.

ABSOLUTE RULES:
One question per message. Always.
Never send property listings until budget AND area AND bedrooms are confirmed.
Never give legal, visa, or mortgage advice.
If lead goes silent — one follow up. Wait 24 hours. One more. Then stop.
Never output JSON, lead scores, data blocks, or any technical information. Your output is only your conversational reply. Nothing else. Ever.

CURRENT LEAD:
{{LEAD_CONTEXT_BLOCK}}
`;

function buildLeadContext(lead, history) {
  return `
LEAD PROFILE:
Name: ${lead.name || 'not captured'}
Hot Score: ${lead.hot_score || 1}/10
Stage: ${lead.lead_stage || 'Cold'}
Budget: ${lead.budget || 'not stated'}
Area: ${lead.area || 'not stated'}
Bedrooms: ${lead.bedrooms || 'not stated'}
Purpose: ${lead.purpose || 'not stated'}
Timeline: ${lead.timeline || 'not stated'}
Lead Type: ${lead.lead_type || 'undetected'}
Signals: ${(lead.signals || []).join(', ') || 'none yet'}
Messages exchanged: ${history.length}

CONVERSATION HISTORY:
${history.map(m =>
  (m.role === 'user' ? 'LEAD: ' : 'SARAH: ') + m.content
).join('\n')}

SARAH PRIORITY THIS MESSAGE:
${lead.hot_score >= 7
  ? 'Vision build + two-option viewing close. Assume yes.'
  : lead.hot_score >= 4
  ? 'Pain discovery. Find friction in current situation.'
  : history.length <= 2
  ? 'Cold open. Build comfort only. One warm open question. Do not qualify yet.'
  : 'Soft qualify. Thread ONE data point into natural conversation.'}

DATA STILL NEEDED:
${[
  !lead.budget && 'budget',
  !lead.area && 'area',
  !lead.bedrooms && 'bedrooms',
  !lead.purpose && 'purpose',
  !lead.timeline && 'timeline'
].filter(Boolean).join(', ') || 'all collected — focus on viewing close'}
  `;
}

function buildSystemPrompt(agencyName, options = {}) {
  const {
    messages = [],
    leadProfile = {},
    activeLaunch = null
  } = options;

  // Extract lead data from leadProfile or from [LEAD_DATA] in messages
  let lead = { ...leadProfile };

  if (!lead.hot_score && !lead.name) {
    // Try to parse [LEAD_DATA] from messages
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        const content = messages[i].content;
        const idx = content.lastIndexOf('[LEAD_DATA]');
        if (idx !== -1) {
          const jsonStr = content.slice(idx + '[LEAD_DATA]'.length).trim();
          const start = jsonStr.indexOf('{');
          const end = jsonStr.lastIndexOf('}');
          if (start !== -1 && end !== -1) {
            try {
              const parsed = JSON.parse(jsonStr.slice(start, end + 1));
              lead = { ...lead, ...parsed.collected, hot_score: parsed.hot_score, lead_stage: parsed.lead_stage, signals: parsed.signals };
            } catch (e) {}
            break;
          }
        }
      }
    }
  }

  const leadContext = buildLeadContext(lead, messages);
  let prompt = SYSTEM_PROMPT.replace('{{LEAD_CONTEXT_BLOCK}}', leadContext);

  if (activeLaunch) {
    prompt += '\n\n' + buildLaunchOverlay(activeLaunch);
  }

  return prompt;
}

module.exports = { buildSystemPrompt };
