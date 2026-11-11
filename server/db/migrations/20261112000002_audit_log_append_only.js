// Phase 5 — make audit_log immutable at the database level.
// Any UPDATE or DELETE on audit_log aborts, regardless of which code path tries it.

exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END
  `);
  await knex.raw(`
    CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS audit_log_no_update');
  await knex.raw('DROP TRIGGER IF EXISTS audit_log_no_delete');
};
