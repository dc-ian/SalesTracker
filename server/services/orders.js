// Orders: all business rules (locking, price snapshots, audit) live here so
// routes stay thin. Every write runs in a transaction together with its
// audit entry. Inside a transaction use ONLY `trx` — the SQLite pool has a
// single connection, so touching `knex` there would deadlock.

const { getKnex } = require('../db/connection');
const { UserError } = require('../lib/errors');
const { isValidDate, monthRange } = require('../lib/dates');
const { logAudit } = require('./audit');

const MAX_LINES = 100;
const MAX_QTY = 1000000;

function insertId(result) {
  const v = Array.isArray(result) ? result[0] : result;
  return typeof v === 'object' && v !== null ? v.id : v;
}

function cleanNotes(value) {
  const s = String(value || '').trim();
  return s ? s.slice(0, 1000) : null;
}

// --- form parsing ----------------------------------------------------------
// Rows arrive as repeated `product_id` / `quantity` fields (one per row).
function rawRows(body) {
  const pids = [].concat(body.product_id === undefined ? [] : body.product_id);
  const qtys = [].concat(body.quantity === undefined ? [] : body.quantity);
  const n = Math.max(pids.length, qtys.length);
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    rows.push({ product_id: String(pids[i] || '').trim(), quantity: String(qtys[i] || '').trim() });
  }
  return rows;
}

function parseLines(body) {
  const lines = [];
  for (const row of rawRows(body)) {
    if (!row.product_id && !row.quantity) continue; // blank spare row
    const product_id = Number(row.product_id);
    const quantity = Number(row.quantity);
    if (!Number.isInteger(product_id) || product_id <= 0) {
      throw new UserError('Choose a product for every row that has a quantity.');
    }
    if (!/^\d+$/.test(row.quantity) || quantity <= 0 || quantity > MAX_QTY) {
      throw new UserError('Quantities must be whole numbers greater than zero.');
    }
    lines.push({ product_id, quantity });
  }
  if (lines.length === 0) throw new UserError('Add at least one product line.');
  if (lines.length > MAX_LINES) throw new UserError(`An order can have at most ${MAX_LINES} lines.`);
  return lines;
}

// Re-populate the sheet after a validation error.
function rowsFromBody(body, products) {
  const byId = new Map(products.map((p) => [String(p.id), p]));
  const rows = rawRows(body).map((r) => ({
    product_id: r.product_id,
    quantity: r.quantity,
    unit_price_cents: byId.has(r.product_id) ? byId.get(r.product_id).unit_price_cents : null,
  }));
  while (rows.length < 3) rows.push({ product_id: '', quantity: '', unit_price_cents: null });
  return rows;
}

// Price snapshot: the product's current price, except that a product already
// on the order being edited keeps the price it was entered at.
async function resolveLines(db, parsed, existing = []) {
  const existingPrice = new Map();
  for (const l of existing) if (!existingPrice.has(l.product_id)) existingPrice.set(l.product_id, l.unit_price_cents);

  const ids = [...new Set(parsed.map((l) => l.product_id))];
  const products = await db('products')
    .whereIn('id', ids)
    .andWhere(function allowed() {
      this.where('is_active', 1).orWhereIn('id', [...existingPrice.keys()]);
    })
    .select('id', 'unit_price_cents');
  const byId = new Map(products.map((p) => [p.id, p]));

  return parsed.map((l) => {
    const p = byId.get(l.product_id);
    if (!p) throw new UserError('A selected product no longer exists or is inactive.');
    return {
      product_id: p.id,
      quantity: l.quantity,
      unit_price_cents: existingPrice.has(p.id) ? existingPrice.get(p.id) : p.unit_price_cents,
    };
  });
}

// --- reads -----------------------------------------------------------------
async function activeProducts() {
  return getKnex()('products').where('is_active', 1).orderBy('name').select('id', 'sku', 'name', 'unit_price_cents');
}

