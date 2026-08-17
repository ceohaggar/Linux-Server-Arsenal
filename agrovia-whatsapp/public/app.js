// Tableau de bord Agrovia - client leger sans framework
const main = document.getElementById('main-content');
let currentView = 'overview';
let currentContactId = null;
let pollTimer = null;
let simulateMode = false;

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) { window.location.href = '/login.html'; throw new Error('Non authentifie'); }
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Erreur serveur');
  return json;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(s) {
  if (!s) return '';
  return new Date(s.replace(' ', 'T') + 'Z').toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function fcfa(n) { return new Intl.NumberFormat('fr-FR').format(n) + ' Fcfa'; }

function setPolling(fn, intervalMs = 5000) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = fn ? setInterval(fn, intervalMs) : null;
}

// --- Vue : tableau de bord ---
async function renderOverview() {
  const s = await api('/api/stats');
  main.innerHTML = `
    <h2>Tableau de bord</h2>
    <p class="subtitle">Vue d'ensemble de l'activite WhatsApp d'Agrovia</p>
    <div class="cards">
      <div class="stat-card"><div class="num">${s.contacts}</div><div class="label">Contacts</div></div>
      <div class="stat-card"><div class="num">${s.messagesIn}</div><div class="label">Messages recus</div></div>
      <div class="stat-card"><div class="num">${s.messagesOut}</div><div class="label">Messages envoyes</div></div>
      <div class="stat-card"><div class="num">${s.orders}</div><div class="label">Commandes totales</div></div>
      <div class="stat-card ${s.newOrders > 0 ? 'alert' : ''}"><div class="num">${s.newOrders}</div><div class="label">Nouvelles commandes</div></div>
      <div class="stat-card ${s.waitingHuman > 0 ? 'alert' : ''}"><div class="num">${s.waitingHuman}</div><div class="label">Attendent un conseiller</div></div>
    </div>
    ${simulateMode ? `
    <div class="panel">
      <h3 style="margin-bottom:10px">Simulateur de client (mode demo)</h3>
      <p class="subtitle" style="margin:0 0 12px">Envoie un message comme si un client ecrivait sur WhatsApp, pour tester le chatbot sans credentials Meta.</p>
      <div class="form-row">
        <input id="sim-from" placeholder="Numero (ex: 23566000001)" value="23566000001">
        <input id="sim-name" placeholder="Nom du client" value="Client Test">
        <input id="sim-body" placeholder="Message (ex: Bonjour, ou 1, 2...)" value="Bonjour">
        <button class="primary" id="sim-send">Simuler</button>
      </div>
    </div>` : ''}
  `;
  if (simulateMode) {
    document.getElementById('sim-send').addEventListener('click', async () => {
      const body = document.getElementById('sim-body');
      await api('/api/dev/simulate-incoming', { method: 'POST', body: {
        from: document.getElementById('sim-from').value,
        name: document.getElementById('sim-name').value,
        body: body.value,
      }});
      body.value = '';
      renderOverview();
    });
  }
}

// --- Vue : conversations ---
async function renderConversations() {
  const convs = await api('/api/conversations');
  main.innerHTML = `
    <h2>Conversations</h2>
    <div class="conv-layout">
      <div class="conv-list" id="conv-list">
        ${convs.length ? convs.map((c) => `
          <div class="conv-item ${c.id === currentContactId ? 'active' : ''}" data-id="${c.id}">
            <div class="name">${esc(c.name || c.wa_id)}
              ${c.state === 'HUMAN' ? '<span class="pill HUMAN">conseiller</span>' : '<span class="pill bot">bot</span>'}
            </div>
            <div class="preview">${esc(c.last_message || '')}</div>
          </div>`).join('') : '<div class="empty-state">Aucune conversation pour le moment</div>'}
      </div>
      <div class="chat" id="chat-panel">
        <div class="empty-state">Selectionnez une conversation</div>
      </div>
    </div>
  `;
  document.querySelectorAll('.conv-item').forEach((el) => {
    el.addEventListener('click', () => {
      currentContactId = parseInt(el.dataset.id, 10);
      renderConversations();
    });
  });
  if (currentContactId) {
    const contact = convs.find((c) => c.id === currentContactId);
    if (contact) await renderChat(contact);
  }
}

