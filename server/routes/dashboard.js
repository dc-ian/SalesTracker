// Module 2 — store & month selector with "N waiting" approval badges.
const express = require('express');
const { getKnex } = require('../db/connection');
const { requirePermission } = require('../middleware/auth');
const { wrap } = require('../lib/wrap');
const { parseMonth, shiftMonth } = require('../lib/dates');
const orders = require('../services/orders');

const router = express.Router();

router.get('/', requirePermission('VIEW_DASHBOARD'), wrap(async (req, res) => {
  const month = parseMonth(req.query.month);
  const stores = await getKnex()('stores').where('is_active', 1).orderBy('name');
  const stats = await orders.monthStats(month);

  const cards = stores.map((s) => {
    const st = stats.get(s.id) || { total: 0, waiting: 0 };
    return { ...s, total: st.total, waiting: st.waiting };
  });
  res.render('dashboard', {
    title: 'Dashboard',
    month,
    prev: shiftMonth(month, -1),
    next: shiftMonth(month, 1),
    cards,
  });
}));

// Polled by public/js/dashboard.js to keep the badges current.
router.get('/api/waiting', requirePermission('VIEW_DASHBOARD'), wrap(async (req, res) => {
  const month = parseMonth(req.query.month);
  const stats = await orders.monthStats(month);
  const result = {};
  let total = 0;
  for (const [storeId, st] of stats) {
    result[storeId] = st.waiting;
    total += st.waiting;
  }
  res.json({ month, stores: result, total });
}));

module.exports = router;
