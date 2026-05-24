document.addEventListener('DOMContentLoaded', () => {
  const loginScreen      = document.getElementById('login-screen');
  const dashboardScreen   = document.getElementById('dashboard-screen');
  const loginForm        = document.getElementById('login-form');
  const logoutBtn        = document.getElementById('logout-btn');
  const refreshBtn       = document.getElementById('refresh-btn');
  const lastUpdated      = document.getElementById('last-updated');
  const viewTitle        = document.getElementById('view-title');

  // Sidebar Nav Tabs
  const navLeads         = document.getElementById('nav-leads');
  const navProperties    = document.getElementById('nav-properties');
  const panelLeads       = document.getElementById('panel-leads');
  const panelProperties  = document.getElementById('panel-properties');

  // Leads View Elements
  const tbodyLeads       = document.getElementById('leads-tbody');

  // Properties View Elements
  const tbodyProperties  = document.getElementById('properties-tbody');
  const pasteTextarea    = document.getElementById('paste-textarea');
  const btnExtract       = document.getElementById('btn-extract');
  const btnClear         = document.getElementById('btn-clear');
  const previewArea      = document.getElementById('preview-area');
  const previewCount     = document.getElementById('preview-count');
  const previewCards     = document.getElementById('preview-cards-container');
  const btnSaveAll       = document.getElementById('btn-save-all');

  let activeTab = 'leads';
  let autoRefreshInterval = null;
  let parsedListingsStore = [];

  /* ── Auth ─────────────────────────────────────── */
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (res.ok) {
        loginScreen.classList.add('hidden');
        dashboardScreen.classList.remove('hidden');
        loadDashboard();
        startAutoRefresh();
      } else {
        showLoginError('Invalid username or password.');
      }
    } catch {
      showLoginError('Server unavailable. Please try again.');
    }
  });

  function showLoginError(msg) {
    let err = document.getElementById('login-error');
    if (!err) {
      err = document.createElement('p');
      err.id = 'login-error';
      err.style.cssText = 'color:var(--red);font-size:13px;text-align:center;margin-top:0.75rem;';
      document.getElementById('login-form').appendChild(err);
    }
    err.textContent = msg;
  }

  logoutBtn.addEventListener('click', () => {
    dashboardScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    document.getElementById('password').value = '';
    stopAutoRefresh();
  });

  refreshBtn.addEventListener('click', loadDashboard);

  /* ── Tab Switch Logic ────────────────────────── */
  navLeads.addEventListener('click', (e) => {
    e.preventDefault();
    switchTab('leads');
  });

  navProperties.addEventListener('click', (e) => {
    e.preventDefault();
    switchTab('properties');
  });

  function switchTab(tab) {
    activeTab = tab;
    if (tab === 'leads') {
      navLeads.classList.add('active');
      navProperties.classList.remove('active');
      panelLeads.classList.remove('hidden');
      panelProperties.classList.add('hidden');
      viewTitle.textContent = 'Leads Dashboard';
    } else {
      navLeads.classList.remove('active');
      navProperties.classList.add('active');
      panelLeads.classList.add('hidden');
      panelProperties.classList.remove('hidden');
      viewTitle.textContent = 'Properties Management';
    }
    loadDashboard();
  }

  /* ── Auto-Refresh (Every 60 Seconds) ──────────── */
  function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshInterval = setInterval(() => {
      console.log('Auto-refreshing Weekly Analytics and Leads...');
      loadDashboard();
    }, 60000);
  }

  function stopAutoRefresh() {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
  }

  /* ── Load Dashboard ───────────────────────────── */
  async function loadDashboard() {
    lastUpdated.textContent = 'Refreshing...';
    try {
      if (activeTab === 'leads') {
        const [statsRes, leadsRes] = await Promise.all([
          fetch('/api/admin/analytics/weekly'),
          fetch('/api/admin/leads')
        ]);
        const stats     = await statsRes.json();
        const leadsData = await leadsRes.json();

        document.getElementById('stat-total').textContent = stats.totalLeads ?? 0;
        document.getElementById('stat-hot').textContent   = stats.funnel?.hot ?? 0;
        document.getElementById('stat-conv').textContent  = (stats.conversionRate ?? 0) + '%';
        
        const comm = stats.commission > 0
          ? 'AED ' + stats.commission.toLocaleString()
          : '—';
        document.getElementById('stat-commission').textContent = comm;

        renderLeads(leadsData.leads || []);
      } else {
        const propsRes = await fetch('/api/admin/properties');
        const propsData = await propsRes.json();
        renderProperties(propsData.properties || []);
      }
      lastUpdated.textContent = 'Last updated: ' + new Date().toLocaleTimeString();
    } catch (e) {
      console.error('Dashboard load error:', e);
      lastUpdated.textContent = 'Error loading data';
    }
  }

  /* ── Render Leads ─────────────────────────────── */
  function renderLeads(leads) {
    tbodyLeads.innerHTML = '';

    if (leads.length === 0) {
      tbodyLeads.innerHTML = `<tr><td colspan="6" class="empty-state">No leads captured yet. GHOST will populate this table automatically.</td></tr>`;
      return;
    }

    leads.forEach(lead => {
      const tr  = document.createElement('tr');
      const d   = new Date(lead.date);
      const dateStr = isNaN(d)
        ? lead.date
        : d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
          + ' · '
          + d.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });

      let badgeHtml = '';
      if (lead.lead_stage === 'Hot' || (lead.hot_score && lead.hot_score >= 8)) {
        badgeHtml = ` <span class="badge red" style="margin-left: 0.5rem; box-shadow: 0 0 10px rgba(239,68,68,0.25);">Hot</span>`;
      } else if (lead.lead_stage === 'Warm' || (lead.hot_score && lead.hot_score >= 5 && lead.hot_score < 8)) {
        badgeHtml = ` <span class="badge amber" style="margin-left: 0.5rem; box-shadow: 0 0 10px rgba(245,158,11,0.25);">Warm</span>`;
      }

      tr.innerHTML = `
        <td class="lead-date">${dateStr}</td>
        <td class="lead-name">
          ${esc(lead.name || 'Unknown')}${badgeHtml}
        </td>
        <td class="lead-phone">${esc(lead.phone || '—')}</td>
        <td class="lead-budget">${esc(lead.budget || '—')}</td>
        <td><div class="psych-note" title="${esc(lead.psychology_notes || '')}">${esc(lead.psychology_notes || '—')}</div></td>
        <td>
          <select class="status-select" data-id="${lead.id}">
            <option value="New"            ${lead.status === 'New'            ? 'selected' : ''}>🔵 New</option>
            <option value="Contacted"      ${lead.status === 'Contacted'      ? 'selected' : ''}>🟡 Contacted</option>
            <option value="Visit Scheduled"${lead.status === 'Visit Scheduled'? 'selected' : ''}>🟠 Visit Scheduled</option>
            <option value="Closed"         ${lead.status === 'Closed'         ? 'selected' : ''}>🟢 Closed</option>
            <option value="Dead"           ${lead.status === 'Dead'           ? 'selected' : ''}>⚫ Dead</option>
          </select>
        </td>
      `;
      tbodyLeads.appendChild(tr);
    });

    tbodyLeads.querySelectorAll('.status-select').forEach(sel => {
      sel.addEventListener('change', async (e) => {
        const id     = e.target.getAttribute('data-id');
        const status = e.target.value;
        try {
          await fetch(`/api/admin/leads/${id}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
          });
          loadDashboard();
        } catch {
          alert('Failed to update status. Please try again.');
        }
      });
    });
  }

  /* ── Render Properties ────────────────────────── */
  function renderProperties(properties) {
    tbodyProperties.innerHTML = '';
    if (properties.length === 0) {
      tbodyProperties.innerHTML = `<tr><td colspan="7" class="empty-state">No properties found. Paste listings above to populate.</td></tr>`;
      return;
    }

    properties.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:700; color:var(--accent);">${esc(p.type)}</td>
        <td style="color:#fff; font-weight:600;">${esc(p.title)}</td>
        <td>${esc(p.area)}</td>
        <td style="font-weight:700;">${esc(p.price)}</td>
        <td>${esc(p.bedrooms)}</td>
        <td style="max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(p.description)}">${esc(p.description || '—')}</td>
        <td>
          <button class="btn btn-danger btn-delete-prop" data-id="${p.id}" style="padding:4px 8px; font-size:11px; border-radius:4px;">
            Delete
          </button>
        </td>
      `;
      tbodyProperties.appendChild(tr);
    });

    tbodyProperties.querySelectorAll('.btn-delete-prop').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.getAttribute('data-id');
        if (!confirm('Are you sure you want to delete this listing?')) return;
        try {
          const res = await fetch(`/api/admin/properties/${id}`, { method: 'DELETE' });
          if (res.ok) {
            loadDashboard();
          } else {
            alert('Failed to delete property.');
          }
        } catch {
          alert('Failed to connect to server.');
        }
      });
    });
  }

  /* ── Smart Paste Event Handlers ───────────────── */
  btnClear.addEventListener('click', () => {
    pasteTextarea.value = '';
    previewArea.classList.add('hidden');
    parsedListingsStore = [];
  });

  btnExtract.addEventListener('click', async () => {
    const rawText = pasteTextarea.value.trim();
    if (!rawText) {
      alert('Please paste some unstructured property description first!');
      return;
    }

    btnExtract.disabled = true;
    btnExtract.textContent = '🧠 AI Extracting...';

    try {
      const res = await fetch('/api/admin/properties/parse-paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'AI extraction failed.');
      }

      parsedListingsStore = data.listings || [];
      renderPreviews(parsedListingsStore);
    } catch (e) {
      alert(e.message);
    } finally {
      btnExtract.disabled = false;
      btnExtract.textContent = '⚡ Extract Listings with AI';
    }
  });

  function renderPreviews(listings) {
    previewCards.innerHTML = '';
    if (listings.length === 0) {
      previewArea.classList.add('hidden');
      return;
    }

    previewCount.textContent = listings.length;
    previewArea.classList.remove('hidden');

    listings.forEach((l, idx) => {
      const card = document.createElement('div');
      card.style.cssText = 'background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:1.25rem; position:relative;';
      card.innerHTML = `
        <div style="position:absolute; top:12px; right:12px; background:rgba(0,245,255,0.1); color:var(--accent); font-size:10px; font-weight:700; text-transform:uppercase; padding:2px 8px; border-radius:10px; border:1px solid rgba(0,245,255,0.25)">
          ${esc(l.type)}
        </div>
        <div style="font-weight:700; color:#fff; font-size:14px; margin-bottom:4px; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(l.title)}</div>
        <div style="color:var(--accent); font-size:12px; font-weight:600; margin-bottom:8px;">📍 ${esc(l.area)}</div>
        <div style="font-size:18px; font-weight:800; color:#fff; margin-bottom:8px;">${esc(l.price)}</div>
        <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">Beds: <strong>${esc(l.bedrooms)}</strong></div>
        <div style="font-size:11.5px; color:#aaa; font-style:italic; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(l.description)}">${esc(l.description || '—')}</div>
        <button class="btn btn-danger btn-remove-preview" data-index="${idx}" style="position:absolute; bottom:12px; right:12px; padding:2px 6px; font-size:10px; border-radius:4px; background:transparent; border-color:rgba(239,68,68,0.4);">Remove</button>
      `;
      previewCards.appendChild(card);
    });

    previewCards.querySelectorAll('.btn-remove-preview').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        parsedListingsStore.splice(idx, 1);
        renderPreviews(parsedListingsStore);
      });
    });
  }

  btnSaveAll.addEventListener('click', async () => {
    if (parsedListingsStore.length === 0) return;

    btnSaveAll.disabled = true;
    btnSaveAll.textContent = 'Saving...';

    try {
      const res = await fetch('/api/admin/properties/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listings: parsedListingsStore })
      });

      if (res.ok) {
        alert(`Successfully saved ${parsedListingsStore.length} properties to the database!`);
        pasteTextarea.value = '';
        previewArea.classList.add('hidden');
        parsedListingsStore = [];
        loadDashboard();
      } else {
        alert('Failed to bulk save listings.');
      }
    } catch {
      alert('Failed to connect to server.');
    } finally {
      btnSaveAll.disabled = false;
      btnSaveAll.textContent = '📥 Save All to Listings';
    }
  });

  /* ── Delete All Listings ────────────────────────── */
  document.getElementById('btn-delete-all').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to delete ALL listings? This cannot be undone.')) return;
    if (!confirm('⚠️ FINAL WARNING: This will permanently erase every property from the database.')) return;
    try {
      const res = await fetch('/api/admin/properties/all', { method: 'DELETE' });
      if (res.ok) {
        alert('All listings deleted successfully.');
        loadDashboard();
      } else {
        alert('Failed to delete all listings.');
      }
    } catch {
      alert('Failed to connect to server.');
    }
  });

  /* ── Escaping ─────────────────────────────────── */
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
});
