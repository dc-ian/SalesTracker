// Phase 5 — session + role middleware. All role checks go through can()
// from config/roles.js (single source of truth).

const { getKnex } = require('../db/connection');
const { can, ROLES } = require('../config/roles');

// Loads the current user from the session on every request, so deactivating
// or demoting a user takes effect immediately.
async function loadUser(req, res, next) {
  req.user = null;
  res.locals.user = null;
  res.locals.openFixCount = 0;
  res.locals.can = () => false;

  const id = req.session && req.session.userId;
  if (id) {
    const knex = getKnex();
    const user = await knex('users')
      .where({ id, is_active: 1 })
      .first('id', 'username', 'display_name', 'role');
    if (user) {
      req.user = user;
      res.locals.user = user;
      res.locals.can = (permission) => can(user.role, permission);
      if (user.role === ROLES.ADMIN) {
        const row = await knex('correction_requests').where({ status: 'open' }).count({ n: '*' }).first();
        res.locals.openFixCount = Number(row.n) || 0;
      }
    } else {
      delete req.session.userId;
    }
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (!can(req.user.role, permission)) {
      return res.status(403).render('error', {
        title: 'Not allowed',
        message: 'You do not have permission to do that.',
      });
    }
    next();
  };
}

module.exports = { loadUser, requireLogin, requirePermission };
