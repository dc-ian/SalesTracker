// Express app factory (server-rendered, EJS templates)
// Kept separate from index.js so Electron (or tests) can build the app
// without binding a port.

const path = require('path');
const express = require('express');
const session = require('express-session');
const { loadEnv, getSessionSecret } = require('./config/secrets');
const { wrap } = require('./lib/wrap');
const { formatMoney } = require('./lib/money');
const { hostGuard, securityHeaders, noStore } = require('./middleware/security');
const flash = require('./middleware/flash');
const csrf = require('./middleware/csrf');
const { loadUser } = require('./middleware/auth');

function createApp() {
  loadEnv();

  const app = express();
  const isProd = process.env.NODE_ENV === 'production';

  app.disable('x-powered-by');

  // Phase 6: reject non-loopback Host headers, set security headers on everything.
  app.use(hostGuard);
  app.use(securityHeaders);

  // Templating
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.locals.money = formatMoney;

  // Static assets, then body parsing (forms only; small limits)
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.urlencoded({ extended: false, limit: '200kb', parameterLimit: 2000 }));
  app.use(noStore);

  // Sessions (signed with the key from secrets.js).
  // MemoryStore: sessions reset when the app restarts, which suits a local desktop app.
  app.use(
    session({
      name: 'sid',
      secret: getSessionSecret(),
      resave: false,
      saveUninitialized: false,
      rolling: true, // 8h of inactivity, not 8h since login
      cookie: {
        httpOnly: true, // not readable from page scripts
        sameSite: 'strict', // never sent on cross-site requests
        secure: false, // plain http://127.0.0.1 inside the desktop app; no TLS on loopback
        maxAge: 1000 * 60 * 60 * 8,
      },
    })
  );

  // Flash messages, current user, CSRF protection
  app.use(flash);
  app.use(wrap(loadUser));
  app.use(csrf);

  // Routes
  app.use(require('./routes/auth'));
  app.use(require('./routes/dashboard'));
  app.use(require('./routes/orders'));
  app.use(require('./routes/fixRequests'));
  app.use(require('./routes/totals'));
  app.use(require('./routes/admin'));
  app.use(require('./routes/index')); // /health

  // 404 + error handling
  app.use((req, res) => {
    res.status(404).render('error', { title: 'Not found', message: 'Page not found.' });
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).render('error', {
      title: status === 404 ? 'Not found' : status === 403 ? 'Not allowed' : 'Something went wrong',
      message: err.expose || !isProd ? err.message : 'Something went wrong.',
    });
  });

  return app;
}

module.exports = { createApp };
