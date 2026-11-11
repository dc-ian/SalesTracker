// Module 6 — admin master pages (stores, products, users) + audit log viewer.
// Nothing is hard-deleted: records are deactivated so order history stays intact.
const express = require('express');
const { getKnex } = require('../db/connection');
const { requirePermission } = require('../middleware/auth');
const { ROLES } = require('../config/roles');
const { PLATFORMS } = require('../config/platforms');
const { wrap, action } = require('../lib/wrap');
const { UserError, toId } = require('../lib/errors');
const { parseMoney } = require('../lib/money');
const { logAudit } = require('../services/audit');
const auth = require('../services/auth');

const router = express.Router();
const manage = requirePermission('MANAGE_PRODUCTS_STORES_USERS');
const checked = (v) => (v ? 1 : 0);
const text = (v, max = 200) => String(v || '').trim().slice(0, max);
const idOf = (result) => {
  const v = Array.isArray(result) ? result[0] : result;
  return typeof v === 'object' && v !== null ? v.id : v;
};

// ============================ Stores ============================
// A store is just a platform (Lazada / Shopee / TikTok) plus a typed name.
function platformOf(v) {
  const p = PLATFORMS.find((x) => x === String(v || '').trim());
  if (!p) throw new UserError('Choose Lazada, Shopee or TikTok.');
  return p;
}

router.get('/admin/stores', manage, wrap(async (req, res) => {
  const stores = await getKnex()('stores').orderBy('platform').orderBy('name');
  res.render('admin/stores', { title: 'Store list', stores, platforms: PLATFORMS });
}));

router.post('/admin/stores', manage, action('/admin/stores', async (req, res) => {
  const name = text(req.body.name);
  if (!name) throw new UserError('Store name is required.');
  const row = { name, platform: platformOf(req.body.platform) };
  await getKnex().transaction(async (trx) => {
    const id = idOf(await trx('stores').insert(row));
    await logAudit(trx, { user: req.user, action: 'store.create', entityType: 'store', entityId: id, details: row });
  });
  req.flash('success', `Store “${name}” added.`);
  res.redirect('/admin/stores');
}));

// Used by the Hide / Show button. code and address are left untouched.
router.post('/admin/stores/:id', manage, action('/admin/stores', async (req, res) => {
  const id = toId(req.params.id);
  const name = text(req.body.name);
  if (!name) throw new UserError('Store name is required.');
  const row = { name, platform: platformOf(req.body.platform), is_active: checked(req.body.is_active) };
  await getKnex().transaction(async (trx) => {
    const before = await trx('stores').where({ id }).first();
    if (!before) throw new UserError('Store not found.', 404);
    await trx('stores').where({ id }).update({ ...row, updated_at: trx.fn.now() });
    await logAudit(trx, {
      user: req.user,
      action: 'store.update',
      entityType: 'store',
      entityId: id,
      details: { before: { name: before.name, platform: before.platform, is_active: before.is_active }, after: row },
    });
  });
  req.flash('success', row.is_active ? 'Store is visible again.' : 'Store hidden.');
  res.redirect('/admin/stores');
}));

// ============================ Products ============================
router.get('/admin/products', manage, wrap(async (req, res) => {
  res.render('admin/products', { title: 'Products', products: await getKnex()('products').orderBy('name') });
}));

function productFields(body) {
  const sku = text(body.sku, 60).toUpperCase();
  const name = text(body.name);
  const price = parseMoney(body.price);
  if (!sku) throw new UserError('SKU is required.');
  if (!name) throw new UserError('Product name is required.');
  if (price === null) throw new UserError('Enter the price as a number like 12.50.');
  return { sku, name, unit_price_cents: price };
}

router.post('/admin/products', manage, action('/admin/products', async (req, res) => {
  const row = productFields(req.body);
  await getKnex().transaction(async (trx) => {
    const id = idOf(await trx('products').insert(row));
    await logAudit(trx, { user: req.user, action: 'product.create', entityType: 'product', entityId: id, details: row });
  });
  req.flash('success', `Product ${row.sku} added.`);
  res.redirect('/admin/products');
}));

