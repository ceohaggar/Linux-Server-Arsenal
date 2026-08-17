const { db, saveMessage } = require('./db');
const whatsapp = require('./whatsapp');
const config = require('./config');

// File d'envoi des campagnes : un message a la fois, avec un delai entre chaque
// envoi pour respecter les limites de debit de Meta.

let running = false;

function createCampaign({ name, kind, templateName, language, body, contactIds }) {
  const info = db.prepare(
    'INSERT INTO campaigns (name, kind, template_name, language, body) VALUES (?, ?, ?, ?, ?)'
  ).run(name, kind, templateName || null, language || 'fr', body || null);
  const campaignId = info.lastInsertRowid;

  const insertRecipient = db.prepare(
    'INSERT INTO campaign_recipients (campaign_id, contact_id) VALUES (?, ?)'
  );
  const insertAll = db.transaction((ids) => {
    for (const id of ids) insertRecipient.run(campaignId, id);
  });
  insertAll(contactIds);

  startWorker();
  return campaignId;
}

function startWorker() {
  if (running) return;
  running = true;
  processNext();
}

async function processNext() {
  const recipient = db.prepare(
    `SELECT cr.*, c.wa_id, camp.kind, camp.template_name, camp.language, camp.body, camp.id AS camp_id
     FROM campaign_recipients cr
     JOIN contacts c ON c.id = cr.contact_id
     JOIN campaigns camp ON camp.id = cr.campaign_id
     WHERE cr.status = 'pending'
     ORDER BY cr.id
     LIMIT 1`
  ).get();

  if (!recipient) {
    // Marquer comme terminees les campagnes sans destinataires en attente
    db.prepare(
      `UPDATE campaigns SET status = 'terminee'
       WHERE status = 'en_cours'
       AND id NOT IN (SELECT DISTINCT campaign_id FROM campaign_recipients WHERE status = 'pending')`
    ).run();
    running = false;
    return;
  }

  try {
    let res;
    if (recipient.kind === 'template') {
      res = await whatsapp.sendTemplate(recipient.wa_id, recipient.template_name, recipient.language);
    } else {
      res = await whatsapp.sendText(recipient.wa_id, recipient.body);
    }
    const waId = res.messages?.[0]?.id;
    saveMessage({
      waMessageId: waId,
      contactId: recipient.contact_id,
      direction: 'out',
      body: recipient.kind === 'template' ? `[template] ${recipient.template_name}` : recipient.body,
      status: 'sent',
    });
    db.prepare("UPDATE campaign_recipients SET status = 'sent', sent_at = datetime('now') WHERE id = ?")
      .run(recipient.id);
  } catch (err) {
    db.prepare("UPDATE campaign_recipients SET status = 'failed', error = ? WHERE id = ?")
      .run(err.message, recipient.id);
  }

  setTimeout(processNext, config.campaignSendIntervalMs);
}

function campaignStats(campaignId) {
  return db.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
     FROM campaign_recipients WHERE campaign_id = ?`
  ).get(campaignId);
}

module.exports = { createCampaign, startWorker, campaignStats };
