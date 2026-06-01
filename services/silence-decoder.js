// services/silence-decoder.js
const Anthropic = require('@anthropic-ai/sdk');

const HOT_SILENCE_HOURS        = 4;
const POST_VIEWING_SILENCE_HOURS = 24;
const PROFILE_COOLDOWN_SECONDS = 21600;
const MAX_PER_RUN              = 3;

function getNationalityContext(nationality, budget, allText) {
  const nat = (nationality || '').toLowerCase();
  const text = (allText || '').toLowerCase();

  if (['russian','ukrainian','kazakhstani','uzbek','cis'].some(k => nat.includes(k))) {
    if (budget >= 3000000) {
      return 'Russian/CIS buyer at AED ' + budget.toLocaleString() +
        '. Capital mobility and asset security dominate at this price point. ' +
        'Fear: "Is my capital protected and accessible?" ' +
        'RERA escrow protection and regulatory stability are the correct reassurers. ' +
        'Aggressive closing language triggers immediate withdrawal.';
    }
    return 'Russian/CIS buyer. Pragmatic and direct. Respond with facts and exclusivity. Efficiency is respected. Soft selling is not.';
  }

  if (nat.includes('indian')) {
    if (['family','discuss','consult','wife','husband'].some(k => text.includes(k))) {
      return 'Indian buyer with family consultation signal. The close is likely happening without the agent right now. Interrupting with sales pressure resets the cycle. Equip them: yield data, Golden Visa eligibility, developer track record. Let the family close the deal.';
    }
    return 'Indian buyer. Long-term yield, capital appreciation, school proximity, developer reputation. Investment case must be structured and documented.';
  }

  if (nat.includes('chinese')) {
    if (((allText || '').split(' ').length > 150) || text.includes('question')) {
      return 'Chinese buyer in deep analysis phase — NOT disengagement. They are building an internal comparison. Calling is wrong. Send: structured unit comparison document with floor plans, price per sqft, yield calculation, handover schedule. Let the analysis conclude.';
    }
    return 'Chinese buyer. Documentation-driven. Investment security, developer credibility, payment plan flexibility. Structured materials outperform verbal communication.';
  }

  if (['emirati','saudi','kuwaiti','qatari','bahraini','omani','gulf'].some(k => nat.includes(k))) {
    return 'Gulf Arab buyer. Post-viewing silence frequently indicates evaluating going direct to developer to bypass agency. Window is closing. Correct lever: exclusive agency-only incentive (unit unavailable direct, VIP pricing, or post-handover structure only via agency). Do not call. Send the incentive first.';
  }

  return 'Buyer background: ' + (nationality || 'Unknown') +
    '. Apply psychological distance principle: the silence is the objection. ' +
    'Send one low-pressure, high-value touchpoint that removes the next step ' +
    'friction without demanding a decision.';
}

function buildSilencePrompt(lead, silenceReason) {
  const nationality  = lead.nationality || 'Unknown';
  const budget       = lead.budget || 0;
  const stage        = lead.lead_stage || lead.status || 'Unknown';
  const signals      = lead.signals || 'None recorded';
  const psychNotes   = lead.psychology_notes || 'None recorded';
  const hoursSilent  = lead.last_reply_at
    ? Math.floor((Date.now() / 1000 - lead.last_reply_at) / 3600)
    : 'unknown';
  const silenceLabel = silenceReason === 'post_viewing'
    ? 'Viewed the property — has not responded since'
    : 'Hot lead (scored 7+) has gone silent';
  const budgetDisplay = typeof budget === 'number'
    ? 'AED ' + budget.toLocaleString()
    : 'AED ' + budget;
  const natContext   = getNationalityContext(nationality, budget,
    (signals + ' ' + psychNotes).toLowerCase());

  return `You are an elite real estate closing consultant for Dubai luxury property.
A buyer has gone silent. Generate their Silent Objection Profile.

BUYER DATA:
- Nationality: ${nationality}
- Budget: ${budgetDisplay}
- Current Stage: ${stage}
- Hours Silent: ${hoursSilent}
- Silence Type: ${silenceLabel}
- Engagement Signals: ${signals}
- Psychology Notes: ${psychNotes}

NATIONALITY INTELLIGENCE:
${natContext}

RULES:
- Return ONLY a valid JSON object — no preamble, no markdown, no code fences
- Exactly three keys: fear, what_not_to_do, counter_move
- Each value: 2-4 sentences. Specific. Actionable. Nationality-calibrated.
- counter_move must name a specific message or document to send — not a generic principle

{"fear":"","what_not_to_do":"","counter_move":""}`;
}

