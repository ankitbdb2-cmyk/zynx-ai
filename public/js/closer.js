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

    const grid = document.getElementById('objections-grid');
    const input = document.getElementById('buyer-input');

    objections.forEach(obj => {
        const btn = document.createElement('button');
        btn.className = 'obj-btn';
        btn.textContent = obj;
        btn.addEventListener('click', () => {
            input.value = obj;
        });
        grid.appendChild(btn);
    });

    const analyzeBtn = document.getElementById('analyze-btn');
    const emergencyBtn = document.getElementById('emergency-btn');
    const followupBtn = document.getElementById('followup-btn');
    
    const loading = document.getElementById('closer-loading');
    const results = document.getElementById('closer-results');
    const textResult = document.getElementById('closer-text-result');
    const empty = document.getElementById('closer-empty');

    let sessionHistory = [];

    function showLoading() {
        empty.classList.add('hidden');
        results.classList.add('hidden');
        textResult.classList.add('hidden');
        loading.classList.remove('hidden');
    }

    analyzeBtn.addEventListener('click', async () => {
        const text = input.value.trim();
        if (!text) return;
        
        sessionHistory.push(text);
        showLoading();

        try {
            const res = await fetch('/api/closer/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ buyerInput: text })
            });
            const data = await res.json();
            
            loading.classList.add('hidden');
            results.classList.remove('hidden');
            
            document.getElementById('res-exact').textContent = data.exact_words || 'N/A';
            document.getElementById('res-psych').textContent = data.psychology || 'N/A';
            document.getElementById('res-tactic').textContent = data.tactic || 'N/A';
            document.getElementById('res-danger').textContent = data.danger_signals || 'N/A';
        } catch (e) {
            console.error(e);
            loading.classList.add('hidden');
            empty.classList.remove('hidden');
            alert('Failed to analyze. Please try again.');
        }
    });

    emergencyBtn.addEventListener('click', async () => {
        const text = input.value.trim() || "Buyer is walking away right now.";
        sessionHistory.push(text);
        showLoading();

        try {
            const res = await fetch('/api/closer/emergency', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ buyerInput: text })
            });
            const data = await res.json();
            
            loading.classList.add('hidden');
            textResult.classList.remove('hidden');
            
            document.getElementById('text-result-title').textContent = "🚨 CLOSE NOW SCRIPT";
            document.getElementById('text-result-content').textContent = data.script || 'N/A';
        } catch (e) {
            console.error(e);
            loading.classList.add('hidden');
            empty.classList.remove('hidden');
            alert('Failed to get emergency script.');
        }
    });

    followupBtn.addEventListener('click', async () => {
        if (sessionHistory.length === 0) {
            alert('Please interact first to generate a follow-up message.');
            return;
        }
        showLoading();

        try {
            const res = await fetch('/api/closer/followup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionHistory })
            });
            const data = await res.json();
            
            loading.classList.add('hidden');
            textResult.classList.remove('hidden');
            
            document.getElementById('text-result-title').textContent = "Follow-up Message";
            // Preserve line breaks
            document.getElementById('text-result-content').innerHTML = (data.message || 'N/A').replace(/\n/g, '<br>');
        } catch (e) {
            console.error(e);
            loading.classList.add('hidden');
            empty.classList.remove('hidden');
            alert('Failed to generate follow-up message.');
        }
    });
});
