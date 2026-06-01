const logger = require('./logger');
const { db } = require('../database');
const { getLaunchScoringAdjustments } = require('./launch-mode');

const HOT_KEYWORDS = [
    'viewing', 'visit', 'come see', 'inspect', 'show me',
    'payment plan', 'installment', 'down payment', 'mortgage',
    'specific', 'exact unit', 'building name', 'floor plan',
    'ready to buy', 'ready to rent', 'move in', 'available now'
];

const BUDGET_PATTERNS = [
    /aed\s*[\d,]+/i, /\$\s*[\d,]+/,
    /[\d,]+\s*(dirham|aed|dhs)/i,
    /budget\s*(is|of)?\s*[\d,]+/i,
    /[\d,]{3,}\s*(k|m|mn|million|thousand)/i
];

function getNIMWeightAdjustment(detectedLanguage, messages) {
  if (!detectedLanguage || !detectedLanguage.code) return 0;

  const code = detectedLanguage.code.toLowerCase();
  const allText = messages
    .map(m => (m.content || m.message || m.text || '').toLowerCase())
    .join(' ');
  const msgCount = messages.length;

  let adjustment = 0;

  // ── CHINESE / HK / TAIWAN ─────────────────────────────────────────────────
  // Question volume is the buying signal — not indecision
  if (code.startsWith('zh')) {
    if (msgCount >= 8)      adjustment += 2;
    else if (msgCount >= 5) adjustment += 1;

    // Price negotiation = positive buying behavior (not friction)
    const priceNeg = ['best price', 'discount', 'negotiate', 'lower price',
                      'reduce', 'what is your best', 'final offer'];
    if (priceNeg.some(p => allText.includes(p))) adjustment += 1.5;
  }

  // ── RUSSIAN / CIS ─────────────────────────────────────────────────────────
  // Aggressive anchoring and urgency are genuine buying signals
  else if (['ru','uk','kk','uz','be','ky','az','hy'].includes(code)) {
    const aggressivePrice = ['best price', 'final price', 'real price',
                             'maximum discount', 'actual price', 'bottom price'];
    if (aggressivePrice.some(p => allText.includes(p))) adjustment += 1.5;

    const urgentTimeline = ['this week', 'deciding now', 'ready to sign',
                            'want to move quickly', 'urgent', 'immediately'];
    if (urgentTimeline.some(p => allText.includes(p))) adjustment += 1;

    // Capital security questions = high seriousness, not hesitation
    const capitalSec = ['rera','escrow','ownership','freehold','title deed',
                        'legal protection','regulated','safe to buy'];
    if (capitalSec.some(p => allText.includes(p))) adjustment += 2;
  }

  // ── INDIAN SUBCONTINENT ───────────────────────────────────────────────────
  // Social proof reference = trust already established
  // "Discuss with family" = close is happening, not a delay
  else if (['hi','ur','bn','ta','te','gu','pa','si','ml','kn','mr','ne'].includes(code)) {
    const socialProof = ['my friend', 'my colleague', 'my brother', 'my sister',
                         'family bought', 'know someone', 'referred', 'they bought'];
    if (socialProof.some(p => allText.includes(p))) adjustment += 2;

    const familyClose = ['discuss with family', 'talk to wife', 'talk to husband',
                         'check with family', 'family decision', 'ask my wife',
                         'ask my husband', 'show my family'];
    if (familyClose.some(p => allText.includes(p))) adjustment += 1.5;
  }

  // ── GULF ARAB / FARSI ─────────────────────────────────────────────────────
  // Privacy + building-specific questions = serious evaluation
  // Payment plan interest without price objection = strong buying intent
  else if (['ar','fa'].includes(code)) {
    const privacyLoc = ['privacy', 'private', 'neighbors', 'which floor',
                        'orientation', 'which direction', 'sunrise', 'sunset',
                        'view', 'who lives'];
    if (privacyLoc.some(p => allText.includes(p))) adjustment += 1.5;

    const paymentPlan = ['payment plan', 'installment', 'post handover',
                         'developer payment', 'how to pay'];
    const priceObjection = ['too expensive', 'overpriced', 'too much',
                            'high price', 'very expensive'];
    if (
      paymentPlan.some(p => allText.includes(p)) &&
      !priceObjection.some(p => allText.includes(p))
    ) {
      adjustment += 2;
    }
  }

  return Math.min(adjustment, 3); // hard cap — max +3 regardless of nationality
}

