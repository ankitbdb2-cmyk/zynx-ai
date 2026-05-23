document.addEventListener('DOMContentLoaded', async () => {
    // ─── Fetch agency name from server ───────────────────────────────────────
    let agencyName = 'Sandcastle Properties'; // fallback
    try {
        const cfg = await fetch('/api/ghost/config').then(r => r.json());
        if (cfg.agencyName) agencyName = cfg.agencyName;
    } catch (e) {
        console.warn('Could not fetch agency config, using fallback.');
    }

    const greeting = `Hello! 👋`;

    const widgetHtml = `
        <div id="ghost-widget">
            <button class="ghost-toggle pulse-gold" id="ghost-toggle" aria-label="Open chat">
                <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
            </button>
            <div class="ghost-chat-window" id="ghost-chat-window">
                <div class="ghost-header">
                    <div class="ghost-header-info">
                        <span class="ghost-status-dot"></span>
                        <div class="ghost-name-wrap">
                            <h3 class="ghost-name">Sarah — PropMind AI</h3>
                            <p class="ghost-subtitle">Online now</p>
                        </div>
                    </div>
                    <button class="ghost-close" id="ghost-close">×</button>
                </div>
                <div class="ghost-messages" id="ghost-messages">
                    <div class="message bot">${greeting}</div>
                    <div class="typing-indicator" id="ghost-typing">
                        <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
                    </div>
                </div>
                <div class="ghost-input-area">
                    <form id="ghost-form" class="ghost-input-wrapper">
                        <input type="text" id="ghost-input" class="ghost-input" placeholder="Type a message..." autocomplete="off">
                        <button type="submit" class="ghost-send">
                            <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                        </button>
                    </form>
                </div>
            </div>
        </div>
    `;

    document.getElementById('ghost-widget-container').innerHTML = widgetHtml;

    const toggleBtn = document.getElementById('ghost-toggle');
    const closeBtn  = document.getElementById('ghost-close');
    const chatWindow = document.getElementById('ghost-chat-window');
    const form = document.getElementById('ghost-form');
    const input = document.getElementById('ghost-input');
    const messagesContainer = document.getElementById('ghost-messages');
    const typingIndicator = document.getElementById('ghost-typing');

    let chatHistory = [
        { role: 'assistant', content: greeting }
    ];
    let pendingOfferId = null;
    let viewingOfferSent = false;

    toggleBtn.addEventListener('click', () => chatWindow.classList.toggle('active'));
    closeBtn.addEventListener('click', () => chatWindow.classList.remove('active'));

    function formatDisplayText(text) {
        return text
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/\n/g, '\n');
    }

    function appendMessage(text, sender) {
        const div = document.createElement('div');
        div.className = `message ${sender}`;
        div.style.whiteSpace = 'pre-wrap';
        div.textContent = formatDisplayText(text);
        messagesContainer.insertBefore(div, typingIndicator);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    async function maybeOfferViewing(hotScore) {
        if (hotScore < 8 || viewingOfferSent || !window.savedLeadId) return;
        try {
            const res = await fetch('/api/ghost/viewing-offer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ leadId: window.savedLeadId })
            });
            const data = await res.json();
            if (data.offerMessage) {
                viewingOfferSent = true;
                pendingOfferId = data.offerId;
                appendMessage(data.offerMessage, 'bot');
                chatHistory.push({ role: 'assistant', content: data.offerMessage });
            }
        } catch (e) {
            console.error('[PropMind] Viewing offer failed:', e);
        }
    }

    async function confirmViewingChoice(choice) {
        showTyping();
        try {
            const res = await fetch('/api/ghost/confirm-viewing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    leadId: window.savedLeadId,
                    choice,
                    offerId: pendingOfferId
                })
            });
            const data = await res.json();
            hideTyping();
            if (data.success && data.leadMessage) {
                appendMessage(data.leadMessage, 'bot');
                chatHistory.push({ role: 'assistant', content: data.leadMessage });
                pendingOfferId = null;
            } else {
                appendMessage("That slot isn't available — please pick 1, 2, or 3 from the options above.", 'bot');
            }
        } catch (e) {
            hideTyping();
            appendMessage("Sorry, I couldn't confirm that slot. Please try again.", 'bot');
        }
    }

    function showTyping() {
        typingIndicator.classList.add('active');
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function hideTyping() {
        typingIndicator.classList.remove('active');
    }

    /**
     * Parse the [LEAD_DATA] block from Sarah's reply.
     * Returns the parsed JSON object or null if parsing fails.
     */
    function parseLeadData(reply) {
        try {
            const marker = '[LEAD_DATA]';
            const idx = reply.indexOf(marker);
            if (idx === -1) return null;

            // Take everything after the marker, trim whitespace
            const afterMarker = reply.slice(idx + marker.length).trim();

            // Find the first { and the last } to extract the JSON object
            const start = afterMarker.indexOf('{');
            const end = afterMarker.lastIndexOf('}');
            if (start === -1 || end === -1 || end < start) return null;

            const jsonStr = afterMarker.slice(start, end + 1);
            return JSON.parse(jsonStr);
        } catch (e) {
            console.error('[PropMind] Failed to parse LEAD_DATA JSON:', e.message);
            return null;
        }
    }

    /**
     * Save or update a lead to the backend.
     * Saves EVERY message so the admin can see real-time progression.
     */
    async function saveLead(leadData) {
        const collected = leadData.collected || {};

        // Only save if at least some data collected (name OR phone OR budget OR area)
        const hasData = collected.name || collected.phone || collected.budget || collected.area;
        if (!hasData) return;

        const payload = {
            name: collected.name || 'Unknown',
            phone: collected.phone || '',
            budget: collected.budget || '',
            timeline: collected.timeline || '',
            hot_score: leadData.hot_score || 0,
            lead_stage: leadData.lead_stage || 'Cold',
            signals: leadData.signals || [],
            recommended_action: leadData.recommended_action || '',
            area: collected.area || '',
            bedrooms: collected.bedrooms || '',
            visit_time: collected.timeline || '',
            psychology_notes: `Score: ${leadData.hot_score}/10 | Stage: ${leadData.lead_stage} | Signals: ${(leadData.signals || []).join(', ')} | Action: ${leadData.recommended_action}`
        };

        const endpoint = window.savedLeadId
            ? `/api/ghost/save-lead?update=${window.savedLeadId}`
            : '/api/ghost/save-lead';

        try {
            const r = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const d = await r.json();
            if (d.leadId) window.savedLeadId = d.leadId;
            console.log('[PropMind] Lead saved/updated. ID:', window.savedLeadId, '| Score:', payload.hot_score);
        } catch (err) {
            console.error('[PropMind] Failed to save lead:', err);
        }
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;

        input.value = '';
        appendMessage(text, 'user');
        chatHistory.push({ role: 'user', content: text });

        if (pendingOfferId && /^[123]$/.test(text) && window.savedLeadId) {
            await confirmViewingChoice(text);
            return;
        }

        showTyping();

        try {
            const res = await fetch('/api/ghost/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: chatHistory })
            });
            const data = await res.json();
            
            const delay = Math.floor(Math.random() * (4000 - 1500 + 1)) + 1500;
            
            setTimeout(async () => {
                hideTyping();
                if (data.reply) {
                    const botReply = data.reply;

                    // ── Parse and strip the LEAD_DATA block ──────────────────
                    const leadData = parseLeadData(botReply);
                    
                    // Clean display reply (strip everything from [LEAD_DATA] onward)
                    const markerIdx = botReply.indexOf('[LEAD_DATA]');
                    const displayReply = markerIdx !== -1
                        ? botReply.slice(0, markerIdx).trim()
                        : botReply.trim();

                    appendMessage(displayReply, 'bot');

                    // Store the FULL raw reply in history so Sarah maintains context
                    chatHistory.push({ role: 'assistant', content: botReply });

                    // ── Save lead to database ─────────────────────────────────
                    if (leadData) {
                        await saveLead(leadData);
                        const score = leadData.hot_score || 0;
                        if (score >= 8) {
                            setTimeout(() => maybeOfferViewing(score), 800);
                        }
                    }
                }
            }, delay);

        } catch (error) {
            hideTyping();
            console.error('Chat error:', error);
            appendMessage("Sorry, I'm having connection issues. Can we try again?", 'bot');
        }
    });
});
