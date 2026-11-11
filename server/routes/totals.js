// Module 7 (part 1) — approved-only financial aggregations.
// Pending orders never count toward totals; their number is shown separately.
const express = require('express');
const { getKnex } = require('../db/connection');
const { requirePermission } = require('../middleware/auth');
const { wrap } = require('../lib/wrap');
const { parseMonth, monthRange, shiftMonth } = require('../lib/dates');

const router = express.Router();

router.get('/totals', requirePermission('VIEW_DASHBOARD'), wrap(async (req, res) => {
  const knex = getKnex();
  const month = parseMonth(req.query.month);
  const { start, end } = monthRange(month);
  const stores = await knex('stores').orderBy('name').select('id', 'name');
  const storeId = stores.find((s) => String(s.id) === String(req.query.store))?.id || null;

  const approved = () => {
    const q = knex('orders as o')
      .join('order_lines as l', 'l.order_id', 'o.id')
      .where('o.status', 'approved')
      .andWhere('o.order_date', '>=', start)
      .andWhere('o.order_date', '<', end);
    if (storeId) q.andWhere('o.store_id', storeId);
    return q;
  };

  const byStore = await approved()
    .join('stores as s', 's.id', 'o.store_id')
    .groupBy('s.id')
    .orderBy('s.name')
    .select(
      's.id',
      's.name',
      knex.raw('COUNT(DISTINCT o.id) as orders'),
      knex.raw('SUM(l.quantity) as units'),
      knex.raw('SUM(l.quantity * l.unit_price_cents) as total_cents')
    );

  const byProduct = await approved()
    .join('products as p', 'p.id', 'l.product_id')
    .groupBy('p.id')
    .orderByRaw('SUM(l.quantity * l.unit_price_cents) DESC')
    .select(
      'p.sku',
      'p.name',
      knex.raw('SUM(l.quantity) as units'),
      knex.raw('SUM(l.quantity * l.unit_price_cents) as total_cents')
    );

  const pendingQ = knex('orders')
    .where('status', 'pending')
    .andWhere('order_date', '>=', start)
    .andWhere('order_date', '<', end);
  if (storeId) pendingQ.andWhere('store_id', storeId);
  const pending = await pendingQ.count({ n: '*' }).first();

  res.render('totals', {
    title: 'Totals',
    month,
    prev: shiftMonth(month, -1),
    next: shiftMonth(month, 1),
    stores,
    storeId,
    byStore,
    byProduct,
    grandTotal: byStore.reduce((s, r) => s + Number(r.total_cents), 0),
    grandUnits: byStore.reduce((s, r) => s + Number(r.units), 0),
    grandOrders: byStore.reduce((s, r) => s + Number(r.orders), 0),
    pendingCount: Number(pending.n),
  });
}));

module.exports = router;
