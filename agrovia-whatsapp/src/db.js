const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'agrovia.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_id TEXT UNIQUE NOT NULL,
  name TEXT,
  opt_in INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_message_id TEXT UNIQUE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  type TEXT DEFAULT 'text',
  body TEXT,
  status TEXT DEFAULT 'received',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id, id);

CREATE TABLE IF NOT EXISTS conversation_state (
  contact_id INTEGER PRIMARY KEY REFERENCES contacts(id),
  state TEXT DEFAULT 'MENU',
  data TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  unit TEXT DEFAULT 'kg',
  available INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  product_id INTEGER REFERENCES products(id),
  product_name TEXT,
  quantity REAL,
  unit TEXT,
  total_price INTEGER,
  status TEXT DEFAULT 'nouvelle',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT DEFAULT 'text',
  template_name TEXT,
  language TEXT DEFAULT 'fr',
  body TEXT,
  status TEXT DEFAULT 'en_cours',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  status TEXT DEFAULT 'pending',
  error TEXT,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients ON campaign_recipients(campaign_id, status);
`);

// Produits d'exemple au premier lancement (a modifier depuis le tableau de bord)
const productCount = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
if (productCount === 0) {
  const insert = db.prepare('INSERT INTO products (name, price, unit) VALUES (?, ?, ?)');
  insert.run('Gombo frais', 1000, 'kg');
  insert.run('Gombo seche', 2500, 'kg');
  insert.run('Tomates', 800, 'kg');
  insert.run('Oignons', 600, 'kg');
  insert.run('Piment', 1500, 'kg');
}

// --- Contacts ---
function upsertContact(waId, name) {
  const existing = db.prepare('SELECT * FROM contacts WHERE wa_id = ?').get(waId);
  if (existing) {
    db.prepare("UPDATE contacts SET last_seen_at = datetime('now'), name = COALESCE(?, name) WHERE id = ?")
      .run(name || null, existing.id);
    return db.prepare('SELECT * FROM contacts WHERE id = ?').get(existing.id);
  }
  const info = db.prepare("INSERT INTO contacts (wa_id, name, last_seen_at) VALUES (?, ?, datetime('now'))")
    .run(waId, name || null);
  return db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid);
}

// --- Messages ---
function saveMessage({ waMessageId, contactId, direction, type = 'text', body, status }) {
  const info = db.prepare(
    'INSERT OR IGNORE INTO messages (wa_message_id, contact_id, direction, type, body, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(waMessageId || null, contactId, direction, type, body || '', status || (direction === 'in' ? 'received' : 'sent'));
  return info.lastInsertRowid;
}

function updateMessageStatus(waMessageId, status) {
  db.prepare('UPDATE messages SET status = ? WHERE wa_message_id = ?').run(status, waMessageId);
}

// --- Etat de conversation (chatbot) ---
function getState(contactId) {
  const row = db.prepare('SELECT * FROM conversation_state WHERE contact_id = ?').get(contactId);
  if (!row) return { state: 'MENU', data: {} };
  return { state: row.state, data: JSON.parse(row.data || '{}') };
}

function setState(contactId, state, data = {}) {
  db.prepare(
    `INSERT INTO conversation_state (contact_id, state, data) VALUES (?, ?, ?)
     ON CONFLICT(contact_id) DO UPDATE SET state = excluded.state, data = excluded.data`
  ).run(contactId, state, JSON.stringify(data));
}

module.exports = { db, upsertContact, saveMessage, updateMessageStatus, getState, setState };
