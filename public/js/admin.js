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
  let launchCountdownInterval = null;
  let silencePanelLoaded = false;

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
      loadLaunchPanel();
      loadSilencePanel();
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
        <td data-lead-id="${lead.id}">
          <select class="status-select" data-id="${lead.id}">
            <option value="New"            ${lead.status === 'New'            ? 'selected' : ''}>🔵 New</option>
            <option value="Contacted"      ${lead.status === 'Contacted'      ? 'selected' : ''}>🟡 Contacted</option>
            <option value="Visit Scheduled"${lead.status === 'Visit Scheduled'? 'selected' : ''}>🟠 Visit Scheduled</option>
            <option value="Closed"         ${lead.status === 'Closed'         ? 'selected' : ''}>🟢 Closed</option>
            <option value="Dead"           ${lead.status === 'Dead'           ? 'selected' : ''}>⚫ Dead</option>
          </select>
           ${lead.status && lead.status.includes('Visit Scheduled') ? `
          <div id="pvil-buttons-${lead.id}" style="display:flex; gap:4px; margin-top:6px;">
            <button class="btn-pvil-complete" data-lead-id="${lead.id}" style="padding:2px 8px; font-size:11px; border-radius:4px; background:rgba(0,255,136,0.12); border:1px solid rgba(0,255,136,0.3); color:#00ff88; cursor:pointer;">✅ Complete</button>
            <button class="btn-pvil-noshow" data-lead-id="${lead.id}" style="padding:2px 8px; font-size:11px; border-radius:4px; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3); color:#ef4444; cursor:pointer;">❌ No Show</button>
          </div>` : ''}
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

    // PVIL — Mark Complete / No Show buttons
    tbodyLeads.querySelectorAll('.btn-pvil-complete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.getAttribute('data-lead-id');
        document.querySelectorAll(`.btn-pvil-complete[data-lead-id="${id}"], .btn-pvil-noshow[data-lead-id="${id}"]`).forEach(b => b.disabled = true);
        try {
          const res = await fetch(`/api/admin/leads/${id}/complete-viewing`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ no_show: false })
          });
          if (res.ok) {
            loadDashboard();
          } else {
            alert('Failed to update viewing status.');
          }
        } catch {
          alert('Failed to connect to server.');
        }
      });
    });

    tbodyLeads.querySelectorAll('.btn-pvil-noshow').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.getAttribute('data-lead-id');
        document.querySelectorAll(`.btn-pvil-complete[data-lead-id="${id}"], .btn-pvil-noshow[data-lead-id="${id}"]`).forEach(b => b.disabled = true);
        try {
          const res = await fetch(`/api/admin/leads/${id}/complete-viewing`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ no_show: true })
          });
          if (res.ok) {
            loadDashboard();
          } else {
            alert('Failed to update viewing status.');
          }
        } catch {
          alert('Failed to connect to server.');
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

  /* ── LAUNCH MODE PANEL ─────────────────────────── */

  function clearLaunchCountdown() {
    if (launchCountdownInterval) {
      clearInterval(launchCountdownInterval);
      launchCountdownInterval = null;
    }
  }

  async function loadLaunchPanel() {
    clearLaunchCountdown();
    let container = document.getElementById('launch-panel');
    if (!container) {
      container = document.createElement('div');
      container.id = 'launch-panel';
      panelLeads.parentNode.insertBefore(container, panelLeads.nextSibling);
    }
    const res = await fetch('/api/admin/launches/active');
    const data = await res.json();
    if (data.active) {
      renderActiveLaunch(data.launch);
    } else {
      renderLaunchForm();
    }
  }

  function renderActiveLaunch(launch) {
    const wrapper = document.createElement('div');
    Object.assign(wrapper.style, {
      background: '#0D0D12', border: '1px solid rgba(201,168,76,0.22)',
      borderRadius: '12px', padding: '24px', marginBottom: '24px'
    });

    const statusRow = document.createElement('div');
    statusRow.style.display = 'flex';
    statusRow.style.alignItems = 'center';

    const badge = document.createElement('span');
    badge.textContent = '🟢 LAUNCH ACTIVE';
    Object.assign(badge.style, {
      fontFamily: 'Inter', fontSize: '11px', letterSpacing: '0.08em',
      textTransform: 'uppercase', color: '#2ECC71', marginRight: '12px'
    });

    const title = document.createElement('span');
    title.textContent = launch.project + ' by ' + launch.developer;
    Object.assign(title.style, {
      fontFamily: 'Playfair Display, serif', fontSize: '18px', color: '#E8E8F0'
    });

    statusRow.appendChild(badge);
    statusRow.appendChild(title);
    wrapper.appendChild(statusRow);

    const countdownBlock = document.createElement('div');
    countdownBlock.style.marginTop = '20px';
    countdownBlock.style.marginBottom = '20px';

    const countdownLabel = document.createElement('span');
    countdownLabel.textContent = 'EXPIRES IN';
    Object.assign(countdownLabel.style, {
      display: 'block', fontFamily: 'Inter', fontSize: '11px',
      letterSpacing: '0.1em', color: 'rgba(232,232,240,0.55)',
      textTransform: 'uppercase', marginBottom: '4px'
    });

    const countdownTimer = document.createElement('span');
    countdownTimer.id = 'launch-countdown';
    Object.assign(countdownTimer.style, {
      display: 'block', fontFamily: 'JetBrains Mono, monospace',
      fontSize: '28px', color: '#C9A84C'
    });

    countdownBlock.appendChild(countdownLabel);
    countdownBlock.appendChild(countdownTimer);
    wrapper.appendChild(countdownBlock);

    clearLaunchCountdown();
    launchCountdownInterval = setInterval(() => {
      const el = document.getElementById('launch-countdown');
      if (!el) { clearLaunchCountdown(); return; }
      const remaining = new Date(launch.expires_at).getTime() - Date.now();
      if (remaining <= 0) {
        el.textContent = 'EXPIRED';
        clearLaunchCountdown();
        loadLaunchPanel();
        return;
      }
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      el.textContent =
        String(h).padStart(2, '0') + ':' +
        String(m).padStart(2, '0') + ':' +
        String(s).padStart(2, '0');
    }, 1000);

    const detailsGrid = document.createElement('div');
    Object.assign(detailsGrid.style, {
      display: 'grid', gridTemplateColumns: '1fr 1fr',
      gap: '12px', marginBottom: '20px'
    });

    const fields = [
      { label: 'PAYMENT PLAN', value: launch.payment_plan || '—' },
      { label: 'HANDOVER', value: launch.handover_date || '—' },
      { label: 'PRICE FLOOR', value: launch.price_floor
          ? 'AED ' + Number(launch.price_floor).toLocaleString() : '—' },
      { label: 'GOLDEN VISA', value: launch.golden_visa ? 'Yes ✓' : 'No' },
      { label: 'ROI PROJECTION', value: launch.roi_projection || '—' },
      { label: 'NOTES', value: launch.notes || '—' }
    ];

    for (const f of fields) {
      const cell = document.createElement('div');
      const label = document.createElement('span');
      label.textContent = f.label;
      Object.assign(label.style, {
        fontFamily: 'Inter', fontSize: '11px', color: 'rgba(232,232,240,0.55)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        display: 'block', marginBottom: '3px'
      });
      const val = document.createElement('span');
      val.textContent = f.value;
      Object.assign(val.style, {
        fontFamily: 'Inter', fontSize: '14px', color: '#E8E8F0'
      });
      cell.appendChild(label);
      cell.appendChild(val);
      detailsGrid.appendChild(cell);
    }

    wrapper.appendChild(detailsGrid);

    const actionRow = document.createElement('div');
    Object.assign(actionRow.style, {
      display: 'flex', gap: '12px', alignItems: 'center', marginTop: '4px'
    });

    const statusNode = document.createElement('span');
    statusNode.id = 'launch-action-status';
    Object.assign(statusNode.style, {
      fontSize: '12px', color: '#FF4757', fontFamily: 'Inter'
    });

    const extendBtn = document.createElement('button');
    Object.assign(extendBtn.style, {
      background: 'transparent', border: '1px solid rgba(201,168,76,0.22)',
      borderRadius: '8px', padding: '10px 20px', color: '#C9A84C',
      fontFamily: 'Inter, sans-serif', fontSize: '13px', cursor: 'pointer',
      letterSpacing: '0.04em', textTransform: 'uppercase'
    });
    extendBtn.textContent = 'Extend +24h';
    extendBtn.addEventListener('click', async () => {
      const res = await fetch('/api/admin/launches/' + launch.id + '/extend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: 24 })
      });
      if (res.ok) {
        clearLaunchCountdown();
        loadDashboard();
      } else {
        statusNode.textContent = 'Extend failed';
      }
    });

    const deactivateBtn = document.createElement('button');
    Object.assign(deactivateBtn.style, {
      background: 'transparent', border: '1px solid rgba(255,71,87,0.4)',
      borderRadius: '8px', padding: '10px 20px', color: '#FF4757',
      fontFamily: 'Inter, sans-serif', fontSize: '13px', cursor: 'pointer',
      letterSpacing: '0.04em', textTransform: 'uppercase'
    });
    deactivateBtn.textContent = 'Deactivate';
    deactivateBtn.addEventListener('click', async () => {
      const res = await fetch('/api/admin/launches/' + launch.id + '/deactivate', {
        method: 'POST'
      });
      if (res.ok) {
        clearLaunchCountdown();
        loadDashboard();
      } else {
        statusNode.textContent = 'Deactivate failed';
      }
    });

    actionRow.appendChild(statusNode);
    actionRow.appendChild(extendBtn);
    actionRow.appendChild(deactivateBtn);
    wrapper.appendChild(actionRow);

    const container = document.getElementById('launch-panel');
    container.innerHTML = '';
    container.appendChild(wrapper);
  }

  function renderLaunchForm() {
    const wrapper = document.createElement('div');
    Object.assign(wrapper.style, {
      background: '#0D0D12', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '12px', padding: '24px', marginBottom: '24px'
    });

    const badge = document.createElement('span');
    badge.textContent = '🔴 No Launch Active';
    Object.assign(badge.style, {
      fontFamily: 'Inter', fontSize: '11px', letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'rgba(232,232,240,0.30)',
      display: 'block', marginBottom: '20px'
    });
    wrapper.appendChild(badge);

    const heading = document.createElement('span');
    heading.textContent = 'Activate Launch Mode';
    Object.assign(heading.style, {
      fontFamily: 'Playfair Display, serif', fontSize: '20px',
      color: '#E8E8F0', display: 'block', marginBottom: '20px'
    });
    wrapper.appendChild(heading);

    const formWrapper = document.createElement('div');

    function inputStyle(el) {
      Object.assign(el.style, {
        background: '#13131A', border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '8px', padding: '10px 14px', color: '#E8E8F0',
        fontFamily: 'Inter, sans-serif', fontSize: '14px', width: '100%',
        boxSizing: 'border-box', outline: 'none', display: 'block'
      });
      el.addEventListener('focus', () => el.style.borderColor = 'rgba(201,168,76,0.4)');
      el.addEventListener('blur', () => el.style.borderColor = 'rgba(255,255,255,0.06)');
    }

    function labelStyle(el) {
      Object.assign(el.style, {
        fontFamily: 'Inter, sans-serif', fontSize: '11px',
        color: 'rgba(232,232,240,0.55)', letterSpacing: '0.06em',
        textTransform: 'uppercase', display: 'block', marginBottom: '6px'
      });
    }

    function makeField(id, labelText, placeholder, tag) {
      const wrap = document.createElement('div');
      wrap.style.marginBottom = '16px';
      const lbl = document.createElement('span');
      lbl.textContent = labelText;
      labelStyle(lbl);
      const el = document.createElement(tag || 'input');
      el.id = id;
      if (tag !== 'textarea') el.type = tag === 'number' ? 'number' : 'text';
      if (placeholder) el.placeholder = placeholder;
      if (tag === 'textarea') el.rows = 3;
      inputStyle(el);
      wrap.appendChild(lbl);
      wrap.appendChild(el);
      return wrap;
    }

    formWrapper.appendChild(makeField('lm-developer', 'Developer *', 'Emaar, Nakheel, Damac...', 'text'));
    formWrapper.appendChild(makeField('lm-project', 'Project *', 'Project name', 'text'));
    formWrapper.appendChild(makeField('lm-payment-plan', 'Payment Plan', 'e.g. 20/80, Post-handover', 'text'));
    formWrapper.appendChild(makeField('lm-handover-date', 'Handover Date', 'e.g. Q4 2026', 'text'));
    formWrapper.appendChild(makeField('lm-price-floor', 'Price Floor (AED)', '1500000', 'number'));
    formWrapper.appendChild(makeField('lm-roi', 'ROI Projection', 'e.g. 6–8% net yield', 'text'));
    formWrapper.appendChild(makeField('lm-notes', 'Notes', 'Internal notes for SARAH...', 'textarea'));

    const gvRow = document.createElement('div');
    Object.assign(gvRow.style, {
      display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px'
    });

    const gvCheck = document.createElement('input');
    gvCheck.type = 'checkbox';
    gvCheck.id = 'lm-golden-visa';

    const gvLabel = document.createElement('span');
    gvLabel.textContent = 'Eligible for Golden Visa';
    Object.assign(gvLabel.style, {
      fontFamily: 'Inter', fontSize: '13px', color: '#E8E8F0'
    });

    gvRow.appendChild(gvCheck);
    gvRow.appendChild(gvLabel);
    formWrapper.appendChild(gvRow);

    const statusNode = document.createElement('span');
    statusNode.id = 'launch-form-status';
    Object.assign(statusNode.style, {
      display: 'block', marginTop: '8px', fontFamily: 'Inter',
      fontSize: '12px', color: '#FF4757'
    });
    formWrapper.appendChild(statusNode);

    const activateBtn = document.createElement('button');
    activateBtn.textContent = 'Activate Launch Mode';
    Object.assign(activateBtn.style, {
      background: 'linear-gradient(135deg, #C9A84C, #F0CC6E)',
      border: 'none', borderRadius: '8px', padding: '12px 28px',
      color: '#050508', fontFamily: 'Inter, sans-serif', fontSize: '13px',
      fontWeight: '600', cursor: 'pointer', letterSpacing: '0.06em',
      textTransform: 'uppercase', marginTop: '8px'
    });
    activateBtn.addEventListener('click', () => {
      const developer    = document.getElementById('lm-developer').value.trim();
      const project      = document.getElementById('lm-project').value.trim();
      const payment_plan = document.getElementById('lm-payment-plan').value.trim();
      const handover_date = document.getElementById('lm-handover-date').value.trim();
      const price_floor  = document.getElementById('lm-price-floor').value;
      const roi_projection = document.getElementById('lm-roi').value.trim();
      const notes        = document.getElementById('lm-notes').value.trim();
      const golden_visa  = document.getElementById('lm-golden-visa').checked;
      if (!developer || !project) {
        statusNode.textContent = 'Developer and project are required';
        return;
      }
      activateLaunch({ developer, project, payment_plan, handover_date,
                       price_floor, roi_projection, notes, golden_visa });
    });

    formWrapper.appendChild(activateBtn);

    wrapper.appendChild(formWrapper);

    const container = document.getElementById('launch-panel');
    container.innerHTML = '';
    container.appendChild(wrapper);
  }

  async function activateLaunch(formData) {
    const statusNode = document.getElementById('launch-form-status');
    const res = await fetch('/api/admin/launches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    if (res.ok) {
      loadDashboard();
    } else {
      const err = await res.json().catch(() => ({}));
      if (statusNode) {
        statusNode.textContent = err.error || 'Activation failed';
      }
    }
  }

  /* ── SILENCE DECODER PANEL ─────────────────────── */

  async function loadSilencePanel() {
    silencePanelLoaded = true;
    const res = await fetch('/api/admin/silence-profiles');
    const data = await res.json();
    renderSilenceProfiles(data.profiles || []);
  }

  function renderSilenceProfiles(profiles) {
    let panel = document.getElementById('silence-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'silence-panel';
      panelLeads.parentNode.insertBefore(panel, panelLeads.nextSibling);
    }
    panel.innerHTML = '';

    if (profiles.length === 0) {
      const empty = document.createElement('div');
      empty.style.textAlign = 'center';
      empty.style.padding = '48px 24px';

      const icon = document.createElement('span');
      icon.textContent = '🔇';
      icon.style.display = 'block';
      icon.style.fontSize = '32px';
      icon.style.marginBottom = '12px';

      const heading = document.createElement('span');
      heading.textContent = 'No Silent Leads';
      heading.style.display = 'block';
      heading.style.fontFamily = 'Playfair Display, serif';
      heading.style.fontSize = '18px';
      heading.style.color = '#E8E8F0';
      heading.style.marginBottom = '8px';

      const sub = document.createElement('span');
      sub.textContent = 'All hot leads are actively engaged';
      sub.style.display = 'block';
      sub.style.fontFamily = 'Inter, sans-serif';
      sub.style.fontSize = '13px';
      sub.style.color = 'rgba(232,232,240,0.55)';

      empty.appendChild(icon);
      empty.appendChild(heading);
      empty.appendChild(sub);
      panel.appendChild(empty);
      return;
    }

    const headerRow = document.createElement('div');
    headerRow.style.display = 'flex';
    headerRow.style.justifyContent = 'space-between';
    headerRow.style.alignItems = 'center';
    headerRow.style.marginBottom = '20px';

    const headerTitle = document.createElement('span');
    headerTitle.textContent = 'Silent Objection Profiles';
    headerTitle.style.fontFamily = 'Playfair Display, serif';
    headerTitle.style.fontSize = '20px';
    headerTitle.style.color = '#E8E8F0';

    const headerCount = document.createElement('span');
    headerCount.textContent = profiles.length + ' active';
    headerCount.style.fontFamily = 'JetBrains Mono, monospace';
    headerCount.style.fontSize = '12px';
    headerCount.style.color = 'rgba(232,232,240,0.55)';

    headerRow.appendChild(headerTitle);
    headerRow.appendChild(headerCount);
    panel.appendChild(headerRow);

    for (const profile of profiles) {
      const card = document.createElement('div');
      card.style.background = '#0D0D12';
      card.style.border = '1px solid rgba(255,255,255,0.06)';
      card.style.borderRadius = '12px';
      card.style.padding = '24px';
      card.style.marginBottom = '16px';

      const cardHeader = document.createElement('div');
      cardHeader.style.display = 'flex';
      cardHeader.style.justifyContent = 'space-between';
      cardHeader.style.alignItems = 'flex-start';
      cardHeader.style.marginBottom = '20px';

      const leftBlock = document.createElement('div');

      const nameEl = document.createElement('span');
      nameEl.textContent = profile.name;
      nameEl.style.display = 'block';
      nameEl.style.fontFamily = 'Playfair Display, serif';
      nameEl.style.fontSize = '16px';
      nameEl.style.color = '#E8E8F0';
      nameEl.style.marginBottom = '6px';

      const metaRow = document.createElement('div');
      metaRow.style.display = 'flex';
      metaRow.style.gap = '8px';
      metaRow.style.alignItems = 'center';

      const natBadge = document.createElement('span');
      natBadge.textContent = profile.nationality || 'Unknown';
      natBadge.style.fontFamily = 'Inter';
      natBadge.style.fontSize = '10px';
      natBadge.style.letterSpacing = '0.08em';
      natBadge.style.textTransform = 'uppercase';
      natBadge.style.padding = '3px 8px';
      natBadge.style.background = 'rgba(201,168,76,0.12)';
      natBadge.style.border = '1px solid rgba(201,168,76,0.22)';
      natBadge.style.borderRadius = '4px';
      natBadge.style.color = '#C9A84C';

      const budgetEl = document.createElement('span');
      budgetEl.textContent = profile.budget
        ? 'AED ' + Number(profile.budget).toLocaleString()
        : 'Budget unknown';
      budgetEl.style.fontFamily = 'JetBrains Mono, monospace';
      budgetEl.style.fontSize = '12px';
      budgetEl.style.color = 'rgba(232,232,240,0.55)';

      const stageEl = document.createElement('span');
      stageEl.textContent = profile.lead_stage || profile.status || '—';
      stageEl.style.fontFamily = 'Inter';
      stageEl.style.fontSize = '11px';
      stageEl.style.color = 'rgba(232,232,240,0.40)';

      metaRow.appendChild(natBadge);
      metaRow.appendChild(budgetEl);
      metaRow.appendChild(stageEl);

      leftBlock.appendChild(nameEl);
      leftBlock.appendChild(metaRow);

      const rightBlock = document.createElement('div');
      rightBlock.style.textAlign = 'right';

      const hSilent = Math.floor((Date.now() / 1000 - profile.generated_at) / 3600);
      const silentEl = document.createElement('span');
      silentEl.textContent = hSilent + 'h silent';
      silentEl.style.display = 'block';
      silentEl.style.fontFamily = 'JetBrains Mono, monospace';
      silentEl.style.fontSize = '13px';
      silentEl.style.color = '#FF4757';
      silentEl.style.marginBottom = '4px';

      const typeBadge = document.createElement('span');
      const stageStr = (profile.stage || profile.lead_stage || '').toLowerCase();
      typeBadge.textContent = stageStr.includes('view') ? 'POST-VIEWING' : 'HOT LEAD';
      typeBadge.style.fontFamily = 'Inter';
      typeBadge.style.fontSize = '10px';
      typeBadge.style.letterSpacing = '0.06em';
      typeBadge.style.color = 'rgba(232,232,240,0.40)';
      typeBadge.style.textTransform = 'uppercase';

      rightBlock.appendChild(silentEl);
      rightBlock.appendChild(typeBadge);

      cardHeader.appendChild(leftBlock);
      cardHeader.appendChild(rightBlock);
      card.appendChild(cardHeader);

      const insightsGrid = document.createElement('div');
      insightsGrid.style.display = 'grid';
      insightsGrid.style.gridTemplateColumns = '1fr';
      insightsGrid.style.gap = '12px';
      insightsGrid.style.marginBottom = '20px';

      const insightFields = [
        { label: 'THE FEAR', value: profile.fear, accent: '#FF4757', border: 'rgba(255,71,87,0.2)' },
        { label: 'DO NOT DO THIS', value: profile.what_not_to_do, accent: '#F0CC6E', border: 'rgba(240,204,110,0.2)' },
        { label: 'COUNTER-MOVE', value: profile.counter_move, accent: '#2ECC71', border: 'rgba(46,204,113,0.2)' }
      ];

      for (const f of insightFields) {
        const insight = document.createElement('div');
        insight.style.background = '#13131A';
        insight.style.border = '1px solid ' + f.border;
        insight.style.borderRadius = '8px';
        insight.style.padding = '16px';

        const label = document.createElement('span');
        label.textContent = f.label;
        label.style.display = 'block';
        label.style.fontFamily = 'Inter';
        label.style.fontSize = '10px';
        label.style.letterSpacing = '0.1em';
        label.style.textTransform = 'uppercase';
        label.style.color = f.accent;
        label.style.marginBottom = '8px';

        const val = document.createElement('span');
        val.textContent = f.value;
        val.style.display = 'block';
        val.style.fontFamily = 'Inter';
        val.style.fontSize = '13px';
        val.style.color = '#E8E8F0';
        val.style.lineHeight = '1.6';

        insight.appendChild(label);
        insight.appendChild(val);
        insightsGrid.appendChild(insight);
      }

      card.appendChild(insightsGrid);

      const dismissRow = document.createElement('div');
      dismissRow.style.display = 'flex';
      dismissRow.style.justifyContent = 'flex-end';
      dismissRow.style.gap = '12px';
      dismissRow.style.alignItems = 'center';

      const statusEl = document.createElement('span');
      statusEl.id = 'silence-status-' + profile.id;
      statusEl.style.fontFamily = 'Inter';
      statusEl.style.fontSize = '12px';
      statusEl.style.color = '#FF4757';

      const dismissBtn = document.createElement('button');
      dismissBtn.textContent = 'Dismiss';
      Object.assign(dismissBtn.style, {
        background: 'transparent',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '8px', padding: '8px 18px',
        color: 'rgba(232,232,240,0.55)',
        fontFamily: 'Inter, sans-serif', fontSize: '12px',
        cursor: 'pointer', letterSpacing: '0.04em',
        textTransform: 'uppercase'
      });
      dismissBtn.addEventListener('click', () => dismissSilenceProfile(profile.id));

      dismissRow.appendChild(statusEl);
      dismissRow.appendChild(dismissBtn);
      card.appendChild(dismissRow);

      panel.appendChild(card);
    }
  }

  async function dismissSilenceProfile(profileId) {
    const statusEl = document.getElementById('silence-status-' + profileId);
    const res = await fetch('/api/admin/silence-profiles/' + profileId + '/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (res.ok) {
      loadDashboard();
    } else {
      if (statusEl) statusEl.textContent = 'Dismiss failed';
    }
  }
});
