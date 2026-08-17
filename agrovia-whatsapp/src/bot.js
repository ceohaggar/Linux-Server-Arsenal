const { db, getState, setState, saveMessage } = require('./db');
const whatsapp = require('./whatsapp');
const config = require('./config');

// Chatbot Agrovia : menu principal, catalogue, prise de commande, transfert humain.
// Etats : MENU, ORDER_PRODUCT, ORDER_QTY, ORDER_CONFIRM, HUMAN

function formatFcfa(n) {
  return new Intl.NumberFormat('fr-FR').format(n) + ' Fcfa';
}

function availableProducts() {
  return db.prepare('SELECT * FROM products WHERE available = 1 ORDER BY id').all();
}

function menuText() {
  return (
    'Bienvenue chez Agrovia, votre producteur local de legumes frais.\n\n' +
    'Repondez avec un chiffre :\n' +
    '1. Voir nos produits et prix\n' +
    '2. Passer une commande\n' +
    '3. Informations livraison\n' +
    '4. Parler a un conseiller\n\n' +
    'Tapez "menu" a tout moment pour revenir ici.'
  );
}

function productListText() {
  const products = availableProducts();
  if (!products.length) return 'Aucun produit disponible pour le moment. Revenez bientot !';
  const lines = products.map((p, i) => `${i + 1}. ${p.name} - ${formatFcfa(p.price)}/${p.unit}`);
  return 'Nos produits disponibles :\n\n' + lines.join('\n');
}

async function sendAndLog(contact, body) {
  try {
    const res = await whatsapp.sendText(contact.wa_id, body);
    const waId = res.messages?.[0]?.id;
    saveMessage({ waMessageId: waId, contactId: contact.id, direction: 'out', body, status: 'sent' });
  } catch (err) {
    saveMessage({ contactId: contact.id, direction: 'out', body, status: 'failed' });
    console.error('Echec envoi WhatsApp:', err.message);
  }
}

async function notifyAdmins(text) {
  for (const number of config.adminNumbers) {
    try {
      await whatsapp.sendText(number, text);
    } catch (err) {
      console.error(`Echec notification admin ${number}:`, err.message);
    }
  }
}

async function handleIncomingText(contact, text) {
  const input = (text || '').trim();
  const lower = input.toLowerCase();
  const { state, data } = getState(contact.id);

  // Retour au menu depuis n'importe quel etat
  if (['menu', '0', 'accueil', 'start'].includes(lower)) {
    setState(contact.id, 'MENU');
    return sendAndLog(contact, menuText());
  }

  switch (state) {
    case 'ORDER_PRODUCT': {
      const products = availableProducts();
      const idx = parseInt(input, 10) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= products.length) {
        return sendAndLog(contact, 'Choix invalide. ' + productListText() + '\n\nRepondez avec le numero du produit souhaite.');
      }
      const product = products[idx];
      setState(contact.id, 'ORDER_QTY', { productId: product.id });
      return sendAndLog(contact, `Vous avez choisi : ${product.name} (${formatFcfa(product.price)}/${product.unit}).\n\nQuelle quantite souhaitez-vous ? (en ${product.unit}, exemple : 5)`);
    }

    case 'ORDER_QTY': {
      const qty = parseFloat(input.replace(',', '.'));
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(data.productId);
      if (!product) {
        setState(contact.id, 'MENU');
        return sendAndLog(contact, 'Ce produit n\'est plus disponible. ' + menuText());
      }
      if (Number.isNaN(qty) || qty <= 0 || qty > 100000) {
        return sendAndLog(contact, `Quantite invalide. Indiquez un nombre en ${product.unit} (exemple : 5).`);
      }
      const total = Math.round(qty * product.price);
      setState(contact.id, 'ORDER_CONFIRM', { productId: product.id, qty, total });
      return sendAndLog(
        contact,
        `Recapitulatif de votre commande :\n\n${product.name} x ${qty} ${product.unit}\nTotal : ${formatFcfa(total)}\n\nRepondez OUI pour confirmer, ou NON pour annuler.`
      );
    }

    case 'ORDER_CONFIRM': {
      if (['oui', 'yes', 'ok', 'confirmer'].includes(lower)) {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(data.productId);
        const info = db.prepare(
          'INSERT INTO orders (contact_id, product_id, product_name, quantity, unit, total_price) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(contact.id, product.id, product.name, data.qty, product.unit, data.total);
        setState(contact.id, 'MENU');
        await sendAndLog(
          contact,
          `Merci ! Votre commande n${info.lastInsertRowid} est enregistree :\n${product.name} x ${data.qty} ${product.unit} = ${formatFcfa(data.total)}\n\nNotre equipe vous contacte tres vite pour la livraison et le paiement (Airtel Money / Moov Money acceptes).`
        );
        await notifyAdmins(
          `NOUVELLE COMMANDE n${info.lastInsertRowid}\nClient : ${contact.name || contact.wa_id} (${contact.wa_id})\n${product.name} x ${data.qty} ${product.unit} = ${formatFcfa(data.total)}`
        );
        return;
      }
      if (['non', 'no', 'annuler'].includes(lower)) {
        setState(contact.id, 'MENU');
        return sendAndLog(contact, 'Commande annulee. ' + menuText());
      }
      return sendAndLog(contact, 'Repondez OUI pour confirmer la commande, ou NON pour annuler.');
    }

    case 'HUMAN':
      // Un conseiller a pris le relais : le bot ne repond plus, le message reste visible dans le tableau de bord.
      return;

    case 'MENU':
    default: {
      if (input === '1') {
        return sendAndLog(contact, productListText() + '\n\nTapez 2 pour commander, ou "menu" pour revenir.');
      }
      if (input === '2') {
        const products = availableProducts();
        if (!products.length) {
          return sendAndLog(contact, 'Aucun produit disponible pour le moment. Revenez bientot !');
        }
        setState(contact.id, 'ORDER_PRODUCT');
        return sendAndLog(contact, productListText() + '\n\nRepondez avec le numero du produit que vous souhaitez commander.');
      }
      if (input === '3') {
        return sendAndLog(
          contact,
          'Livraison :\n- N\'Djamena : livraison sous 24h, 1 000 Fcfa (gratuite au-dela de 20 000 Fcfa de commande)\n- Autres villes : nous consulter\n\nPaiement a la livraison ou par Airtel Money / Moov Money.\n\nTapez "menu" pour revenir.'
        );
      }
      if (input === '4') {
        setState(contact.id, 'HUMAN');
        await sendAndLog(contact, 'Un conseiller Agrovia va vous repondre ici tres rapidement. Merci de patienter.');
        await notifyAdmins(`DEMANDE CONSEILLER\nClient : ${contact.name || contact.wa_id} (${contact.wa_id}) attend une reponse humaine.`);
        return;
      }
      // Premier contact ou entree non reconnue : afficher le menu
      return sendAndLog(contact, menuText());
    }
  }
}

module.exports = { handleIncomingText, sendAndLog };
