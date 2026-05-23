document.addEventListener('DOMContentLoaded', () => {
  const objections = [
    "Price is too high",
    "I need to think about it",
    "I want to check other properties first",
    "My wife/husband needs to see it",
    "The market might go down",
    "I'm not ready to buy yet",
    "The location isn't perfect",
    "I need to sell my current house first",
    "Interest rates are too high",
    "The rooms are too small",
    "I don't like the layout",
    "It needs too much work",
    "I'm just looking",
    "The HOA fees are too high",
    "I want a bigger yard",
    "I need to consult my financial advisor",
    "It's been on the market too long",
    "I don't want to rush into anything",
    "The neighborhood seems loud",
    "I'll wait for a better deal"
  ];

  const grid  = document.getElementById('objections-grid');
  const input = document.getElementById('buyer-input');

  objections.forEach(obj => {
    const btn = document.createElement('button');
    btn.className = 'obj-btn';
    btn.textContent = obj;
    btn.addEventListener('click', () => { input.value = obj; input.focus(); });
    grid.appendChild(btn);
  });

  // UI refs
  const analyzeBtn  = document.getElementById('analyze-btn');
  const emergencyBtn = document.getElementById('emergency-btn');
  const followupBtn  = document.getElementById('followup-btn');
  const emptyState   = document.getElementById('closer-empty');
  const loadingEl    = document.getElementById('closer-loading');
  const resultsEl    = document.getElementById('closer-results');
  const textResult   = document.getElementById('closer-text-result');

  let sessionHistory = [];

  /* ── helpers ─────────────────────────────────── */
  function showLoading() {
    emptyState.classList.add('hidden');
    resultsEl.style.display  = 'none';
    textResult.style.display = 'none';
    loadingEl.classList.remove('hidden');
  }

  function showResults() {
    loadingEl.classList.add('hidden');
    resultsEl.style.display  = 'flex';
    textResult.style.display = 'none';
  }

  function showText() {
    loadingEl.classList.add('hidden');
    resultsEl.style.display  = 'none';
    textResult.style.display = 'flex';
  }

  function showError(msg) {
    loadingEl.classList.add('hidden');
    emptyState.classList.remove('hidden');
    emptyState.querySelector('h3').textContent = 'Error';
    emptyState.querySelector('p').textContent  = msg || 'Something went wrong. Please try again.';
  }

  /* ── Analyze ─────────────────────────────────── */
  analyzeBtn.addEventListener('click', async () => {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    sessionHistory.push(text);
    showLoading();

    try {
      const res  = await fetch('/api/closer/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyerInput: text })
      });
      const data = await res.json();

      if (data.error) { showError(data.error); return; }

      document.getElementById('res-exact').textContent  = data.exact_words    || '—';
      document.getElementById('res-psych').textContent  = data.psychology      || '—';
      document.getElementById('res-tactic').textContent = data.tactic          || '—';
      document.getElementById('res-danger').textContent = data.danger_signals  || '—';
      showResults();
    } catch (e) {
      console.error(e);
      showError('Connection failed. Make sure the server is running.');
    }
  });

  /* ── Emergency Close ─────────────────────────── */
  emergencyBtn.addEventListener('click', async () => {
    const text = input.value.trim() || 'Buyer is about to walk away.';
    sessionHistory.push(text);
    showLoading();

    try {
      const res  = await fetch('/api/closer/emergency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyerInput: text })
      });
      const data = await res.json();

      if (data.error) { showError(data.error); return; }

      document.getElementById('text-result-title').textContent   = '🚨 CLOSE NOW Script';
      document.getElementById('text-result-content').textContent = data.script || '—';
      showText();
    } catch (e) {
      console.error(e);
      showError('Connection failed. Make sure the server is running.');
    }
  });

  /* ── Follow-up ───────────────────────────────── */
  followupBtn.addEventListener('click', async () => {
    if (sessionHistory.length === 0) {
      alert('Use Analyze at least once first so CLOSER has context to write a follow-up.');
      return;
    }
    showLoading();

    try {
      const res  = await fetch('/api/closer/followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionHistory })
      });
      const data = await res.json();

      if (data.error) { showError(data.error); return; }

      document.getElementById('text-result-title').textContent   = '✉ Follow-up Message';
      document.getElementById('text-result-content').textContent = data.message || '—';
      showText();
    } catch (e) {
      console.error(e);
      showError('Connection failed. Make sure the server is running.');
    }
  });

  /* ── Enter key shortcut ──────────────────────── */
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      analyzeBtn.click();
    }
  });
});
