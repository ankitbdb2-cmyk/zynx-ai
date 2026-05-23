document.addEventListener('DOMContentLoaded', () => {
    const loginScreen     = document.getElementById('login-screen');
    const dashboardScreen = document.getElementById('dashboard-screen');
    const loginForm       = document.getElementById('login-form');
    const leadsTbody      = document.getElementById('leads-tbody');
    const propertyGrid    = document.getElementById('property-grid');
    const propEmpty       = document.getElementById('prop-empty');
    let pendingListings = [];

    const views = {
        analytics: document.getElementById('analytics-view'),
        scheduler: document.getElementById('scheduler-view'),
        leads: document.getElementById('leads-view'),
        properties: document.getElementById('properties-view')
    };

    let chartLeadsDaily = null;
    let chartFunnel = null;
    let chartHotPie = null;

    // ── Navigation ──────────────────────────────────────────────────────
    function showView(view) {
        document.querySelectorAll('.nav-item[data-view]').forEach(n => {
            n.classList.toggle('active', n.getAttribute('data-view') === view);
        });
        Object.entries(views).forEach(([key, el]) => {
            el.classList.toggle('hidden', key !== view);
        });

        if (view === 'analytics') loadWeeklyAnalytics();
        else if (view === 'scheduler') { loadAvailability(); loadViewings(); }
        else if (view === 'leads') { loadLeads(); loadSettings(); }
        else if (view === 'properties') { loadProperties(); loadPersistenceBadge(); }
    }

    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
        btn.addEventListener('click', () => showView(btn.getAttribute('data-view')));
    });

    // ── Login ───────────────────────────────────────────────────────────
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('login-btn');
        btn.textContent = 'Signing in…';
        btn.disabled = true;
        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: document.getElementById('username').value,
                    password: document.getElementById('password').value
                })
            });
            if (res.ok) {
                loginScreen.classList.add('hidden');
                dashboardScreen.classList.remove('hidden');
                showView('analytics');
            } else {
                alert('Invalid credentials.');
            }
        } catch (err) {
            alert('Connection failed.');
        } finally {
            btn.textContent = 'Sign In';
            btn.disabled = false;
        }
    });

    document.getElementById('logout-btn').addEventListener('click', () => {
        dashboardScreen.classList.add('hidden');
        loginScreen.classList.remove('hidden');
        document.getElementById('password').value = '';
    });

    document.getElementById('refresh-btn')?.addEventListener('click', loadLeads);
    document.getElementById('refresh-analytics')?.addEventListener('click', loadWeeklyAnalytics);

    // ── Agency settings ─────────────────────────────────────────────────
    async function loadSettings() {
        try {
            const res = await fetch('/api/admin/settings');
            const data = await res.json();
            if (data.settings?.agency_name) {
                document.getElementById('agency-name-input').value = data.settings.agency_name;
            }
        } catch (e) { console.error(e); }
    }

    document.getElementById('save-agency-btn')?.addEventListener('click', async () => {
        const value = document.getElementById('agency-name-input').value.trim();
        if (!value) return;
        const res = await fetch('/api/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: 'agency_name', value })
        });
        if (res.ok) flashFeedback('agency-save-feedback');
    });

    // ── Weekly Analytics ────────────────────────────────────────────────
    async function loadWeeklyAnalytics() {
        try {
            const res = await fetch('/api/admin/analytics/weekly');
            const d = await res.json();

            document.getElementById('kpi-leads').textContent = d.totalLeads ?? 0;
            document.getElementById('kpi-conversion').textContent = (d.conversionRate ?? 0) + '%';
            document.getElementById('kpi-contacted').textContent = d.hotContacted ?? 0;
            document.getElementById('kpi-missed').textContent = d.hotMissed ?? 0;
            document.getElementById('commission-input').value = d.commission || '';

            renderLeadsChart(d.leadsByDay || []);
            renderFunnelChart(d.funnel || {});
            renderHotPie(d.hotContacted ?? 0, d.hotMissed ?? 0);
        } catch (e) {
            console.error('Analytics load failed:', e);
        }
    }

    function chartDefaults() {
        return {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { labels: { color: '#94a3b8', font: { family: 'Inter' } } } },
            scales: {
                x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.04)' } },
                y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }
            }
        };
    }

    function renderLeadsChart(leadsByDay) {
        const ctx = document.getElementById('chart-leads-daily');
        if (!ctx) return;
        const labels = [];
        const data = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            labels.push(d.toLocaleDateString('en-GB', { weekday: 'short' }));
            const row = leadsByDay.find(r => r.day === key);
            data.push(row ? row.count : 0);
        }
        if (chartLeadsDaily) chartLeadsDaily.destroy();
        chartLeadsDaily = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Leads',
                    data,
                    backgroundColor: 'rgba(99,102,241,0.6)',
                    borderColor: '#6366f1',
                    borderWidth: 1,
                    borderRadius: 6
                }]
            },
            options: { ...chartDefaults(), plugins: { legend: { display: false } } }
        });
    }

    function renderFunnelChart(funnel) {
        const ctx = document.getElementById('chart-funnel');
        if (!ctx) return;
        if (chartFunnel) chartFunnel.destroy();
        chartFunnel = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Captured', 'Hot (8+)', 'Contacted', 'Booked'],
                datasets: [{
                    data: [funnel.captured || 0, funnel.hot || 0, funnel.contacted || 0, funnel.booked || 0],
                    backgroundColor: ['#6366f1', '#f97316', '#3b82f6', '#10b981'],
                    borderRadius: 6
                }]
            },
            options: {
                indexAxis: 'y',
                ...chartDefaults(),
                plugins: { legend: { display: false } }
            }
        });
    }

    function renderHotPie(contacted, missed) {
        const ctx = document.getElementById('chart-hot-pie');
        if (!ctx) return;
        if (chartHotPie) chartHotPie.destroy();
        const total = contacted + missed;
        chartHotPie = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Contacted', 'Missed'],
                datasets: [{
                    data: total ? [contacted, missed] : [1, 0],
                    backgroundColor: ['#10b981', '#ef4444'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#94a3b8' } }
                }
            }
        });
    }

    document.getElementById('save-commission-btn')?.addEventListener('click', async () => {
        const amount = document.getElementById('commission-input').value;
        const res = await fetch('/api/admin/analytics/commission', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount })
        });
        if (res.ok) flashFeedback('commission-feedback');
    });

    // ── Scheduler ───────────────────────────────────────────────────────
    document.getElementById('slot-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const slot_datetime = document.getElementById('slot-datetime').value;
        const label = document.getElementById('slot-label').value;
        const res = await fetch('/api/admin/availability', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slot_datetime, label })
        });
        if (res.ok) {
            document.getElementById('slot-form').reset();
            loadAvailability();
        }
    });

    async function loadAvailability() {
        try {
            const res = await fetch('/api/admin/availability');
            const data = await res.json();
            const slots = data.slots || [];
            const open = slots.filter(s => !s.is_booked);
            document.getElementById('slot-count').textContent = `${open.length} open`;

            const list = document.getElementById('slots-list');
            if (!slots.length) {
                list.innerHTML = '<div class="empty-state" style="padding:2rem"><div class="empty-state-sub">Add viewing slots for Sarah to offer hot leads</div></div>';
                return;
            }

            list.innerHTML = slots.map(s => {
                const dt = new Date(s.slot_datetime);
                const label = dt.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                const booked = s.is_booked;
                return `
                    <div class="slot-item ${booked ? 'booked' : ''}">
                        <div>
                            <div class="slot-time">${escHtml(s.label || label)}</div>
                            <div class="slot-meta">${booked ? `Booked · ${escHtml(s.lead_name || 'Lead')}` : 'Available'}</div>
                        </div>
                        ${!booked ? `<button class="btn btn-ghost btn-xs delete-slot" data-id="${s.id}">Remove</button>` : ''}
                    </div>`;
            }).join('');

            list.querySelectorAll('.delete-slot').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const id = btn.getAttribute('data-id');
                    await fetch(`/api/admin/availability/${id}`, { method: 'DELETE' });
                    loadAvailability();
                });
            });
        } catch (e) {
            console.error(e);
        }
    }

    async function loadViewings() {
        try {
            const res = await fetch('/api/admin/viewings');
            const data = await res.json();
            const tbody = document.getElementById('viewings-tbody');
            const viewings = data.viewings || [];
            if (!viewings.length) {
                tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No confirmed viewings yet</td></tr>';
                return;
            }
            tbody.innerHTML = viewings.map(v => {
                const dt = v.slot_datetime ? new Date(v.slot_datetime).toLocaleString('en-GB') : '—';
                return `<tr>
                    <td style="font-weight:600">${escHtml(v.name)}</td>
                    <td>${escHtml(v.phone || '—')}</td>
                    <td>${escHtml(v.area || '—')}</td>
                    <td><span class="score-badge hot">${v.hot_score}/10</span></td>
                    <td>${dt}</td>
                </tr>`;
            }).join('');
        } catch (e) {
            console.error(e);
        }
    }

    // ── Leads ───────────────────────────────────────────────────────────
    async function loadLeads() {
        try {
            const [statsRes, leadsRes] = await Promise.all([
                fetch('/api/admin/stats'),
                fetch('/api/admin/leads')
            ]);
            const stats = await statsRes.json();
            const leadsData = await leadsRes.json();

            document.getElementById('stat-total').textContent = stats.total ?? 0;
            document.getElementById('stat-hot').textContent   = stats.hot ?? 0;
            document.getElementById('stat-conv').textContent  = (stats.conversionRate ?? 0) + '%';
            document.getElementById('stat-all').textContent   = stats.allTime ?? 0;

            renderLeads(leadsData.leads || []);
        } catch (e) {
            console.error(e);
        }
    }

    function getScoreClass(score) {
        if (score >= 7) return 'hot';
        if (score >= 4) return 'warm';
        return 'cold';
    }

    function getScoreLabel(score, stage) {
        if (score >= 7) return `🔥 ${stage || 'Hot'} · ${score}/10`;
        if (score >= 4) return `⚡ ${stage || 'Warm'} · ${score}/10`;
        return `❄️ ${stage || 'Cold'} · ${score}/10`;
    }

    function renderLeads(leads) {
        leadsTbody.innerHTML = '';
        if (!leads.length) {
            leadsTbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-state-title">No leads yet</div></div></td></tr>`;
            return;
        }

        leads.forEach(lead => {
            const score = lead.hot_score || 0;
            const viewingBadge = lead.viewing_confirmed
                ? '<span class="viewing-badge confirmed">✓ Booked</span>'
                : lead.viewing_offer_sent
                    ? '<span class="viewing-badge offered">Offer sent</span>'
                    : '—';
            const dateStr = lead.date
                ? new Date(lead.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
                : '—';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="score-badge ${getScoreClass(score)}"><span class="score-dot"></span>${getScoreLabel(score, lead.lead_stage)}</span></td>
                <td style="font-weight:600">${escHtml(lead.name || 'Unknown')}</td>
                <td style="color:var(--text-subtle)">${escHtml(lead.phone || '—')}</td>
                <td style="font-weight:600;color:var(--gold)">${escHtml(lead.budget || '—')}</td>
                <td><div style="font-size:0.82rem;color:var(--text-subtle)">${escHtml(lead.area || '—')}</div></td>
                <td style="font-size:0.82rem;color:var(--text-subtle)">${escHtml(lead.timeline || '—')}</td>
                <td>${viewingBadge}</td>
                <td style="font-size:0.78rem;color:var(--text-muted)">${dateStr}</td>
                <td>
                    <select class="status-select" data-id="${lead.id}">
                        ${['New','Contacted','Visit Scheduled','Closed','Dead'].map(s =>
                            `<option value="${s}" ${lead.status === s ? 'selected' : ''}>${s}</option>`
                        ).join('')}
                    </select>
                </td>`;
            leadsTbody.appendChild(tr);
        });

        document.querySelectorAll('.status-select').forEach(sel => {
            sel.addEventListener('change', async (e) => {
                await fetch(`/api/admin/leads/${e.target.getAttribute('data-id')}/status`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: e.target.value })
                });
                loadLeads();
            });
        });
    }

    // ── Smart Paste Listings ──────────────────────────────────────────────
    async function loadPersistenceBadge() {
        try {
            const res = await fetch('/health');
            const data = await res.json();
            const badge = document.getElementById('persistence-badge');
            if (badge && data.persistence) {
                const p = data.persistence;
                badge.title = `DB: ${p.dbPath}\n${p.propertyCount} properties, ${p.leadCount} leads`;
                badge.textContent = `💾 ${p.propertyCount} listings · ${p.leadCount} leads saved`;
            }
        } catch (e) { /* ignore */ }
    }

    document.getElementById('parse-paste-btn')?.addEventListener('click', async () => {
        const rawText = document.getElementById('paste-raw').value.trim();
        if (!rawText) return alert('Paste your Property Finder listings first.');

        document.getElementById('paste-loading').classList.remove('hidden');
        document.getElementById('paste-preview').classList.add('hidden');

        try {
            const res = await fetch('/api/admin/properties/parse-paste', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rawText })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Parse failed');

            pendingListings = data.listings || [];
            if (!pendingListings.length) {
                alert('No listings found in that text. Try pasting more detail.');
                return;
            }
            renderPastePreview(pendingListings);
            document.getElementById('paste-preview').classList.remove('hidden');
            document.getElementById('paste-count').textContent = `${pendingListings.length} found`;
        } catch (e) {
            alert(e.message || 'Failed to parse listings.');
        } finally {
            document.getElementById('paste-loading').classList.add('hidden');
        }
    });

    function renderPastePreview(listings) {
        const grid = document.getElementById('paste-preview-grid');
        grid.innerHTML = listings.map((l, i) => `
            <div class="paste-preview-card">
                <span class="type-badge ${l.type.toLowerCase()}">${escHtml(l.type)}</span>
                <div class="prop-card-title" style="margin:0.5rem 0">${escHtml(l.title)}</div>
                <div style="font-size:0.82rem;color:var(--text-subtle)">📍 ${escHtml(l.area)}</div>
                <div style="font-weight:700;color:var(--gold);margin:0.35rem 0">${escHtml(l.price)}</div>
                <div style="font-size:0.78rem;color:var(--text-muted)">🛏 ${escHtml(l.bedrooms)} · ${escHtml(l.description || '')}</div>
            </div>
        `).join('');
    }

    document.getElementById('confirm-paste-btn')?.addEventListener('click', async () => {
        if (!pendingListings.length) return;
        const btn = document.getElementById('confirm-paste-btn');
        btn.textContent = 'Saving…';
        btn.disabled = true;
        try {
            const res = await fetch('/api/admin/properties/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ listings: pendingListings })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Save failed');
            pendingListings = [];
            document.getElementById('paste-raw').value = '';
            document.getElementById('paste-preview').classList.add('hidden');
            loadProperties();
            loadPersistenceBadge();
            alert(`✓ Saved ${data.saved} listings!`);
        } catch (e) {
            alert(e.message);
        } finally {
            btn.textContent = 'Save All Listings';
            btn.disabled = false;
        }
    });

    document.getElementById('cancel-paste-btn')?.addEventListener('click', () => {
        pendingListings = [];
        document.getElementById('paste-preview').classList.add('hidden');
    });

    document.getElementById('clear-paste-btn')?.addEventListener('click', () => {
        document.getElementById('paste-raw').value = '';
        pendingListings = [];
        document.getElementById('paste-preview').classList.add('hidden');
    });

    async function loadProperties() {
        try {
            const res = await fetch('/api/admin/properties');
            const data = await res.json();
            renderProperties(data.properties || []);
        } catch (e) {
            console.error(e);
        }
    }

    function renderProperties(properties) {
        propertyGrid.innerHTML = '';
        if (!properties.length) {
            propEmpty.classList.remove('hidden');
            return;
        }
        propEmpty.classList.add('hidden');
        properties.forEach(p => {
            const card = document.createElement('div');
            card.className = 'prop-card';
            card.innerHTML = `
                <div class="prop-card-top"><span class="type-badge ${p.type.toLowerCase()}">${p.type}</span></div>
                <div class="prop-card-title">${escHtml(p.title)}</div>
                <div class="prop-card-area">📍 ${escHtml(p.area)}</div>
                <div class="prop-card-price">${escHtml(p.price)}</div>
                <div class="prop-card-footer">
                    <button class="btn btn-ghost btn-xs delete-prop" data-id="${p.id}">Delete</button>
                </div>`;
            propertyGrid.appendChild(card);
        });
        document.querySelectorAll('.delete-prop').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this listing?')) return;
                await fetch(`/api/admin/properties/${btn.getAttribute('data-id')}`, { method: 'DELETE' });
                loadProperties();
            });
        });
    }

    function flashFeedback(id) {
        const fb = document.getElementById(id);
        if (!fb) return;
        fb.style.opacity = '1';
        setTimeout(() => fb.style.opacity = '0', 2500);
    }

    function escHtml(str) {
        if (!str && str !== 0) return '';
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
});