async function productsForOrder(order) {
  const ids = order.lines.map((l) => l.product_id);
  return getKnex()('products')
    .where('is_active', 1)
    .orWhereIn('id', ids.length ? ids : [0])
    .orderBy('name')
    .select('id', 'sku', 'name', 'unit_price_cents');
}

async function getOrder(id) {
  const knex = getKnex();
  const order = await knex('orders as o')
    .join('stores as s', 's.id', 'o.store_id')
    .join('users as c', 'c.id', 'o.created_by')
    .leftJoin('users as a', 'a.id', 'o.approved_by')
    .where('o.id', id)
    .first('o.*', 's.name as store_name', 'c.display_name as created_by_name', 'a.display_name as approved_by_name');
  if (!order) throw new UserError('Order not found.', 404);

  order.lines = await knex('order_lines as l')
    .join('products as p', 'p.id', 'l.product_id')
    .where('l.order_id', id)
    .orderBy('l.id')
    .select('l.*', 'p.sku', 'p.name as product_name');
  order.total_cents = order.lines.reduce((sum, l) => sum + l.quantity * l.unit_price_cents, 0);
  return order;
}

async function listOrders(storeId, month) {
  const knex = getKnex();
  const { start, end } = monthRange(month);
  return knex('orders as o')
    .join('users as u', 'u.id', 'o.created_by')
    .leftJoin('order_lines as l', 'l.order_id', 'o.id')
    .where('o.store_id', storeId)
    .andWhere('o.order_date', '>=', start)
    .andWhere('o.order_date', '<', end)
    .groupBy('o.id')
    .orderBy('o.order_date', 'desc')
    .orderBy('o.id', 'desc')
    .select(
      'o.*',
      'u.display_name as created_by_name',
      knex.raw('COUNT(l.id) as line_count'),
      knex.raw('COALESCE(SUM(l.quantity * l.unit_price_cents), 0) as total_cents')
    );
}

// Map(store_id -> { total, waiting }) for a month — drives the "N waiting" badges.
async function monthStats(month) {
  const knex = getKnex();
  const { start, end } = monthRange(month);
  const rows = await knex('orders')
    .where('order_date', '>=', start)
    .andWhere('order_date', '<', end)
    .groupBy('store_id')
    .select(
      'store_id',
      knex.raw('COUNT(*) as total'),
      knex.raw("SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as waiting")
    );
  return new Map(rows.map((r) => [r.store_id, { total: Number(r.total), waiting: Number(r.waiting) }]));
}

async function listFixRequestsForOrder(orderId) {
  return getKnex()('correction_requests as r')
    .join('users as u', 'u.id', 'r.requested_by')
    .leftJoin('users as v', 'v.id', 'r.resolved_by')
    .where('r.order_id', orderId)
    .orderBy('r.id', 'desc')
    .select('r.*', 'u.display_name as requested_by_name', 'v.display_name as resolved_by_name');
}

// --- writes ----------------------------------------------------------------
async function createOrder(user, { storeId, orderDate, notes, body }) {
  if (!isValidDate(orderDate)) throw new UserError('Enter a valid order date.');
  const parsed = parseLines(body);

  return getKnex().transaction(async (trx) => {
    const store = await trx('stores').where({ id: storeId, is_active: 1 }).first();
    if (!store) throw new UserError('Store not found or inactive.', 404);

    const lines = await resolveLines(trx, parsed);
    const orderId = insertId(
      await trx('orders').insert({
        store_id: store.id,
        created_by: user.id,
        order_date: orderDate,
        notes: cleanNotes(notes),
      })
    );
    await trx('order_lines').insert(lines.map((l) => ({ ...l, order_id: orderId })));
    await logAudit(trx, {
      user,
      action: 'order.create',
      entityType: 'order',
      entityId: orderId,
      details: { store: store.name, order_date: orderDate, lines },
    });
    return orderId;
  });
}

