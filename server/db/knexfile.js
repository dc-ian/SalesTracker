// Phase 4 — Knex configuration.
// Used by the app (via connection.js) and by the CLI:
//   npx knex --knexfile server/db/knexfile.js migrate:make <name>

const path = require('path');
const { getDbPath } = require('../config/paths');

module.exports = {
  client: 'better-sqlite3',
  connection: { filename: getDbPath() },
  useNullAsDefault: true, // SQLite has no DEFAULT keyword for inserts
  migrations: {
    directory: path.join(__dirname, 'migrations'),
    tableName: 'knex_migrations',
  },
  pool: {
    // Same pragmas as the Phase 1 raw connection.
    afterCreate(conn, done) {
      conn.pragma('journal_mode = WAL');
      conn.pragma('foreign_keys = ON');
      done();
    },
  },
};
