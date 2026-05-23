document.addEventListener('DOMContentLoaded', () => {
  const loginScreen    = document.getElementById('login-screen');
  const dashboardScreen = document.getElementById('dashboard-screen');
  const loginForm      = document.getElementById('login-form');
  const logoutBtn      = document.getElementById('logout-btn');
  const refreshBtn     = document.getElementById('refresh-btn');
  const tbody          = document.getElementById('leads-tbody');
  const lastUpdated    = document.getElementById('last-updated');

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
  });

  refreshBtn.addEventListener('click', loadDashboard);

  /* ── Load Dashboard ───────────────────────────── */
  async function loadDashboard() {
    lastUpdated.textContent = 'Refreshing...';
    try {
      const [statsRes, leadsRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/leads')
      ]);
      const stats     = await statsRes.json();
      const leadsData = await leadsRes.json();

      document.getElementById('stat-total').textContent = stats.total           ?? 0;
      document.getElementById('stat-hot').textContent   = stats.hot             ?? 0;
      document.getElementById('stat-conv').textContent  = (stats.conversionRate ?? 0) + '%';

      renderLeads(leadsData.leads || []);
      lastUpdated.textContent = 'Last updated: ' + new Date().toLocaleTimeString();
    } catch (e) {
      console.error('Dashboard load error:', e);
      lastUpdated.textContent = 'Error loading data';
    }
  }

  /* ── Render Leads ─────────────────────────────── */
  function renderLeads(leads) {
    tbody.innerHTML = '';

    if (leads.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No leads captured yet. GHOST will populate this table automatically.</td></tr>`;
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

      const statusBadge = getStatusBadge(lead.status);
      
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
      tbody.appendChild(tr);
    });

    // Status change events
    tbody.querySelectorAll('.status-select').forEach(sel => {
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

  function getStatusBadge(status) {
    const map = {
      'New':             'badge-new',
      'Contacted':       'badge-warm',
      'Visit Scheduled': 'badge-warm',
      'Closed':          'badge-closed',
      'Dead':            'badge-dead'
    };
    return map[status] || 'badge-new';
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
});
