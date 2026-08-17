const path = require('path');
const express = require('express');
const session = require('express-session');
const config = require('./config');
const { router: webhookRouter } = require('./webhook');
const dashboardRouter = require('./dashboard');
const campaigns = require('./campaigns');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 },
  })
);

app.use(webhookRouter);
app.use(dashboardRouter);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(config.port, () => {
  console.log(`Agrovia WhatsApp demarre sur http://localhost:${config.port}`);
  console.log(`Mode simulation : ${config.simulate ? 'OUI (aucun appel reel a Meta)' : 'non'}`);
  // Reprendre les campagnes interrompues par un redemarrage
  campaigns.startWorker();
});
