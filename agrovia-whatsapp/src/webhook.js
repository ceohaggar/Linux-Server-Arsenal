const express = require('express');
const config = require('./config');
const { upsertContact, saveMessage, updateMessageStatus, getState } = require('./db');
const whatsapp = require('./whatsapp');
const bot = require('./bot');

const router = express.Router();

// Verification du webhook par Meta (GET avec hub.challenge)
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === config.webhookVerifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Reception des messages et statuts
router.post('/webhook', (req, res) => {
  // Toujours repondre 200 tout de suite : Meta re-essaie sinon.
  res.sendStatus(200);
  const body = req.body;
  if (body.object !== 'whatsapp_business_account') return;

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      processIncoming(value).catch((err) => console.error('Erreur webhook:', err));
    }
  }
});

async function processIncoming(value) {
  // Statuts de livraison des messages sortants
  for (const status of value.statuses || []) {
    updateMessageStatus(status.id, status.status);
  }

  const profileNames = {};
  for (const c of value.contacts || []) {
    profileNames[c.wa_id] = c.profile?.name;
  }

  for (const message of value.messages || []) {
    const contact = upsertContact(message.from, profileNames[message.from]);
    let text = '';
    if (message.type === 'text') {
      text = message.text?.body || '';
    } else if (message.type === 'interactive') {
      text = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '';
    } else {
      text = `[${message.type}]`;
    }

    saveMessage({
      waMessageId: message.id,
      contactId: contact.id,
      direction: 'in',
      type: message.type,
      body: text,
    });
    await whatsapp.markAsRead(message.id);

    if (message.type === 'text' || message.type === 'interactive') {
      await bot.handleIncomingText(contact, text);
    } else {
      const { state } = getState(contact.id);
      if (state !== 'HUMAN') {
        await bot.sendAndLog(contact, 'Nous ne pouvons traiter que des messages texte pour le moment. Tapez "menu" pour voir nos services.');
      }
    }
  }
}

module.exports = { router, processIncoming };