function assessLead(messages, leadProfile) {
    const allText = messages
        .filter(m => m.role === 'user')
        .map(m => m.content)
        .join(' ');

    const budgetMentioned = BUDGET_PATTERNS.some(p => p.test(allText));
    const propertyMentioned = /(studio|1br|2br|3br|4br|villa|apartment|penthouse|townhouse|duplex|unit|property)/i.test(allText);
    const askingAboutViewing = /(viewing|visit|show|see|inspect)/i.test(allText);
    const paymentPlanMentioned = /(payment plan|installment|down payment|mortgage|finance)/i.test(allText);
    const specificProperty = /(building|tower|community|development|name|floor|unit)/i.test(allText);
    const multipleQuestions = (allText.match(/\?/g) || []).length >= 2;
    const followUpCount = messages.filter(m => m.role === 'user').length;
    const vaguePhrases = /(just looking|browsing|checking|maybe|perhaps|not sure)/i.test(allText);

    let score = 0;
    let stage = 'Cold';
    let signals = [];
    let action = '';

    if (budgetMentioned) { score += 3; signals.push('Budget flexibility detected'); }
    if (propertyMentioned) { score += 2; signals.push('Specific requirements — serious buyer'); }
    if (askingAboutViewing) { score += 3; signals.push('Ready to book viewing'); }
    if (paymentPlanMentioned) { score += 2; signals.push('Investment buyer'); }
    if (specificProperty) { score += 2; signals.push('Multiple property interest'); }
    if (multipleQuestions) { score += 1; }
    if (followUpCount >= 3) { score += 1; }
    if (vaguePhrases) { score -= 1; }

    // NIM: nationality-aware weight adjustment
    const nimAdjustment = getNIMWeightAdjustment(leadProfile.detectedLanguage, messages);
    let adjustedScore = Math.min(score + nimAdjustment, 10);

    // ── LAUNCH MODE SCORING ─────────────────────────────────────────────────
    const launchAdj = getLaunchScoringAdjustments(db);
    let launchMode = false;
    let showroomOverride = false;

    if (launchAdj.active) {
        launchMode = true;
        const launchText = messages
            .map(m => (m.content || m.message || m.text || '').toLowerCase())
            .join(' ');

        // SHOWROOM AUTO-HOT: buyer mentioning the developer event = max intent
        // Bypasses all other scoring — returns immediately
        const showroomSignals = [
            'showroom', 'developer event', 'launch event',
            'roadshow', 'road show', 'presentation', 'the event',
            'i attended', 'i was there', 'i saw the project'
        ];
        if (showroomSignals.some(k => launchText.includes(k))) {
            showroomOverride = true;
            return {
                hot_score: 10,
                lead_stage: 'Hot',
                signals: [...new Set(signals)],
                recommended_action: 'Send hot lead WhatsApp alert immediately. Call within 5 minutes.',
                is_hot: true,
                nimAdjustment,
                adjustedScore: 10,
                launchMode: true,
                showroomOverride: true
            };
        }

        // PAYMENT PLAN BONUS: interest without price objection = strong off-plan intent
        const paymentPlanKw = [
            'payment plan', 'installment', 'post handover',
            'developer payment', 'how to pay', 'down payment'
        ];
        const priceObjectionKw = [
            'too expensive', 'overpriced', 'too much', 'high price', 'very expensive'
        ];
        const hasPaymentPlanInterest = paymentPlanKw.some(k => launchText.includes(k));
        const hasPriceObjection = priceObjectionKw.some(k => launchText.includes(k));
        if (hasPaymentPlanInterest && !hasPriceObjection) {
            adjustedScore = Math.min(adjustedScore + launchAdj.paymentPlanBonus, 10);
        }

        // URGENCY BONUS: launch window urgency is genuine — worth more than standard
        const urgencyKw = [
            'this week', 'deciding now', 'ready to sign',
            'urgent', 'immediately', 'today', 'right now', 'asap'
        ];
        if (urgencyKw.some(k => launchText.includes(k))) {
            adjustedScore = Math.min(adjustedScore + launchAdj.urgencyBonus, 10);
        }
    }
    // ── END LAUNCH MODE SCORING ─────────────────────────────────────────────

    if (adjustedScore >= 7) {
        stage = 'Hot';
        action = 'Send hot lead WhatsApp alert immediately. Call within 5 minutes.';
    } else if (adjustedScore >= 4) {
        stage = 'Warm';
        action = 'Follow up within 2 hours with property recommendations matching their interests.';
    } else {
        stage = 'Cold';
        action = 'Nurture with automated property alerts. Check back in 1 week.';
    }

    const isHot = budgetMentioned && (propertyMentioned || askingAboutViewing || paymentPlanMentioned);

    if (isHot && score < 7) {
        score = 7;
        stage = 'Hot';
        action = 'Send hot lead WhatsApp alert immediately. Call within 5 minutes.';
        if (!signals.includes('Ready to book viewing') && askingAboutViewing) {
            signals.push('Ready to book viewing');
        }
    }

    const result = {
        hot_score: Math.min(score, 10),
        lead_stage: stage,
        signals: [...new Set(signals)],
        recommended_action: action,
        is_hot: stage === 'Hot',
        nimAdjustment,
        adjustedScore,
        launchMode,
        showroomOverride: false
    };

    logger.logEvent('scorer', {
        action: 'assess_complete',
        score: result.hot_score,
        stage: result.lead_stage,
        isHot: result.is_hot,
        signals: result.signals,
        budgetMentioned,
        propertyMentioned,
        askingAboutViewing,
        paymentPlanMentioned,
        followUpCount
    });

    return result;
}

module.exports = { assessLead };
