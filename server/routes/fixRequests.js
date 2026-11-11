// Module 5 — employee fix requests on locked (approved) orders.
const express = require('express');
const { getKnex } = require('../db/connection');
const { requireLogin, requirePermission } = require('../middleware/auth');
const { ROLES } = require('../config/roles');
const { wrap, action } = require('../lib/wrap');
const { UserError, toId } = require('../lib/errors');
const { logAudit } = require('../services/audit');

const router = express.Router();

// Employees see their own requests; admins see everyone's (open first).
router.get('/fix-requests', requireLogin, wrap(async (req, res) => {
  const q = getKnex()('correction_requests as r')
    .join('orders as o', 'o.id', 'r.order_id')
    .join('stores as s', 's.id', 'o.store_id')
    .join('users as u', 'u.id', 'r.requested_by')
    .leftJoin('users as v', 'v.id', 'r.resolved_by')
    .select(
      'r.*',
      'o.order_date',
      's.name as store_name',
      'u.display_name as requested_by_name',
      'v.display_name as resolved_by_name'
    )
    .orderByRaw("CASE r.status WHEN 'open' THEN 0 ELSE 1 END")
    .orderBy('r.id', 'desc')
    .limit(200);
  if (req.user.role !== ROLES.ADMIN) q.where('r.requested_by', req.user.id);
  res.render('fix_requests', { title: 'Fix requests', requests: await q });
}));

// Employee submits a request against an approved order.
router.post('/orders/:id/fix-requests', requirePermission('SUBMIT_FIX_REQUEST'),
  action((req) => `/orders/${req.params.id}`, async (req, res) => {
    const orderId = toId(req.params.id);
    const message = String(req.body.message || '').trim();
    if (message.length < 5) throw new UserError('Describe what needs to be fixed (at least a few words).');
    if (message.length > 2000) throw new UserError('Message is too long (2000 characters max).');

    await getKnex().transaction(async (trx) => {
      const order = await trx('orders').where({ id: orderId }).first();
      if (!order) throw new UserError('Order not found.', 404);
      if (order.status !== 'approved') {
        throw new UserError('Fix requests are only for approved (locked) orders.', 409);
      }
      const dup = await trx('correction_requests')
        .where({ order_id: orderId, requested_by: req.user.id, status: 'open' })
        .first('id');
      if (dup) throw new UserError('You already have an open fix request for this order.', 409);

      const result = await trx('correction_requests').insert({
        order_id: orderId,
        requested_by: req.user.id,
        message,
      });
      const id = Array.isArray(result) ? result[0] : result;
      await logAudit(trx, {
        user: req.user,
        action: 'fix_request.create',
        entityType: 'correction_request',
        entityId: typeof id === 'object' ? id.id : id,
        details: { order_id: orderId, message },
      });
    });
    req.flash('success', 'Fix request sent to an administrator.');
    res.redirect(`/orders/${orderId}`);
  }));

// Admin resolves or rejects a request.
router.post('/fix-requests/:id/resolve', requirePermission('EDIT_DELETE_ORDER'),
  action('/fix-requests', async (req, res) => {
    const id = toId(req.params.id);
    const decision = req.body.decision === 'rejected' ? 'rejected' : 'resolved';
    const note = String(req.body.note || '').trim().slice(0, 1000) || null;

    await getKnex().transaction(async (trx) => {
      const changed = await trx('correction_requests')
        .where({ id, status: 'open' })
        .update({
          status: decision,
          resolved_by: req.user.id,
          resolved_at: trx.fn.now(),
          resolution_note: note,
          updated_at: trx.fn.now(),
        });
      if (!changed) throw new UserError('That request is already closed or does not exist.', 409);
      await logAudit(trx, {
        user: req.user,
        action: `fix_request.${decision}`,
        entityType: 'correction_request',
        entityId: id,
        details: { note },
      });
    });
    req.flash('success', `Request marked ${decision}.`);
    res.redirect('/fix-requests');
  }));

module.exports = router;
