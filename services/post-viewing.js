const nodemailer = require('nodemailer');

function getTransporter() {
    if (!process.env.AGENT_EMAIL || !process.env.EMAIL_PASSWORD) return null;
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.AGENT_EMAIL,
            pass: process.env.EMAIL_PASSWORD
        }
    });
}

function sendEmail(subject, body) {
    const transporter = getTransporter();
    if (!transporter) {
        console.log(`[PVIL MOCK EMAIL] Subject: ${subject}\nBody:\n${body}`);
        return Promise.resolve({ mocked: true });
    }
    return transporter.sendMail({
        from: `"PVIL System" <${process.env.AGENT_EMAIL}>`,
        to: process.env.AGENT_EMAIL,
        subject,
        text: body
    }).then(info => ({ sent: true, response: info.response }))
      .catch(err => {
          console.error(`[PVIL EMAIL FAIL] ${subject}: ${err.message}`);
          return { sent: false, error: err.message };
      });
}

function launchPVIL(db, leadId) {
    const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(leadId);
    if (!lead) return { error: 'Lead not found' };

    if (lead.pv_launched_at) {
        return { alreadyLaunched: true, lead };
    }

    db.prepare(`
        UPDATE leads SET pv_launched_at = datetime('now'), pv_state = 'step0_launched'
        WHERE id = ?
    `).run(leadId);

    const updated = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(leadId);
    return { alreadyLaunched: false, lead: updated };
}

function cancelPVIL(db, leadId) {
    db.prepare(`UPDATE leads SET pv_state = 'engaged' WHERE id = ?`).run(leadId);
    return { cancelled: true };
}

function sendStep1(db, lead) {
    const phone = lead.phone || 'unknown';
    console.log(`[PVIL Step 1 WhatsApp → ${phone}]: "Just wanted to make sure you got back alright — the traffic can be unpredictable. Did anything stand out for you today?"`);

    const body = `Lead: ${lead.name} | Score: ${lead.hot_score} | Stage: ${lead.lead_stage}
Property interest: ${lead.signals || 'See lead record'}

Re-engagement WhatsApp sent. Watch for their response.

INSTRUCTION: Do NOT follow up with urgency. Do not call.
Let them respond to the WhatsApp first. Your job right now is to wait.

If they reply within 2 hours: they are still active.
Move to close conversation immediately.
If no reply by 24h: Step 2 coaching arrives automatically.`;

    return sendEmail(`PVIL Step 1: Re-engagement sent → ${lead.name}`, body)
        .then(() => {
            db.prepare(`UPDATE leads SET pv_state = 'step1_sent' WHERE id = ?`).run(lead.id);
        });
}

function sendStep2(db, lead) {
    const body = `${lead.name} has not responded. They are in the 24h comparison window.
They have likely viewed 2–3 other properties this week.

DO NOT lead with the property. Lead with the decision process.

SCRIPT TO SEND (WhatsApp or call):
"I know you're probably comparing a few options right now — that's exactly the right thing to do. Most buyers at this stage find it useful to get a side-by-side on the specifics. Want me to put that together for you?"

This opens a value-adding conversation without pressure.
Budget range: ${lead.budget || 'not specified'}
Signals recorded: ${lead.signals || 'none'}
Recommended action from system: ${lead.recommended_action || 'none'}`;

    return sendEmail(`PVIL Step 2: Competitive positioning → ${lead.name}`, body)
        .then(() => {
            db.prepare(`UPDATE leads SET pv_state = 'step2_sent' WHERE id = ?`).run(lead.id);
        });
}

