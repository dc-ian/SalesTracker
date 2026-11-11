// Modules 3 & 4 — multi-line data sheet and admin order actions.
const express = require('express');
const { getKnex } = require('../db/connection');
const { requirePermission } = require('../middleware/auth');
const { wrap, action } = require('../lib/wrap');
const { UserError, toId } = require('../lib/errors');
const { today, parseMonth, shiftMonth } = require('../lib/dates');
const { parseMoney } = require('../lib/money');
const { logAudit } = require('../services/audit');
const { SHIPPING_STATUSES, REMARKS } = require('../config/sales');
const svc = require('../services/orders');

const router = express.Router();

// Only allow same-site relative redirects from the `back` form field.
function safeBack(req, fallback) {
  const b = req.body && req.body.back;
  return typeof b === 'string' && /^\/(?!\/)/.test(b) ? b : fallback;
}

async function getStore(id) {
  const store = await getKnex()('stores').where({ id: toId(id) }).first();
  if (!store) throw new UserError('Store not found.', 404);
  return store;
}

const blankRows = (n) => Array.from({ length: n }, () => ({ product_id: '', quantity: '', unit_price_cents: null }));

// --- store -> year / month picker -----------------------------------------
router.get('/stores/:storeId', requirePermission('VIEW_DASHBOARD'), wrap(async (req, res) => {
  const store = await getStore(req.params.storeId);
  let year = parseInt(req.query.year, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) year = new Date().getFullYear();
  res.render('store_months', { title: store.name, store, year });
}));

// --- order sheet for one store + month ---------------------------------------
const text = (v, max = 200) => String(v || '').trim().slice(0, max);
const idOf = (result) => {
  const v = Array.isArray(result) ? result[0] : result;
  return typeof v === 'object' && v !== null ? v.id : v;
};

function cents(v, label) {
  const s = String(v == null ? '' : v).replace(/,/g, '').trim();
  if (!s) return null;
  const c = parseMoney(s);
  if (c == null) throw new UserError(`${label} must be a number like 12.50.`);
  return c;
}

function rowFields(body) {
  const order_number = text(body.order_number, 60);
  const product_name = text(body.product_name);
  if (!order_number) throw new UserError('Order number is required.');
  if (!product_name) throw new UserError('Product name is required.');
  const qty = parseInt(body.qty, 10);
  if (!Number.isInteger(qty) || qty < 1 || qty > 100000) throw new UserError('Qty must be a whole number of 1 or more.');
  const shipping_status = String(body.shipping_status || '');
  if (!SHIPPING_STATUSES.includes(shipping_status)) throw new UserError('Choose a valid status.');
  const remarks = String(body.remarks || '');
  if (remarks && !REMARKS.includes(remarks)) throw new UserError('Choose a valid remark.');
  return {
    order_number,
    tracking_no: text(body.tracking_no, 60) || null,
    product_code: text(body.product_code, 60) || null,
    product_name,
    distributor_price_cents: cents(body.distributor_price, 'Distributor price') || 0,
    qty,
    retail_price_cents: cents(body.retail_price, 'Retail price'),
    paid_by_customer_cents: cents(body.paid_by_customer, 'Paid by customer'),
    received_cents: cents(body.received, 'Received'),
    price_adjustment_cents: cents(body.price_adjustment, 'Price adjustment'),
    shipping_status,
    remarks: remarks || null,
  };
}

router.get('/stores/:storeId/orders', requirePermission('VIEW_DASHBOARD'), wrap(async (req, res) => {
  const store = await getStore(req.params.storeId);
  const month = parseMonth(req.query.month);
  const rows = await getKnex()('sales_rows').where({ store_id: store.id, entry_month: month }).orderBy('id');
  const approved = rows.filter((r) => r.approved);
  const stats = {
    approvedSales: approved.reduce((n, r) => n + r.distributor_price_cents * r.qty, 0),
    units: approved.reduce((n, r) => n + r.qty, 0),
    waiting: rows.length - approved.length,
  };
  const editId = req.query.edit ? toId(req.query.edit) : null;
  const editRow = editId ? rows.find((r) => r.id === editId && !r.approved) || null : null;
  res.render('store_orders', {
    title: store.name,
    store,
    month,
    rows,
    stats,
    editRow,
    statuses: SHIPPING_STATUSES,
    remarkOptions: REMARKS,
  });
}));

