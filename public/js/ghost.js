document.addEventListener('DOMContentLoaded', () => {
  /* ── Notification Sound (Web Audio API) ────────────────────── */
  function playNotification() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();

      // Soft chime — two gentle notes
      function note(freq, startTime, dur, vol) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);
        gain.gain.setValueAtTime(0, ctx.currentTime + startTime);
        gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + startTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + startTime);
        osc.stop(ctx.currentTime + startTime + dur);
      }

      // Pleasant two-tone chime (Instagram-like soft pop)
      note(880, 0, 0.18, 0.12);
      note(1175, 0.08, 0.22, 0.09);
      note(1320, 0.16, 0.28, 0.06);
    } catch (e) {}
  }

  /* ── Widget HTML ────────────────────────────────────────────── */
  const widgetHtml = `
    <div id="ghost-widget">
      <button class="ghost-toggle" id="ghost-toggle" title="Chat with Sarah">
        <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
      </button>
      <div class="ghost-chat-window" id="ghost-chat-window">
        <div class="ghost-header">
          <div class="ghost-header-info">
            <div class="ghost-avatar">S</div>
            <div class="ghost-name-wrap">
              <h3 class="ghost-name">Sarah</h3>
              <p class="ghost-status">Online now</p>
            </div>
          </div>
          <button class="ghost-close" id="ghost-close" title="Close">&times;</button>
        </div>
        <div class="ghost-messages" id="ghost-messages">
          <div class="message bot">
            Hey, I'm Sarah. What are you looking for?
            <span class="message-time">${formatTime(new Date())}</span>
          </div>
          <div class="typing-indicator" id="ghost-typing">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
          </div>
        </div>
        <div class="ghost-input-area">
          <form id="ghost-form" class="ghost-input-wrapper">
            <input type="text" id="ghost-input" class="ghost-input" placeholder="Type a message..." autocomplete="off">
            <button type="submit" class="ghost-send" title="Send">
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
  const chatWin   = document.getElementById('ghost-chat-window');
  const form      = document.getElementById('ghost-form');
  const input     = document.getElementById('ghost-input');
  const msgBox    = document.getElementById('ghost-messages');
  const typing    = document.getElementById('ghost-typing');

  let chatHistory = [
    { role: 'assistant', content: "Hey, I'm Sarah. What are you looking for?" }
  ];

  toggleBtn.addEventListener('click', () => {
    chatWin.classList.toggle('active');
    if (chatWin.classList.contains('active')) {
      setTimeout(() => input.focus(), 100);
    }
  });

  closeBtn.addEventListener('click', () => chatWin.classList.remove('active'));

  /* ── Helpers ────────────────────────────────────────────────── */
  function formatTime(d) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function getReadReceiptHTML() {
    return `<div class="read-receipt read">
      <svg viewBox="0 0 16 11"><path d="M11.071.653a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178l-6.19 7.636-2.011-2.095a.463.463 0 0 0-.336-.143.457.457 0 0 0-.336.143l-.755.788a.486.486 0 0 0 0 .669l3.106 3.145a.457.457 0 0 0 .336.143c.137 0 .255-.055.336-.143l7.274-8.939a.486.486 0 0 0-.037-.669z" fill="currentColor"/></svg>
      <svg viewBox="0 0 16 11"><path d="M11.071.653a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178l-6.19 7.636-2.011-2.095a.463.463 0 0 0-.336-.143.457.457 0 0 0-.336.143l-.755.788a.486.486 0 0 0 0 .669l3.106 3.145a.457.457 0 0 0 .336.143c.137 0 .255-.055.336-.143l7.274-8.939a.486.486 0 0 0-.037-.669z" fill="currentColor"/></svg>
    </div>`;
  }

  /* ── Append Message ─────────────────────────────────────────── */
  function appendMessage(text, sender) {
    const div = document.createElement('div');
    div.className = `message ${sender}`;
    div.textContent = text;

    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = formatTime(new Date());
    div.appendChild(time);

    if (sender === 'user') {
      div.insertAdjacentHTML('beforeend', getReadReceiptHTML());
    }

    msgBox.insertBefore(div, typing);
    msgBox.scrollTo({ top: msgBox.scrollHeight, behavior: 'smooth' });
  }

  /* ── Send Message ───────────────────────────────────────────── */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.disabled = true;
    appendMessage(text, 'user');
    chatHistory.push({ role: 'user', content: text });

    typing.classList.add('active');
    msgBox.scrollTo({ top: msgBox.scrollHeight, behavior: 'smooth' });

    try {
      const res  = await fetch('/api/ghost/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chatHistory })
      });
      const data = await res.json();

      const delay = Math.floor(Math.random() * 4000) + 2000;

      setTimeout(() => {
        typing.classList.remove('active');
        input.disabled = false;
        input.focus();

        if (data.reply) {
          let botReply = cleanBotReply(data.reply);
          appendMessage(botReply, 'bot');
          chatHistory.push({ role: 'assistant', content: botReply });
          playNotification();
        }
      }, delay);

    } catch (err) {
      typing.classList.remove('active');
      input.disabled = false;
      console.error('Chat error:', err);
      appendMessage("Sorry, I'm having a quick connection issue. Please try again in a moment!", 'bot');
      playNotification();
    }
  });

  function cleanBotReply(text) {
    return text
      .replace(/\[LEAD_DATA\][\s\S]*?(?=\n|$)/gi, '')
      .replace(/\[LEAD_CAPTURED\].*/gi, '')
      .replace(/```json[\s\S]*?```/g, '')
      .replace(/```[\s\S]*?```/g, '')
      .trim();
  }
});
