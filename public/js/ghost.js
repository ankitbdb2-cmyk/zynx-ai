document.addEventListener('DOMContentLoaded', () => {
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
          <button class="ghost-close" id="ghost-close" title="Close">×</button>
        </div>
        <div class="ghost-messages" id="ghost-messages">
          <div class="message bot">Hey, I'm Sarah. What are you looking for?</div>
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

  toggleBtn.addEventListener('click', () => chatWin.classList.toggle('active'));
  closeBtn.addEventListener('click',  () => chatWin.classList.remove('active'));

  function appendMessage(text, sender) {
    const div = document.createElement('div');
    div.className = `message ${sender}`;
    div.textContent = text;
    msgBox.insertBefore(div, typing);
    msgBox.scrollTop = msgBox.scrollHeight;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.disabled = true;
    appendMessage(text, 'user');
    chatHistory.push({ role: 'user', content: text });

    typing.classList.add('active');
    msgBox.scrollTop = msgBox.scrollHeight;

    try {
      const res  = await fetch('/api/ghost/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chatHistory })
      });
      const data = await res.json();

      // Realistic 2-6 second delay
      const delay = Math.floor(Math.random() * 4000) + 2000;

      setTimeout(() => {
        typing.classList.remove('active');
        input.disabled = false;
        input.focus();

        if (data.reply) {
          let botReply = cleanBotReply(data.reply);
          appendMessage(botReply, 'bot');
          chatHistory.push({ role: 'assistant', content: botReply });
        }
      }, delay);

    } catch (err) {
      typing.classList.remove('active');
      input.disabled = false;
      console.error('Chat error:', err);
      appendMessage("Sorry, I'm having a quick connection issue. Please try again in a moment!", 'bot');
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