router.post('/admin/products/:id', manage, action('/admin/products', async (req, res) => {
  const id = toId(req.params.id);
  const row = { ...productFields(req.body), is_active: checked(req.body.is_active) };
  await getKnex().transaction(async (trx) => {
    const before = await trx('products').where({ id }).first();
    if (!before) throw new UserError('Product not found.', 404);
    await trx('products').where({ id }).update({ ...row, updated_at: trx.fn.now() });
    await logAudit(trx, {
      user: req.user,
      action: 'product.update',
      entityType: 'product',
      entityId: id,
      details: {
        before: { sku: before.sku, name: before.name, unit_price_cents: before.unit_price_cents, is_active: before.is_active },
        after: row,
      },
    });
  });
  req.flash('success', 'Product saved. Price changes apply to new orders only.');
  res.redirect('/admin/products');
}));

// ============================ Users ============================
router.get('/admin/users', manage, wrap(async (req, res) => {
  const users = await getKnex()('users').orderBy('username').select('id', 'username', 'display_name', 'role', 'is_active');
  res.render('admin/users', { title: 'Users', users, roles: Object.values(ROLES) });
}));

function validRole(role) {
  if (!Object.values(ROLES).includes(role)) throw new UserError('Choose a valid role.');
  return role;
}

router.post('/admin/users', manage, action('/admin/users', async (req, res) => {
  const username = auth.normalizeUsername(req.body.username);
  auth.validateUsername(username);
  const display_name = text(req.body.display_name);
  if (!display_name) throw new UserError('Display name is required.');
  const role = validRole(req.body.role);
  const password_hash = await auth.hashPassword(req.body.password);

  await getKnex().transaction(async (trx) => {
    const id = idOf(await trx('users').insert({ username, display_name, role, password_hash }));
    await logAudit(trx, { user: req.user, action: 'user.create', entityType: 'user', entityId: id, details: { username, role } });
  });
  req.flash('success', `User ${username} created.`);
  res.redirect('/admin/users');
}));

router.post('/admin/users/:id', manage, action('/admin/users', async (req, res) => {
  const id = toId(req.params.id);
  const display_name = text(req.body.display_name);
  if (!display_name) throw new UserError('Display name is required.');
  const role = validRole(req.body.role);
  const is_active = checked(req.body.is_active);
  const newPassword = String(req.body.password || '');
  const password_hash = newPassword ? await auth.hashPassword(newPassword) : null;

  await getKnex().transaction(async (trx) => {
    const before = await trx('users').where({ id }).first();
    if (!before) throw new UserError('User not found.', 404);

    if (id === req.user.id && (role !== ROLES.ADMIN || !is_active)) {
      throw new UserError('You cannot demote or deactivate your own account.', 409);
    }
    const wasActiveAdmin = before.role === ROLES.ADMIN && before.is_active;
    if (wasActiveAdmin && !(role === ROLES.ADMIN && is_active)) {
      const others = await trx('users')
        .where({ role: ROLES.ADMIN, is_active: 1 })
        .whereNot({ id })
        .count({ n: '*' })
        .first();
      if (Number(others.n) === 0) throw new UserError('There must be at least one active administrator.', 409);
    }

    const update = { display_name, role, is_active, updated_at: trx.fn.now() };
    if (password_hash) update.password_hash = password_hash;
    await trx('users').where({ id }).update(update);

    await logAudit(trx, {
      user: req.user,
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      details: {
        username: before.username,
        before: { display_name: before.display_name, role: before.role, is_active: before.is_active },
        after: { display_name, role, is_active },
        password_reset: Boolean(password_hash),
      },
    });
  });
  req.flash('success', 'User saved.');
  res.redirect('/admin/users');
}));

// ============================ Audit log ============================
const PAGE_SIZE = 50;

router.get('/admin/audit', requirePermission('VIEW_AUDIT_LOG'), wrap(async (req, res) => {
  const knex = getKnex();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const filter = String(req.query.action || '').trim();

  const base = () => {
    const q = knex('audit_log');
    if (filter) q.where('action', 'like', `${filter.replace(/[%_]/g, '')}%`);
    return q;
  };
  const total = Number((await base().count({ n: '*' }).first()).n);
  const rows = await base().orderBy('id', 'desc').limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE);

  res.render('admin/audit', {
    title: 'Audit log',
    rows,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
    filter,
  });
}));

module.exports = router;