const sheetUrl = (req) => safeBack(req, '/');

router.post('/stores/:storeId/rows', requirePermission('CREATE_ORDER'), action(sheetUrl, async (req, res) => {
  const store = await getStore(req.params.storeId);
  if (!store.is_active) throw new UserError('This store is hidden.', 409);
  const month = parseMonth(req.body.month);
  const row = { ...rowFields(req.body), store_id: store.id, entry_month: month, created_by: req.user.id };
  await getKnex().transaction(async (trx) => {
    const id = idOf(await trx('sales_rows').insert(row));
    await logAudit(trx, { user: req.user, action: 'row.create', entityType: 'sales_row', entityId: id, details: row });
  });
  req.flash('success', 'Row added.');
  res.redirect(sheetUrl(req));
}));

async function pendingRow(trx, id) {
  const row = await trx('sales_rows').where({ id }).first();
  if (!row) throw new UserError('Row not found.', 404);
  return row;
}

router.post('/rows/:id', requirePermission('EDIT_DELETE_ORDER'), action(sheetUrl, async (req, res) => {
  const id = toId(req.params.id);
  const fields = rowFields(req.body);
  await getKnex().transaction(async (trx) => {
    const before = await pendingRow(trx, id);
    if (before.approved) throw new UserError('Approved rows are locked. Click Approved to unapprove it first.', 409);
    await trx('sales_rows').where({ id }).update({ ...fields, updated_at: trx.fn.now() });
    await logAudit(trx, { user: req.user, action: 'row.update', entityType: 'sales_row', entityId: id, details: { before, after: fields } });
  });
  req.flash('success', 'Row saved.');
  res.redirect(sheetUrl(req));
}));

router.post('/rows/:id/approve', requirePermission('APPROVE_UNAPPROVE_ORDER'), action(sheetUrl, async (req, res) => {
  const id = toId(req.params.id);
  await getKnex().transaction(async (trx) => {
    await pendingRow(trx, id);
    await trx('sales_rows').where({ id }).update({ approved: 1, approved_by: req.user.id, approved_at: trx.fn.now(), updated_at: trx.fn.now() });
    await logAudit(trx, { user: req.user, action: 'row.approve', entityType: 'sales_row', entityId: id, details: {} });
  });
  req.flash('success', 'Row approved and locked.');
  res.redirect(sheetUrl(req));
}));

router.post('/rows/:id/unapprove', requirePermission('APPROVE_UNAPPROVE_ORDER'), action(sheetUrl, async (req, res) => {
  const id = toId(req.params.id);
  await getKnex().transaction(async (trx) => {
    await pendingRow(trx, id);
    await trx('sales_rows').where({ id }).update({ approved: 0, approved_by: null, approved_at: null, updated_at: trx.fn.now() });
    await logAudit(trx, { user: req.user, action: 'row.unapprove', entityType: 'sales_row', entityId: id, details: {} });
  });
  req.flash('success', 'Row unapproved. It can be edited again.');
  res.redirect(sheetUrl(req));
}));

router.post('/rows/:id/delete', requirePermission('EDIT_DELETE_ORDER'), action(sheetUrl, async (req, res) => {
  const id = toId(req.params.id);
  await getKnex().transaction(async (trx) => {
    const before = await pendingRow(trx, id);
    if (before.approved) throw new UserError('Approved rows are locked. Unapprove it first.', 409);
    await trx('sales_rows').where({ id }).del();
    await logAudit(trx, { user: req.user, action: 'row.delete', entityType: 'sales_row', entityId: id, details: before });
  });
  req.flash('success', 'Row deleted.');
  res.redirect(sheetUrl(req));
}));

// --- create ----------------------------------------------------------------
router.get('/stores/:storeId/orders/new', requirePermission('CREATE_ORDER'), wrap(async (req, res) => {
  const store = await getStore(req.params.storeId);
  if (!store.is_active) throw new UserError('This store is inactive.', 409);
  res.render('order_form', {
    title: 'New order',
    store,
    order: null,
    products: await svc.activeProducts(),
    rows: blankRows(5),
    orderDate: today(),
    notes: '',
    error: null,
    formAction: `/stores/${store.id}/orders`,
  });
}));