async function updateOrder(user, orderId, { orderDate, notes, body }) {
  if (!isValidDate(orderDate)) throw new UserError('Enter a valid order date.');
  const parsed = parseLines(body);

  return getKnex().transaction(async (trx) => {
    const order = await trx('orders').where({ id: orderId }).first();
    if (!order) throw new UserError('Order not found.', 404);
    if (order.status !== 'pending') {
      throw new UserError('Approved orders are locked. Unapprove the order to edit it.', 409);
    }

    const before = await trx('order_lines').where({ order_id: orderId }).orderBy('id');
    const lines = await resolveLines(trx, parsed, before);

    const changed = await trx('orders')
      .where({ id: orderId, status: 'pending' })
      .update({ order_date: orderDate, notes: cleanNotes(notes), updated_at: trx.fn.now() });
    if (!changed) throw new UserError('Approved orders are locked. Unapprove the order to edit it.', 409);

    await trx('order_lines').where({ order_id: orderId }).del();
    await trx('order_lines').insert(lines.map((l) => ({ ...l, order_id: orderId })));

    const strip = (ls) => ls.map((l) => ({ product_id: l.product_id, quantity: l.quantity, unit_price_cents: l.unit_price_cents }));
    await logAudit(trx, {
      user,
      action: 'order.update',
      entityType: 'order',
      entityId: orderId,
      details: {
        before: { order_date: order.order_date, notes: order.notes, lines: strip(before) },
        after: { order_date: orderDate, notes: cleanNotes(notes), lines },
      },
    });
  });
}

async function deleteOrder(user, orderId) {
  return getKnex().transaction(async (trx) => {
    const order = await trx('orders').where({ id: orderId }).first();
    if (!order) throw new UserError('Order not found.', 404);
    if (order.status !== 'pending') {
      throw new UserError('Approved orders are locked. Unapprove the order before deleting it.', 409);
    }
    const lines = await trx('order_lines').where({ order_id: orderId }).orderBy('id');

    const removed = await trx('orders').where({ id: orderId, status: 'pending' }).del();
    if (!removed) throw new UserError('Approved orders are locked. Unapprove the order before deleting it.', 409);

    await logAudit(trx, {
      user,
      action: 'order.delete',
      entityType: 'order',
      entityId: orderId,
      details: { order, lines },
    });
    return { store_id: order.store_id, order_date: order.order_date };
  });
}

async function approveOrder(user, orderId) {
  return getKnex().transaction(async (trx) => {
    const changed = await trx('orders')
      .where({ id: orderId, status: 'pending' })
      .update({ status: 'approved', approved_by: user.id, approved_at: trx.fn.now(), updated_at: trx.fn.now() });
    if (!changed) {
      const exists = await trx('orders').where({ id: orderId }).first('id');
      throw new UserError(exists ? 'This order is already approved.' : 'Order not found.', exists ? 409 : 404);
    }
    await logAudit(trx, { user, action: 'order.approve', entityType: 'order', entityId: orderId });
  });
}

async function unapproveOrder(user, orderId) {
  return getKnex().transaction(async (trx) => {
    const changed = await trx('orders')
      .where({ id: orderId, status: 'approved' })
      .update({ status: 'pending', approved_by: null, approved_at: null, updated_at: trx.fn.now() });
    if (!changed) {
      const exists = await trx('orders').where({ id: orderId }).first('id');
      throw new UserError(exists ? 'This order is not approved.' : 'Order not found.', exists ? 409 : 404);
    }
    await logAudit(trx, { user, action: 'order.unapprove', entityType: 'order', entityId: orderId });
  });
}

module.exports = {
  activeProducts,
  productsForOrder,
  getOrder,
  listOrders,
  monthStats,
  listFixRequestsForOrder,
  rowsFromBody,
  createOrder,
  updateOrder,
  deleteOrder,
  approveOrder,
  unapproveOrder,
};
