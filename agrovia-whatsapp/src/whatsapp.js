const crypto = require('crypto');
const config = require('./config');

// Client minimal pour l'API Graph de Meta (WhatsApp Cloud API).
// En mode simulation (pas de token), aucun appel reseau n'est fait :
// on renvoie un faux identifiant de message pour que toute la chaine fonctionne.

async function callGraphApi(payload) {
  if (config.simulate) {
    return { messages: [{ id: 'sim-' + crypto.randomUUID() }], simulated: true };
  }
  const url = `https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) {
    const message = json.error?.message || `Erreur API Meta (HTTP ${res.status})`;
    throw new Error(message);
  }
  return json;
}

async function sendText(to, body) {
  return callGraphApi({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body },
  });
}

async function sendTemplate(to, templateName, language = 'fr', components = []) {
  return callGraphApi({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      ...(components.length ? { components } : {}),
    },
  });
}

async function markAsRead(waMessageId) {
  if (config.simulate) return { success: true, simulated: true };
  try {
    const url = `https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`;
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: waMessageId }),
    });
  } catch {
    // non bloquant
  }
  return { success: true };
}

module.exports = { sendText, sendTemplate, markAsRead };
