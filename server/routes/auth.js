// Module 1 — first-run setup, login, logout.
const express = require('express');
const { getKnex } = require('../db/connection');
const { ROLES } = require('../config/roles');
const { UserError } = require('../lib/errors');
const { wrap } = require('../lib/wrap');
const { logAudit } = require('../services/audit');
const auth = require('../services/auth');

const router = express.Router();

async function userCount() {
  const row = await getKnex()('users').count({ n: '*' }).first();
  return Number(row.n);
}

const regenerate = (req) =>
  new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));

// First run only: create the initial administrator.
router.get('/setup', wrap(async (req, res) => {
  if ((await userCount()) > 0) return res.redirect('/login');
  res.render('setup', { title: 'First-time setup', error: null, form: {} });
}));

router.post('/setup', wrap(async (req, res) => {
  if ((await userCount()) > 0) return res.redirect('/login');
  const form = {
    username: auth.normalizeUsername(req.body.username),
    display_name: String(req.body.display_name || '').trim(),
  };
  try {
    auth.validateUsername(form.username);
    if (!form.display_name) throw new UserError('Enter a display name.');
    if (req.body.password !== req.body.confirm) throw new UserError('Passwords do not match.');
    const password_hash = await auth.hashPassword(req.body.password);

    await getKnex().transaction(async (trx) => {
      const [existing] = await trx('users').count({ n: '*' });
      if (Number(existing.n) > 0) throw new UserError('Setup has already been completed.', 409);
      const result = await trx('users').insert({ ...form, password_hash, role: ROLES.ADMIN });
      const id = Array.isArray(result) ? result[0] : result;
      await logAudit(trx, {
        username: form.username,
        action: 'user.create',
        entityType: 'user',
        entityId: typeof id === 'object' ? id.id : id,
        details: { role: ROLES.ADMIN, via: 'first-run setup' },
      });
    });
    req.flash('success', 'Administrator created. Sign in to continue.');
    res.redirect('/login');
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    res.status(e.status).render('setup', { title: 'First-time setup', error: e.message, form });
  }
}));

router.get('/login', wrap(async (req, res) => {
  if (req.user) return res.redirect('/');
  if ((await userCount()) === 0) return res.redirect('/setup');
  res.render('login', { title: 'Sign in', error: null, username: '' });
}));

router.post('/login', wrap(async (req, res) => {
  const username = auth.normalizeUsername(req.body.username);
  try {
    auth.checkThrottle(username);
    const user = await auth.authenticate(username, req.body.password);
    if (!user) {
      auth.recordFailure(username);
      await logAudit(getKnex(), {
        username: username || null,
        action: 'auth.login_failed',
        entityType: 'user',
      });
      throw new UserError('Invalid username or password.', 401);
    }
    auth.clearFailures(username);
    await regenerate(req); // new session id on login (prevents session fixation)
    req.session.userId = user.id;
    await logAudit(getKnex(), { user, action: 'auth.login', entityType: 'user', entityId: user.id });
    res.redirect('/');
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    res.status(e.status).render('login', { title: 'Sign in', error: e.message, username });
  }
}));

router.post('/logout', wrap(async (req, res) => {
  if (req.user) {
    await logAudit(getKnex(), { user: req.user, action: 'auth.logout', entityType: 'user', entityId: req.user.id });
  }
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.redirect('/login');
  });
}));

module.exports = router;