async function renderChat(contact) {
  const messages = await api(`/api/conversations/${contact.id}/messages`);
  const panel = document.getElementById('chat-panel');
  panel.innerHTML = `
    <div class="chat-header">
      <div><strong>${esc(contact.name || contact.wa_id)}</strong> <span style="color:var(--muted);font-size:13px">${esc(contact.wa_id)}</span></div>
      ${contact.state === 'HUMAN' ? '<button class="small" id="release-btn">Rendre au chatbot</button>' : ''}
    </div>
    <div class="chat-messages" id="chat-messages">
      ${messages.map((m) => `
        <div class="bubble ${m.direction}">
          ${esc(m.body)}
          <span class="meta">${fmtDate(m.created_at)}${m.direction === 'out' ? ' - ' + esc(m.status) : ''}</span>
        </div>`).join('')}
    </div>
    <div class="chat-input">
      <input id="chat-text" placeholder="Repondre en tant qu'Agrovia..." autocomplete="off">
      <button class="primary" id="chat-send">Envoyer</button>
    </div>
  `;
  const box = document.getElementById('chat-messages');
  box.scrollTop = box.scrollHeight;

  const send = async () => {
    const input = document.getElementById('chat-text');
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    try {
      await api(`/api/conversations/${contact.id}/send`, { method: 'POST', body: { body } });
      renderConversations();
    } catch (err) { alert(err.message); }
  };
  document.getElementById('chat-send').addEventListener('click', send);
  document.getElementById('chat-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  const releaseBtn = document.getElementById('release-btn');
  if (releaseBtn) releaseBtn.addEventListener('click', async () => {
    await api(`/api/conversations/${contact.id}/release`, { method: 'POST' });
    renderConversations();
  });
}

// --- Vue : commandes ---
async function renderOrders() {
  const orders = await api('/api/orders');
  main.innerHTML = `
    <h2>Commandes</h2>
    <p class="subtitle">Commandes passees par les clients via le chatbot</p>
    <div class="panel">
      <table>
        <thead><tr><th>N</th><th>Client</th><th>Produit</th><th>Quantite</th><th>Total</th><th>Date</th><th>Statut</th><th></th></tr></thead>
        <tbody>
          ${orders.length ? orders.map((o) => `
            <tr>
              <td>${o.id}</td>
              <td>${esc(o.contact_name || o.wa_id)}</td>
              <td>${esc(o.product_name)}</td>
              <td>${o.quantity} ${esc(o.unit)}</td>
              <td>${fcfa(o.total_price)}</td>
              <td>${fmtDate(o.created_at)}</td>
              <td><span class="pill ${o.status}">${o.status}</span></td>
              <td>
                <select data-order="${o.id}" class="order-status">
                  ${['nouvelle', 'confirmee', 'livree', 'annulee'].map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
              </td>
            </tr>`).join('') : '<tr><td colspan="8" class="empty-state">Aucune commande pour le moment</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  document.querySelectorAll('.order-status').forEach((sel) => {
    sel.addEventListener('change', async () => {
      await api(`/api/orders/${sel.dataset.order}`, { method: 'PUT', body: { status: sel.value } });
      renderOrders();
    });
  });
}

// --- Vue : campagnes ---
async function renderCampaigns() {
  const list = await api('/api/campaigns');
  main.innerHTML = `
    <h2>Campagnes de diffusion</h2>
    <p class="subtitle">Envoi de messages en masse a tous les contacts. Hors fenetre de 24h, Meta n'autorise que les templates pre-approuves.</p>
    <div class="panel">
      <h3 style="margin-bottom:12px">Nouvelle campagne</h3>
      <div class="form-row">
        <input id="camp-name" placeholder="Nom de la campagne (ex: Recolte gombo semaine 34)">
        <select id="camp-kind">
          <option value="text">Message texte (fenetre 24h / tests)</option>
          <option value="template">Template Meta pre-approuve</option>
        </select>
      </div>
      <div class="form-row hidden" id="camp-template-row">
        <input id="camp-template" placeholder="Nom du template (ex: promo_gombo)">
        <input id="camp-lang" placeholder="Langue" value="fr" style="max-width:90px">
      </div>
      <textarea id="camp-body" placeholder="Texte du message (pour le type texte)"></textarea>
      <div style="margin-top:12px">
        <button class="primary" id="camp-send">Lancer la campagne (tous les contacts)</button>
      </div>
    </div>
    <div class="panel">
      <table>
        <thead><tr><th>Nom</th><th>Type</th><th>Envoyes</th><th>Echecs</th><th>En attente</th><th>Statut</th><th>Date</th></tr></thead>
        <tbody>
          ${list.length ? list.map((c) => `
            <tr>
              <td>${esc(c.name)}</td>
              <td>${c.kind}</td>
              <td>${c.stats.sent || 0}/${c.stats.total}</td>
              <td>${c.stats.failed || 0}</td>
              <td>${c.stats.pending || 0}</td>
              <td><span class="pill ${c.status}">${c.status}</span></td>
              <td>${fmtDate(c.created_at)}</td>
            </tr>`).join('') : '<tr><td colspan="7" class="empty-state">Aucune campagne</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  const kindSel = document.getElementById('camp-kind');
  kindSel.addEventListener('change', () => {
    document.getElementById('camp-template-row').classList.toggle('hidden', kindSel.value !== 'template');
  });
  document.getElementById('camp-send').addEventListener('click', async () => {
    try {
      await api('/api/campaigns', { method: 'POST', body: {
        name: document.getElementById('camp-name').value,
        kind: kindSel.value,
        template_name: document.getElementById('camp-template').value,
        language: document.getElementById('camp-lang').value || 'fr',
        body: document.getElementById('camp-body').value,
      }});
      renderCampaigns();
    } catch (err) { alert(err.message); }
  });
}

// --- Vue : contacts ---
async function renderContacts() {
  const contacts = await api('/api/contacts');
  main.innerHTML = `
    <h2>Contacts</h2>
    <div class="panel">
      <div class="form-row">
        <input id="contact-phone" placeholder="Numero international sans + (ex: 23566000000)">
        <input id="contact-name" placeholder="Nom (optionnel)">
        <button class="primary" id="contact-add">Ajouter</button>
      </div>
    </div>
    <div class="panel">
      <table>
        <thead><tr><th>Numero</th><th>Nom</th><th>Ajoute le</th><th>Dernier contact</th></tr></thead>
        <tbody>
          ${contacts.length ? contacts.map((c) => `
            <tr>
              <td>${esc(c.wa_id)}</td>
              <td>${esc(c.name || '-')}</td>
              <td>${fmtDate(c.created_at)}</td>
              <td>${fmtDate(c.last_seen_at) || '-'}</td>
            </tr>`).join('') : '<tr><td colspan="4" class="empty-state">Aucun contact</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  document.getElementById('contact-add').addEventListener('click', async () => {
    try {
      await api('/api/contacts', { method: 'POST', body: {
        wa_id: document.getElementById('contact-phone').value,
        name: document.getElementById('contact-name').value,
      }});
      renderContacts();
    } catch (err) { alert(err.message); }
  });
}

// --- Vue : produits ---
async function renderProducts() {
  const products = await api('/api/products');
  main.innerHTML = `
    <h2>Produits</h2>
    <p class="subtitle">Catalogue affiche par le chatbot aux clients</p>
    <div class="panel">
      <div class="form-row">
        <input id="prod-name" placeholder="Nom du produit">
        <input id="prod-price" type="number" placeholder="Prix (Fcfa)">
        <input id="prod-unit" placeholder="Unite" value="kg" style="max-width:90px">
        <button class="primary" id="prod-add">Ajouter</button>
      </div>
    </div>
    <div class="panel">
      <table>
        <thead><tr><th>Produit</th><th>Prix</th><th>Unite</th><th>Disponible</th><th></th></tr></thead>
        <tbody>
          ${products.map((p) => `
            <tr>
              <td>${esc(p.name)}</td>
              <td>${fcfa(p.price)}</td>
              <td>${esc(p.unit)}</td>
              <td>${p.available ? 'Oui' : 'Non'}</td>
              <td><button class="small toggle-prod" data-id="${p.id}" data-avail="${p.available}">${p.available ? 'Rendre indisponible' : 'Rendre disponible'}</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  document.getElementById('prod-add').addEventListener('click', async () => {
    try {
      await api('/api/products', { method: 'POST', body: {
        name: document.getElementById('prod-name').value,
        price: parseInt(document.getElementById('prod-price').value, 10),
        unit: document.getElementById('prod-unit').value,
      }});
      renderProducts();
    } catch (err) { alert(err.message); }
  });
  document.querySelectorAll('.toggle-prod').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/products/${btn.dataset.id}`, { method: 'PUT', body: { available: btn.dataset.avail !== '1' } });
      renderProducts();
    });
  });
}

// --- Navigation ---
const views = {
  overview: { render: renderOverview, poll: renderOverview },
  conversations: { render: renderConversations, poll: renderConversations },
  orders: { render: renderOrders, poll: renderOrders },
  campaigns: { render: renderCampaigns, poll: renderCampaigns },
  contacts: { render: renderContacts, poll: null },
  products: { render: renderProducts, poll: null },
};

async function showView(name) {
  currentView = name;
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  const view = views[name];
  await view.render();
  setPolling(view.poll ? () => { if (currentView === name) view.poll(); } : null);
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// --- Demarrage ---
(async () => {
  const me = await api('/api/me');
  if (!me.authenticated) { window.location.href = '/login.html'; return; }
  simulateMode = me.simulate;
  if (simulateMode) document.getElementById('sim-badge').classList.remove('hidden');
  showView('overview');
})();
