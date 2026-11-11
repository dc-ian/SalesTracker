// Append-only operation log. Pass the knex instance, or a transaction so the
// log entry commits (or rolls back) together with the change it describes.
// The DB itself rejects UPDATE/DELETE on audit_log (see migration 2).

async function logAudit(db, { user = null, username = null, action, entityType, entityId = null, details = null }) {
  await db('audit_log').insert({
    user_id: user ? user.id : null,
    username: username || (user ? user.username : null),
    action,
    entity_type: entityType,
    entity_id: entityId,
    details: details ? JSON.stringify(details) : null,
  });
}

module.exports = { logAudit };