function updateLastReply(db, leadId) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE leads SET last_reply_at = ? WHERE id = ?').run(now, leadId);
}

function dismissProfile(db, profileId) {
  db.prepare('UPDATE silence_profiles SET dismissed = 1 WHERE id = ?').run(profileId);
  return { dismissed: true, profileId };
}

function getSilenceProfiles(db) {
  return db.prepare(`
    SELECT sp.*, l.name, l.phone, l.hot_score, l.nationality,
           l.budget, l.lead_stage, l.status
    FROM   silence_profiles sp
    JOIN   leads l ON l.id = sp.lead_id
    WHERE  sp.dismissed = 0
    ORDER  BY sp.generated_at DESC
  `).all();
}

async function generateSilenceProfile(db, lead, silenceReason) {
  const recentCutoff = Math.floor(Date.now() / 1000) - PROFILE_COOLDOWN_SECONDS;
  const existing = db.prepare(`
    SELECT id FROM silence_profiles
    WHERE lead_id = ? AND generated_at > ? AND dismissed = 0
  `).get(lead.id, recentCutoff);
  if (existing) return null;

  const promptText = buildSilencePrompt(lead, silenceReason);

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 800,
    messages: [{ role: 'user', content: promptText }]
  });

  const rawText = response.content[0].text;

  const clean = rawText.replace(/```json|```/g, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch (e) {
    parsed = {
      fear:          'Profile parse error — review raw signal data',
      what_not_to_do:'Do not contact lead until profile is reviewed manually',
      counter_move:  rawText.substring(0, 400)
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(`
    INSERT INTO silence_profiles
      (lead_id, generated_at, fear, what_not_to_do, counter_move,
       stage, nationality, budget)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    lead.id, now,
    parsed.fear, parsed.what_not_to_do, parsed.counter_move,
    lead.lead_stage || lead.status || '',
    lead.nationality || '',
    lead.budget || 0
  );

  db.prepare(`
    UPDATE leads SET silence_detected_at = ?, silence_alerted_at = ?
    WHERE id = ?
  `).run(now, now, lead.id);

  return { profileId: result.lastInsertRowid, lead_id: lead.id, ...parsed };
}

async function checkSilentLeads(db) {
  const now = Math.floor(Date.now() / 1000);

  const hotLeads = db.prepare(`
    SELECT * FROM leads
    WHERE  hot_score >= 7
      AND  last_reply_at IS NOT NULL
      AND  last_reply_at < ?
      AND  (no_show IS NULL OR no_show != 1)
      AND  (silence_alerted_at IS NULL
            OR silence_alerted_at < ?)
    LIMIT  ?
  `).all(
    now - (HOT_SILENCE_HOURS * 3600),
    now - PROFILE_COOLDOWN_SECONDS,
    MAX_PER_RUN
  );

  const postViewingLeads = db.prepare(`
    SELECT * FROM leads
    WHERE  completed_at IS NOT NULL
      AND  last_reply_at IS NOT NULL
      AND  last_reply_at < ?
      AND  (silence_alerted_at IS NULL
            OR silence_alerted_at < ?)
    LIMIT  ?
  `).all(
    now - (POST_VIEWING_SILENCE_HOURS * 3600),
    now - (POST_VIEWING_SILENCE_HOURS * 3600),
    MAX_PER_RUN
  );

  let generated = 0;
  const errors  = [];
  const processedIds = new Set();

  for (const lead of hotLeads) {
    processedIds.add(lead.id);
    if (generated >= MAX_PER_RUN) break;
    try {
      const p = await generateSilenceProfile(db, lead, 'hot_silence');
      if (p) generated++;
    } catch (e) {
      errors.push({ lead_id: lead.id, error: e.message });
    }
  }

  for (const lead of postViewingLeads) {
    if (processedIds.has(lead.id)) continue;
    if (generated >= MAX_PER_RUN) break;
    try {
      const p = await generateSilenceProfile(db, lead, 'post_viewing');
      if (p) generated++;
    } catch (e) {
      errors.push({ lead_id: lead.id, error: e.message });
    }
  }

  return { generated, errors };
}

module.exports = {
  updateLastReply,
  dismissProfile,
  getSilenceProfiles,
  generateSilenceProfile,
  checkSilentLeads
};
