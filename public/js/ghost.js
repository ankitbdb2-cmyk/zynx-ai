document.addEventListener('DOMContentLoaded', async () => {
    // ─── Fetch agency name from server (change AGENCY_NAME in .env to update) ───
    let agencyName = 'Sandcastle Properties'; // fallback
    try {
        const cfg = await fetch('/api/ghost/config').then(r => r.json());
        if (cfg.agencyName) agencyName = cfg.agencyName;
    } catch (e) {
        console.warn('Could not fetch agency config, using fallback.');
    }

    const greeting = `Hi there! I'm Sarah from ${agencyName}. Are you looking for a new property today?`;

    const widgetHtml = `
        <div id="ghost-widget">
            <button class="ghost-toggle" id="ghost-toggle">
                <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
            </button>
            <div class="ghost-chat-window" id="ghost-chat-window">
                <div class="ghost-header">
                    <div class="ghost-header-info">
                        <div class="ghost-avatar">S</div>
                        <div class="ghost-name-wrap">
                            <h3 class="ghost-name">Sarah</h3>
                            <p class="ghost-status">Online</p>
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

    toggleBtn.addEventListener('click', () => chatWindow.classList.toggle('active'));
    closeBtn.addEventListener('click', () => chatWindow.classList.remove('active'));

    function appendMessage(text, sender) {
        const div = document.createElement('div');
        div.className = `message ${sender}`;
        div.textContent = text;
        messagesContainer.insertBefore(div, typingIndicator);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function showTyping() {
        typingIndicator.classList.add('active');
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function hideTyping() {
        typingIndicator.classList.remove('active');
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;

        input.value = '';
        appendMessage(text, 'user');
        chatHistory.push({ role: 'user', content: text });

        showTyping();

        try {
            const res = await fetch('/api/ghost/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: chatHistory })
            });
            const data = await res.json();
            
            const delay = Math.floor(Math.random() * (6000 - 2000 + 1)) + 2000;
            
            setTimeout(() => {
                hideTyping();
                if (data.reply) {
                    let botReply = data.reply;
                    let displayReply = botReply;

                    let leadSaved = window.leadSaved || false;
                    if (botReply.includes('[LEAD_DATA]')) {
                        // Extract JSON if present
                        let jsonMatch = botReply.match(/\[LEAD_DATA\]\s*(\{[\s\S]*\})/);
                        if (jsonMatch) {
                            try {
                                const newLeadData = JSON.parse(jsonMatch[1]);
                                const collected = newLeadData.collected || {};
                                
                                // Only save if we have the critical info and haven't saved yet
                                if (collected.name && collected.phone && !leadSaved) {
                                    window.leadSaved = true;
                                    const payload = {
                                        name: collected.name || '',
                                        phone: collected.phone || '',
                                        budget: collected.budget || '',
                                        visit_time: collected.timeline || '',
                                        psychology_notes: `Hot Score: ${newLeadData.hot_score} | Stage: ${newLeadData.lead_stage} | Signals: ${(newLeadData.signals || []).join(', ')} | Action: ${newLeadData.recommended_action} | Area: ${collected.area} | Beds: ${collected.bedrooms}`
                                    };
                                    
                                    fetch('/api/ghost/save-lead', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify(payload)
                                    });
                                }
                            } catch (e) {
                                console.error('Failed to parse lead data', e);
                            }
                        }
                        
                        // Clean up response for the user
                        displayReply = botReply.split('[LEAD_DATA]')[0].trim();
                    }
                    
                    appendMessage(displayReply, 'bot');
                    // Store the raw reply in history so context is preserved
                    chatHistory.push({ role: 'assistant', content: botReply });
                }
            }, delay);

        } catch (error) {
            hideTyping();
            console.error('Chat error:', error);
            appendMessage("Sorry, I'm having connection issues. Can we try again?", 'bot');
        }
    });
});
