require('dotenv').config();
const crypto = require('crypto');

const token = process.env.WHATSAPP_TOKEN || '';

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  token,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  graphApiVersion: process.env.GRAPH_API_VERSION || 'v21.0',
  webhookVerifyToken: process.env.WEBHOOK_VERIFY_TOKEN || 'agrovia-verify-token',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin',
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  adminNumbers: (process.env.ADMIN_NUMBERS || '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean),
  // Sans token, on bascule automatiquement en simulation pour pouvoir tout tester.
  simulate: process.env.SIMULATE === 'true' || !token,
  campaignSendIntervalMs: parseInt(process.env.CAMPAIGN_SEND_INTERVAL_MS || '1100', 10),
};