function sendStep3(db, lead) {
    const budgetNum = parseInt(String(lead.budget || '0').replace(/[^0-9]/g, '')) || 0;

    if (budgetNum >= 2000000) {
        const body = `${lead.name} | Budget: ${lead.budget} | Qualifies for UAE Golden Visa

MESSAGE TO SEND (WhatsApp — casual, informational tone):
"I ran the yield numbers on the unit while I had the file open. Also worth noting — this property qualifies for the UAE Golden Visa programme, which I thought might be useful context as you're thinking it through."

CRITICAL: Frame this as information, not a sales tactic.
No urgency language. No "limited time." Just facts.`;

        return sendEmail(`PVIL Step 3: Golden Visa trigger → ${lead.name}`, body)
            .then(() => {
                db.prepare(`UPDATE leads SET pv_state = 'step3_sent' WHERE id = ?`).run(lead.id);
            });
    }

    const body = `${lead.name} | Budget: ${lead.budget || 'not specified'}

MESSAGE TO SEND:
"I wanted to make sure you had everything you needed to compare properly. Happy to send over the full breakdown — payment plan, service charge history, and comparable transactions in the building — if that would help."

Offer information. Do not push for a decision.
Signals: ${lead.signals || 'none'}`;

    return sendEmail(`PVIL Step 3: Value reinforcement → ${lead.name}`, body)
        .then(() => {
            db.prepare(`UPDATE leads SET pv_state = 'step3_sent' WHERE id = ?`).run(lead.id);
        });
}

function sendStep4(db, lead) {
    const nat = (lead.nationality || '').toLowerCase();
    let script;

    if (nat.includes('russia') || nat.includes('cis') || nat.includes('ukraine') || nat.includes('kazakhstan')) {
        script = `Acknowledge directly that you have received another enquiry on this unit. Give them a clear decision window. Do not bluff — only use this if true. If true, this is the most powerful close available.

MESSAGE TO SEND:
"I want to be transparent with you — I have another viewing request on this unit for later this week. I wanted to give you first right of response before I confirm it."`;
    } else if (nat.includes('india') || nat.includes('pakistan') || nat.includes('sri lanka') || nat.includes('bangladesh')) {
        script = `The family discussion is happening right now. Do not push.

Send a family-decision support packet — formatted for the conversation they are having without you.

MESSAGE TO SEND:
"I put together a short document that might be useful for your family's review — yield data, the Golden Visa pathway, and a quick developer background. Want me to send it across?"

Attach or reference: investment yield, Golden Visa eligibility, developer track record. Make the family's decision easier, not harder.`;
    } else if (nat.includes('china') || nat.includes('hong kong') || nat.includes('taiwan')) {
        script = `DO NOT call. They are in analysis phase.

Send a structured comparison document. Subject line matters.

MESSAGE TO SEND (WhatsApp):
"I thought a direct comparison between the two units we discussed might be helpful — floor plan, price per sqft, payment structure, and view orientation side by side. Want me to send it?"

One document request. No pressure. No urgency framing.`;
    } else {
        script = `Standard final approach — direct and respectful.

MESSAGE TO SEND:
"I wanted to check in one last time before the week closes. Is there anything specific holding you back that I can help clarify? Happy to answer any questions before you make your decision."`;
    }

    const body = `${lead.name} | Nationality: ${lead.nationality || 'not recorded'}
This is the final automated coaching step for this lead.

${script}

After this: manual follow-up only. System sequence complete.`;

    return sendEmail(`PVIL Step 4: Final approach → ${lead.name}`, body)
        .then(() => {
            db.prepare(`UPDATE leads SET pv_state = 'step4_sent' WHERE id = ?`).run(lead.id);
        });
}

function checkAndFireSteps(db) {
    const leads = db.prepare(`
        SELECT * FROM leads
        WHERE pv_launched_at IS NOT NULL
          AND pv_state NOT IN ('engaged', 'complete', 'pending')
    `).all();

    let fired = 0;
    const errors = [];

    for (const lead of leads) {
        const hoursElapsed = (Date.now() - new Date(lead.pv_launched_at).getTime()) / (1000 * 60 * 60);

        try {
            if (hoursElapsed >= 2 && lead.pv_state === 'step0_launched') {
                sendStep1(db, lead);
                fired++;
            } else if (hoursElapsed >= 24 && lead.pv_state === 'step1_sent') {
                sendStep2(db, lead);
                fired++;
            } else if (hoursElapsed >= 48 && lead.pv_state === 'step2_sent') {
                sendStep3(db, lead);
                fired++;
            } else if (hoursElapsed >= 72 && lead.pv_state === 'step3_sent') {
                sendStep4(db, lead);
                fired++;
            }
        } catch (e) {
            errors.push({ leadId: lead.id, error: e.message });
            console.error(`[PVIL ERROR] Lead ${lead.id}: ${e.message}`);
        }
    }

    return { processed: leads.length, fired, errors };
}

module.exports = { launchPVIL, cancelPVIL, checkAndFireSteps };
