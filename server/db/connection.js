// Phase 1 — Database Selection / Phase 4 — Knex
// Shared better-sqlite3 connection (synchronous API is fine here: this app is
// one local process serving one active desktop session, not a multi-client
// server). Phase 4 adds a Knex instance on the same driver and file for
// migrations and query building.

const Database = require('better-sqlite3');
const knexLib = require('knex');
const { getDbPath } = require('../config/paths');
const knexConfig = require('./knexfile');

let db = null;
let knexInstance = null;

function getConnection() {
  if (db) return db;

  const dbPath = getDbPath();
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL'); // better read/write behavior for a local file DB
  db.pragma('foreign_keys = ON');  // enforce orders -> order_lines, etc.

  return db;
}

function getKnex() {
  if (!knexInstance) knexInstance = knexLib(knexConfig);
  return knexInstance;
}

// Called from Electron's main process on exit (Phase 3 lifecycle management).
async function closeConnection() {
  if (db) {
    db.close();
    db = null;
  }
  if (knexInstance) {
    await knexInstance.destroy();
    knexInstance = null;
  }
}

module.exports = { getConnection, getKnex, closeConnection };