router.post('/stores/:storeId/orders', requirePermission('CREATE_ORDER'), wrap(async (req, res) => {
  const store = await getStore(req.params.storeId);
  try {
    const id = await svc.createOrder(req.user, {
      storeId: store.id,
      orderDate: req.body.order_date,
      notes: req.body.notes,
      body: req.body,
    });
    req.flash('success', `Order #${id} saved.`);
    res.redirect(`/orders/${id}`);
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    const products = await svc.activeProducts();
    res.status(e.status).render('order_form', {
      title: 'New order',
      store,
      order: null,
      products,
      rows: svc.rowsFromBody(req.body, products),
      orderDate: req.body.order_date || today(),
      notes: req.body.notes || '',
      error: e.message,
      formAction: `/stores/${store.id}/orders`,
    });
  }
}));

// --- view ------------------------------------------------------------------
router.get('/orders/:id', requirePermission('VIEW_DASHBOARD'), wrap(async (req, res) => {
  const order = await svc.getOrder(toId(req.params.id));
  const fixes = await svc.listFixRequestsForOrder(order.id);
  res.render('order_view', { title: `Order #${order.id}`, order, fixes });
}));

// --- edit (admin, pending only) ---------------------------------------------
router.get('/orders/:id/edit', requirePermission('EDIT_DELETE_ORDER'), wrap(async (req, res) => {
  const order = await svc.getOrder(toId(req.params.id));
  if (order.status !== 'pending') {
    req.flash('error', 'Approved orders are locked. Unapprove the order to edit it.');
    return res.redirect(`/orders/${order.id}`);
  }
  res.render('order_form', {
    title: `Edit order #${order.id}`,
    store: { id: order.store_id, name: order.store_name },
    order,
    products: await svc.productsForOrder(order),
    rows: order.lines.map((l) => ({
      product_id: String(l.product_id),
      quantity: String(l.quantity),
      unit_price_cents: l.unit_price_cents,
    })),
    orderDate: order.order_date,
    notes: order.notes || '',
    error: null,
    formAction: `/orders/${order.id}`,
  });
}));

router.post('/orders/:id', requirePermission('EDIT_DELETE_ORDER'), wrap(async (req, res) => {
  const id = toId(req.params.id);
  try {
    await svc.updateOrder(req.user, id, {
      orderDate: req.body.order_date,
      notes: req.body.notes,
      body: req.body,
    });
    req.flash('success', 'Order updated.');
    res.redirect(`/orders/${id}`);
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    const order = await svc.getOrder(id);
    const products = await svc.productsForOrder(order);
    res.status(e.status).render('order_form', {
      title: `Edit order #${order.id}`,
      store: { id: order.store_id, name: order.store_name },
      order,
      products,
      rows: svc.rowsFromBody(req.body, products),
      orderDate: req.body.order_date || order.order_date,
      notes: req.body.notes || '',
      error: e.message,
      formAction: `/orders/${order.id}`,
    });
  }
}));

// --- approve / unapprove / delete ------------------------------------------------
const orderPage = (req) => safeBack(req, `/orders/${req.params.id}`);

router.post('/orders/:id/approve', requirePermission('APPROVE_UNAPPROVE_ORDER'), action(orderPage, async (req, res) => {
  await svc.approveOrder(req.user, toId(req.params.id));
  req.flash('success', 'Order approved and locked.');
  res.redirect(orderPage(req));
}));

router.post('/orders/:id/unapprove', requirePermission('APPROVE_UNAPPROVE_ORDER'), action(orderPage, async (req, res) => {
  await svc.unapproveOrder(req.user, toId(req.params.id));
  req.flash('success', 'Order unapproved. It can be edited again.');
  res.redirect(orderPage(req));
}));

router.post('/orders/:id/delete', requirePermission('EDIT_DELETE_ORDER'), action(orderPage, async (req, res) => {
  const gone = await svc.deleteOrder(req.user, toId(req.params.id));
  req.flash('success', `Order #${req.params.id} deleted.`);
  res.redirect(safeBack(req, `/stores/${gone.store_id}/orders?month=${gone.order_date.slice(0, 7)}`));
}));

module.exports = router;