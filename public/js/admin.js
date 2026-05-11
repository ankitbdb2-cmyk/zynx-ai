document.addEventListener('DOMContentLoaded', () => {
    const loginScreen = document.getElementById('login-screen');
    const dashboardScreen = document.getElementById('dashboard-screen');
    const loginForm = document.getElementById('login-form');
    const refreshBtn = document.getElementById('refresh-btn');
    const tbody = document.getElementById('leads-tbody');
    const navLeads = document.getElementById('nav-leads');
    const navProperties = document.getElementById('nav-properties');
    const leadsView = document.getElementById('leads-view');
    const propertiesView = document.getElementById('properties-view');
    const propertiesTbody = document.getElementById('properties-tbody');
    const addPropBtn = document.getElementById('add-prop-btn');
    const propModal = document.getElementById('prop-modal');
    const propForm = document.getElementById('prop-form');
    const closeModal = document.getElementById('close-modal');

    // Navigation switching
    navLeads.addEventListener('click', (e) => {
        e.preventDefault();
        navLeads.classList.add('active');
        navProperties.classList.remove('active');
        leadsView.classList.remove('hidden');
        propertiesView.classList.add('hidden');
        loadLeads();
    });

    navProperties.addEventListener('click', (e) => {
        e.preventDefault();
        navProperties.classList.add('active');
        navLeads.classList.remove('active');
        propertiesView.classList.remove('hidden');
        leadsView.classList.add('hidden');
        loadProperties();
    });

    // Use backend auth
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = document.getElementById('username').value;
        const pass = document.getElementById('password').value;

        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: user, password: pass })
            });

            if (res.ok) {
                loginScreen.classList.add('hidden');
                dashboardScreen.classList.remove('hidden');
                loadLeads();
            } else {
                alert('Invalid credentials');
            }
        } catch (error) {
            console.error('Login error:', error);
            alert('Failed to login. Please try again.');
        }
    });

    const logoutAction = () => {
        dashboardScreen.classList.add('hidden');
        loginScreen.classList.remove('hidden');
        document.getElementById('password').value = '';
    };

    document.getElementById('logout-btn-leads').addEventListener('click', logoutAction);
    document.getElementById('logout-btn-props').addEventListener('click', logoutAction);

    refreshBtn.addEventListener('click', loadLeads);

    async function loadLeads() {
        try {
            // Load stats
            const statsRes = await fetch('/api/admin/stats');
            const stats = await statsRes.json();
            document.getElementById('stat-total').textContent = stats.total || 0;
            document.getElementById('stat-hot').textContent = stats.hot || 0;
            document.getElementById('stat-conv').textContent = (stats.conversionRate || 0) + '%';

            // Load leads
            const leadsRes = await fetch('/api/admin/leads');
            const leadsData = await leadsRes.json();
            renderLeads(leadsData.leads || []);
        } catch (e) {
            console.error('Failed to load leads', e);
        }
    }

    async function loadProperties() {
        try {
            const res = await fetch('/api/admin/properties');
            const data = await res.json();
            renderProperties(data.properties || []);
        } catch (e) {
            console.error('Failed to load properties', e);
        }
    }

    function renderLeads(leads) {
        tbody.innerHTML = '';
        if (leads.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 2rem;">No leads found.</td></tr>`;
            return;
        }

        leads.forEach(lead => {
            const tr = document.createElement('tr');
            const dateObj = new Date(lead.date);
            const dateStr = isNaN(dateObj) ? lead.date : dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            tr.innerHTML = `
                <td style="font-size: 0.85rem; color: var(--text-muted);">${dateStr}</td>
                <td style="font-weight: 600;">${lead.name || 'Unknown'}</td>
                <td>${lead.phone || 'Unknown'}</td>
                <td><div style="font-weight:600">${lead.budget || 'Unknown'}</div><div style="font-size:0.8rem;color:var(--text-muted)">${lead.visit_time || 'Unknown'}</div></td>
                <td style="max-width: 250px; font-size: 0.85rem;">${lead.psychology_notes || 'N/A'}</td>
                <td>
                    <select class="status-select" data-id="${lead.id}">
                        <option value="New" ${lead.status === 'New' ? 'selected' : ''}>New</option>
                        <option value="Contacted" ${lead.status === 'Contacted' ? 'selected' : ''}>Contacted</option>
                        <option value="Visit Scheduled" ${lead.status === 'Visit Scheduled' ? 'selected' : ''}>Visit Scheduled</option>
                        <option value="Closed" ${lead.status === 'Closed' ? 'selected' : ''}>Closed</option>
                        <option value="Dead" ${lead.status === 'Dead' ? 'selected' : ''}>Dead</option>
                    </select>
                </td>
            `;
            tbody.appendChild(tr);
        });

        document.querySelectorAll('.status-select').forEach(select => {
            select.addEventListener('change', async (e) => {
                const id = e.target.getAttribute('data-id');
                const status = e.target.value;
                try {
                    await fetch(`/api/admin/leads/${id}/status`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status })
                    });
                    loadLeads();
                } catch (err) {
                    console.error('Failed to update status', err);
                }
            });
        });
    }

    function renderProperties(properties) {
        propertiesTbody.innerHTML = '';
        if (properties.length === 0) {
            propertiesTbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding: 2rem;">No properties found.</td></tr>`;
            return;
        }

        properties.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="badge ${p.type.toLowerCase()}">${p.type}</span></td>
                <td style="font-weight: 600;">${p.title}</td>
                <td>${p.area}</td>
                <td style="font-weight: 600;">${p.price}</td>
                <td>${p.bedrooms}</td>
                <td style="font-size: 0.85rem;">${p.description}</td>
                <td>
                    <button class="btn btn-sm btn-outline delete-prop" data-id="${p.id}">Delete</button>
                </td>
            `;
            propertiesTbody.appendChild(tr);
        });

        document.querySelectorAll('.delete-prop').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if (!confirm('Are you sure you want to delete this listing?')) return;
                const id = e.target.getAttribute('data-id');
                try {
                    await fetch(`/api/admin/properties/${id}`, { method: 'DELETE' });
                    loadProperties();
                } catch (err) {
                    console.error('Failed to delete property', err);
                }
            });
        });
    }

    // Modal logic
    addPropBtn.addEventListener('click', () => propModal.classList.remove('hidden'));
    closeModal.addEventListener('click', () => propModal.classList.add('hidden'));

    propForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const propData = {
            type: document.getElementById('prop-type').value,
            title: document.getElementById('prop-title').value,
            area: document.getElementById('prop-area').value,
            price: document.getElementById('prop-price').value,
            bedrooms: document.getElementById('prop-beds').value,
            description: document.getElementById('prop-desc').value,
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
            console.error('Failed to save property', err);
        }
    });
});
