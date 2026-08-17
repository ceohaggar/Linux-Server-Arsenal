# Agrovia WhatsApp — Plateforme WhatsApp Business

Plateforme complete construite sur le **WhatsApp Cloud API de Meta** (acces direct, sans intermediaire BSP) pour l'entreprise Agrovia. Concue pour etre d'abord utilisee en interne, puis dupliquee/adaptee pour d'autres entreprises tchadiennes.

## Fonctionnalites

- **Chatbot de commande automatique** : menu d'accueil, catalogue produits avec prix en Fcfa, prise de commande complete (produit, quantite, recapitulatif, confirmation), informations livraison, transfert vers un conseiller humain.
- **Boite de reception multi-agents** : toutes les conversations dans un tableau de bord web, reponse manuelle possible, bascule bot/humain par conversation.
- **Notifications admin** : les nouvelles commandes et demandes de conseiller sont envoyees sur WhatsApp aux numeros administrateurs.
- **Campagnes de diffusion** : envoi en masse (texte ou template Meta pre-approuve) a tous les contacts, avec file d'attente respectant les limites de debit et suivi envoye/echec.
- **Gestion du catalogue** : produits, prix, disponibilite modifiables depuis le tableau de bord (refletes en direct dans le chatbot).
- **Suivi des commandes** : statuts nouvelle → confirmee → livree / annulee.
- **Mode simulation integre** : sans credentials Meta, la plateforme tourne en local avec un simulateur de client — parfait pour les demos commerciales et les tests.

## Prerequis

- Node.js 18 ou plus recent
- Pour la production : un compte [Meta for Developers](https://developers.facebook.com), une app de type Business, et le produit WhatsApp active

## Installation

```bash
cd agrovia-whatsapp
npm install
cp .env.example .env
# Modifier .env : au minimum ADMIN_PASSWORD et SESSION_SECRET
npm start
```

Ouvrir http://localhost:3000 — connexion avec le mot de passe defini dans `.env`.

**Sans credentials Meta**, la plateforme demarre automatiquement en **mode simulation** : utilise le "Simulateur de client" sur le tableau de bord pour dialoguer avec le chatbot (envoie "Bonjour", puis "1", "2"...) et voir tout le flux fonctionner (commandes, conversations, statistiques).

## Connexion a Meta (production)

1. Sur [developers.facebook.com](https://developers.facebook.com), creer une app Business et activer le produit **WhatsApp**.
2. Recuperer le **token d'acces** et le **Phone Number ID** (un numero de test gratuit est fourni au debut) → les mettre dans `.env` (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`).
3. Exposer le serveur en HTTPS (obligatoire pour le webhook) :
   - En production : nginx + certificat Let's Encrypt devant `localhost:3000`.
   - En test : `ngrok http 3000` ou `cloudflared tunnel` pour obtenir une URL HTTPS temporaire.
4. Dans la configuration Webhook de l'app Meta :
   - URL de rappel : `https://ton-domaine/webhook`
   - Jeton de verification : la valeur de `WEBHOOK_VERIFY_TOKEN` dans ton `.env`
   - S'abonner au champ **messages**.
5. Envoyer un message WhatsApp au numero de l'app : le chatbot repond.

Pour envoyer des messages hors de la fenetre de 24h (campagnes marketing, rappels), creer des **templates** dans le gestionnaire WhatsApp de Meta Business et utiliser le type "Template" dans l'ecran Campagnes.

## Production (serveur)

```bash
# Lancement persistant avec pm2
npm install -g pm2
pm2 start src/server.js --name agrovia-whatsapp
pm2 save && pm2 startup
```

Recommandations : mettre nginx en frontal (HTTPS, en-tetes de securite), sauvegarder regulierement le dossier `data/` (base SQLite), et surveiller les logs (`pm2 logs agrovia-whatsapp`).

## Architecture

```
Client WhatsApp ↔ Serveurs Meta ↔ [webhook HTTPS] Ce serveur (Express + SQLite)
                                          ↓
                            Chatbot / Commandes / Campagnes
                                          ↓
                            Tableau de bord web (public/)
```

- `src/config.js` — configuration (variables d'environnement)
- `src/db.js` — schema et acces SQLite (contacts, messages, commandes, campagnes, etats du bot)
- `src/whatsapp.js` — client de l'API Graph Meta (+ mode simulation)
- `src/bot.js` — logique du chatbot Agrovia (menu, catalogue, prise de commande)
- `src/webhook.js` — reception des messages et statuts Meta
- `src/campaigns.js` — file d'envoi des campagnes avec limitation de debit
- `src/dashboard.js` — API du tableau de bord (auth par session)
- `public/` — interface web (vanilla JS, sans framework)

## Evolution prevue

Cette version est mono-entreprise (Agrovia). L'etape suivante pour en faire un produit commercialisable : multi-tenant (plusieurs entreprises isolees, chacune avec son numero WhatsApp, ses produits et ses agents), facturation par abonnement + volume de messages (Airtel Money / Moov Money), et gestion des templates depuis l'interface.
