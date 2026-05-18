document.addEventListener('DOMContentLoaded', () => {
    // ── DOM refs ────────────────────────────────────────────────────────
    const loginScreen     = document.getElementById('login-screen');
    const dashboardScreen = document.getElementById('dashboard-screen');
    const loginForm       = document.getElementById('login-form');
    const navLeads        = document.getElementById('nav-leads');
    const navProperties   = document.getElementById('nav-properties');
    const leadsView       = document.getElementById('leads-view');
    const propertiesView  = document.getElementById('properties-view');
    const refreshBtn      = document.getElementById('refresh-btn');
    const logoutBtn       = document.getElementById('logout-btn');
    const addPropBtn      = document.getElementById('add-prop-btn');
    const propModal       = document.getElementById('prop-modal');
    const propForm        = document.getElementById('prop-form');
    const closeModalBtn   = document.getElementById('close-modal');
    const cancelModalBtn  = document.getElementById('cancel-modal');
    const leadsTbody      = document.getElementById('leads-tbody');
    const propertyGrid    = document.getElementById('property-grid');
    const propEmpty       = document.getElementById('prop-empty');

    // ── Navigation ──────────────────────────────────────────────────────
    function showView(view) {
        if (view === 'leads') {
            navLeads.classList.add('active');
            navProperties.classList.remove('active');
            leadsView.classList.remove('hidden');
            propertiesView.classList.add('hidden');
            loadLeads();
        } else {
            navProperties.classList.add('active');
            navLeads.classList.remove('active');
            propertiesView.classList.remove('hidden');
            leadsView.classList.add('hidden');
            loadProperties();
        }
    }

    navLeads.addEventListener('click', () => showView('leads'));
    navProperties.addEventListener('click', () => showView('properties'));

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
                loadLeads();
                loadSettings();
            } else {
                alert('Invalid credentials. Please try again.');
            }
        } catch (err) {
            console.error('Login error:', err);
            alert('Connection failed. Please try again.');
        } finally {
            btn.textContent = 'Sign In';
            btn.disabled = false;
        }
    });

    // ── Logout ──────────────────────────────────────────────────────────
    logoutBtn.addEventListener('click', () => {
        dashboardScreen.classList.add('hidden');
        loginScreen.classList.remove('hidden');
        document.getElementById('password').value = '';
    });

    // ── Refresh ─────────────────────────────────────────────────────────
    refreshBtn.addEventListener('click', loadLeads);

    // ── Agency Name ─────────────────────────────────────────────────────
    async function loadSettings() {
        try {
            const res = await fetch('/api/admin/settings');
            const data = await res.json();
            if (data.settings && data.settings.agency_name) {
                document.getElementById('agency-name-input').value = data.settings.agency_name;
            }
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    }

    document.getElementById('save-agency-btn').addEventListener('click', async () => {
        const value = document.getElementById('agency-name-input').value.trim();
        if (!value) return;
        try {
            const res = await fetch('/api/admin/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'agency_name', value })
            });
            if (res.ok) {
                const fb = document.getElementById('agency-save-feedback');
                fb.style.opacity = '1';
                setTimeout(() => fb.style.opacity = '0', 2500);
            }
        } catch (e) {
            console.error('Failed to save agency name:', e);
        }
    });

    // ── Load Leads ──────────────────────────────────────────────────────
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
            console.error('Failed to load leads:', e);
        }
    }

    // ── Render Leads ────────────────────────────────────────────────────
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

        if (leads.length === 0) {
            leadsTbody.innerHTML = `
                <tr><td colspan="9">
                    <div class="empty-state">
                        <div class="empty-state-icon">📭</div>
                        <div class="empty-state-title">No leads yet</div>
                        <div class="empty-state-sub">Leads appear here when visitors chat with Sarah</div>
                    </div>
                </td></tr>`;
            return;
        }

        leads.forEach(lead => {
            const score = lead.hot_score || 0;
            const cls   = getScoreClass(score);
            const label = getScoreLabel(score, lead.lead_stage);

            const dateStr = lead.date
                ? new Date(lead.date).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
                : '—';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <span class="score-badge ${cls}">
                        <span class="score-dot"></span>${label}
                    </span>
                </td>
                <td style="font-weight:600; color:var(--text)">${escHtml(lead.name || 'Unknown')}</td>
                <td style="color:var(--text-subtle)">${escHtml(lead.phone || '—')}</td>
                <td style="font-weight:600; color:var(--gold)">${escHtml(lead.budget || '—')}</td>
                <td>
                    <div style="color:var(--text-subtle); font-size:0.82rem">${escHtml(lead.area || '—')}</div>
                    <div style="color:var(--text-muted); font-size:0.75rem">${escHtml(lead.bedrooms || '')}</div>
                </td>
                <td style="color:var(--text-subtle); font-size:0.82rem">${escHtml(lead.timeline || lead.visit_time || '—')}</td>
                <td class="notes-cell">${escHtml(lead.signals || lead.psychology_notes || '—')}</td>
                <td style="color:var(--text-muted); font-size:0.78rem; white-space:nowrap">${dateStr}</td>
                <td>
                    <select class="status-select" data-id="${lead.id}">
                        <option value="New"            ${lead.status === 'New'            ? 'selected' : ''}>New</option>
                        <option value="Contacted"      ${lead.status === 'Contacted'      ? 'selected' : ''}>Contacted</option>
                        <option value="Visit Scheduled"${lead.status === 'Visit Scheduled'? 'selected' : ''}>Visit Scheduled</option>
                        <option value="Closed"         ${lead.status === 'Closed'         ? 'selected' : ''}>Closed</option>
                        <option value="Dead"           ${lead.status === 'Dead'           ? 'selected' : ''}>Dead</option>
                    </select>
                </td>
            `;
            leadsTbody.appendChild(tr);
        });

        document.querySelectorAll('.status-select').forEach(sel => {
            sel.addEventListener('change', async (e) => {
                const id     = e.target.getAttribute('data-id');
                const status = e.target.value;
                try {
                    await fetch(`/api/admin/leads/${id}/status`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status })
                    });
                    loadLeads();
                } catch (err) {
                    console.error('Failed to update status:', err);
                }
            });
        });
    }

    // ── Load Properties ─────────────────────────────────────────────────
    async function loadProperties() {
        try {
            const res  = await fetch('/api/admin/properties');
            const data = await res.json();
            renderProperties(data.properties || []);
        } catch (e) {
            console.error('Failed to load properties:', e);
        }
    }

    // ── Render Properties as Cards ───────────────────────────────────────
    function renderProperties(properties) {
        propertyGrid.innerHTML = '';

        if (properties.length === 0) {
            propEmpty.classList.remove('hidden');
            return;
        }

        propEmpty.classList.add('hidden');

        properties.forEach(p => {
            const card = document.createElement('div');
            card.className = 'prop-card';
            card.innerHTML = `
                <div class="prop-card-top">
                    <span class="type-badge ${p.type.toLowerCase()}">${p.type}</span>
                </div>
                <div>
                    <div class="prop-card-title">${escHtml(p.title)}</div>
                    <div class="prop-card-area">📍 ${escHtml(p.area)}</div>
                </div>
                <div class="prop-card-price">${escHtml(p.price)}</div>
                <div class="prop-card-meta">
                    <span class="prop-meta-chip">🛏 ${escHtml(p.bedrooms)}</span>
                    <span class="prop-meta-chip">${escHtml(p.availability || 'Available')}</span>
                </div>
                <div class="prop-card-desc">${escHtml(p.description || '')}</div>
                <div class="prop-card-footer">
                    <button class="btn btn-ghost btn-xs delete-prop" data-id="${p.id}" title="Delete listing">
                        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                        Delete
                    </button>
                </div>
            `;
            propertyGrid.appendChild(card);
        });

        document.querySelectorAll('.delete-prop').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if (!confirm('Delete this listing? Sarah will no longer recommend it.')) return;
                const id = e.currentTarget.getAttribute('data-id');
                try {
                    await fetch(`/api/admin/properties/${id}`, { method: 'DELETE' });
                    loadProperties();
                } catch (err) {
                    console.error('Failed to delete property:', err);
                }
            });
        });
    }

    // ── Modal ────────────────────────────────────────────────────────────
    addPropBtn.addEventListener('click', () => propModal.classList.remove('hidden'));
    closeModalBtn.addEventListener('click', () => propModal.classList.add('hidden'));
    cancelModalBtn.addEventListener('click', () => propModal.classList.add('hidden'));

    propModal.addEventListener('click', (e) => {
        if (e.target === propModal) propModal.classList.add('hidden');
    });

    propForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const propData = {
            type:         document.getElementById('prop-type').value,
            title:        document.getElementById('prop-title').value,
            area:         document.getElementById('prop-area').value,
            price:        document.getElementById('prop-price').value,
            bedrooms:     document.getElementById('prop-beds').value,
            description:  document.getElementById('prop-desc').value,
            availability: 'Available now'
        };

        try {
            const res = await fetch('/api/admin/properties', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(propData)
            });
            if (res.ok) {
                propModal.classList.add('hidden');
                propForm.reset();
                loadProperties();
            }
        } catch (err) {
            console.error('Failed to save property:', err);
        }
    });

    // ── Utility ──────────────────────────────────────────────────────────
    function escHtml(str) {
        if (!str && str !== 0) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
});
