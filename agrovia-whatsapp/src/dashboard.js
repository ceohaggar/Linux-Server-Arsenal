const express = require('express');
const config = require('./config');
const { db, upsertContact, saveMessage, getState, setState } = require('./db');
const whatsapp = require('./whatsapp');
const campaigns = require('./campaigns');
const { processIncoming } = require('./webhook');

const router = express.Router();

// --- Authentification ---
router.post('/api/login', (req, res) => {
  if ((req.body.password || '') === config.adminPassword) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Mot de passe incorrect' });
});

router.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/api/me', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated, simulate: config.simulate });
});

function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  res.status(401).json({ error: 'Non authentifie' });
}

router.use('/api', (req, res, next) => {
  if (['/login', '/logout', '/me'].includes(req.path)) return next();
  requireAuth(req, res, next);
});

// --- Statistiques ---
router.get('/api/stats', (req, res) => {
  res.json({
    contacts: db.prepare('SELECT COUNT(*) AS c FROM contacts').get().c,
    messagesIn: db.prepare("SELECT COUNT(*) AS c FROM messages WHERE direction = 'in'").get().c,
    messagesOut: db.prepare("SELECT COUNT(*) AS c FROM messages WHERE direction = 'out'").get().c,
    orders: db.prepare('SELECT COUNT(*) AS c FROM orders').get().c,
    newOrders: db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'nouvelle'").get().c,
    waitingHuman: db.prepare("SELECT COUNT(*) AS c FROM conversation_state WHERE state = 'HUMAN'").get().c,
  });
});

// --- Conversations ---
router.get('/api/conversations', (req, res) => {
  const rows = db.prepare(
    `SELECT c.id, c.wa_id, c.name, c.last_seen_at,
            (SELECT body FROM messages m WHERE m.contact_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
            (SELECT created_at FROM messages m WHERE m.contact_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message_at,
            (SELECT state FROM conversation_state s WHERE s.contact_id = c.id) AS state
     FROM contacts c
     ORDER BY last_message_at DESC NULLS LAST`
  ).all();
  res.json(rows);
});

router.get('/api/conversations/:contactId/messages', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM messages WHERE contact_id = ? ORDER BY id ASC LIMIT 500'
  ).all(req.params.contactId);
  res.json(rows);
});

router.post('/api/conversations/:contactId/send', async (req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.contactId);
  if (!contact) return res.status(404).json({ error: 'Contact introuvable' });
  const body = (req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message vide' });
  try {
    const result = await whatsapp.sendText(contact.wa_id, body);
    const waId = result.messages?.[0]?.id;
    saveMessage({ waMessageId: waId, contactId: contact.id, direction: 'out', body, status: 'sent' });
    // Quand un agent repond a la main, on passe la conversation en mode humain.
    setState(contact.id, 'HUMAN');
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/api/conversations/:contactId/release', (req, res) => {
  // Rendre la conversation au chatbot
  setState(req.params.contactId, 'MENU');
  res.json({ ok: true });
});

// --- Contacts ---
router.get('/api/contacts', (req, res) => {
  res.json(db.prepare('SELECT * FROM contacts ORDER BY id DESC').all());
});

router.post('/api/contacts', (req, res) => {
  const waId = (req.body.wa_id || '').replace(/[^0-9]/g, '');
  if (!waId) return res.status(400).json({ error: 'Numero invalide (format international sans +, ex: 23566000000)' });
  const contact = upsertContact(waId, (req.body.name || '').trim() || null);
  res.json(contact);
});

// --- Produits ---
router.get('/api/products', (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY id').all());
});

router.post('/api/products', (req, res) => {
  const { name, price, unit } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Nom et prix requis' });
  const info = db.prepare('INSERT INTO products (name, price, unit) VALUES (?, ?, ?)')
    .run(name.trim(), Math.round(price), (unit || 'kg').trim());
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/api/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produit introuvable' });
  const { name, price, unit, available } = req.body;
  db.prepare('UPDATE products SET name = ?, price = ?, unit = ?, available = ? WHERE id = ?').run(
    name ?? product.name,
    price != null ? Math.round(price) : product.price,
    unit ?? product.unit,
    available != null ? (available ? 1 : 0) : product.available,
    product.id
  );
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(product.id));
});

// --- Commandes ---
router.get('/api/orders', (req, res) => {
  const rows = db.prepare(
    `SELECT o.*, c.wa_id, c.name AS contact_name
     FROM orders o JOIN contacts c ON c.id = o.contact_id
     ORDER BY o.id DESC`
  ).all();
  res.json(rows);
});

router.put('/api/orders/:id', (req, res) => {
  const allowed = ['nouvelle', 'confirmee', 'livree', 'annulee'];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error: 'Statut invalide' });
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(req.body.status, req.params.id);
  res.json({ ok: true });
});

// --- Campagnes ---
router.get('/api/campaigns', (req, res) => {
  const rows = db.prepare('SELECT * FROM campaigns ORDER BY id DESC').all();
  res.json(rows.map((c) => ({ ...c, stats: campaigns.campaignStats(c.id) })));
});

router.post('/api/campaigns', (req, res) => {
  const { name, kind, template_name, language, body, contact_ids } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom de campagne requis' });
  if (kind === 'template' && !template_name) return res.status(400).json({ error: 'Nom du template requis' });
  if (kind !== 'template' && !body) return res.status(400).json({ error: 'Texte du message requis' });

  let ids = contact_ids;
  if (!Array.isArray(ids) || !ids.length) {
    ids = db.prepare('SELECT id FROM contacts WHERE opt_in = 1').all().map((r) => r.id);
  }
  if (!ids.length) return res.status(400).json({ error: 'Aucun contact destinataire' });

  const campaignId = campaigns.createCampaign({
    name, kind: kind === 'template' ? 'template' : 'text',
    templateName: template_name, language, body, contactIds: ids,
  });
  res.json({ ok: true, campaign_id: campaignId });
});

// --- Simulateur (demo sans credentials Meta) ---
router.post('/api/dev/simulate-incoming', async (req, res) => {
  if (!config.simulate) return res.status(403).json({ error: 'Disponible uniquement en mode simulation' });
  const from = (req.body.from || '23566000000').replace(/[^0-9]/g, '');
  const text = req.body.body || 'Bonjour';
  await processIncoming({
    contacts: [{ wa_id: from, profile: { name: req.body.name || 'Client Test' } }],
    messages: [{ from, id: 'sim-in-' + Date.now() + '-' + Math.random().toString(36).slice(2), type: 'text', text: { body: text } }],
  });
  res.json({ ok: true });
});

module.exports = router;
