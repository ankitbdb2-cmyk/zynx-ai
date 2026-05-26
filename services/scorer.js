const logger = require('./logger');

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

    if (score >= 7) {
        stage = 'Hot';
        action = 'Send hot lead WhatsApp alert immediately. Call within 5 minutes.';
    } else if (score >= 4) {
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
        is_hot: stage === 'Hot'
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
