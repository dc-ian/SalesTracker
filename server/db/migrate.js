// Phase 4 — Automated migrations on launch.
// Before applying anything to an existing database, takes a VACUUM INTO
// backup (kept: newest 5) so a bad migration never costs the user their data.

const fs = require('fs');
const path = require('path');
const { getKnex } = require('./connection');
const { getUserDataDir } = require('../config/paths');

const KEEP_BACKUPS = 5;

async function backupBeforeMigrating(knex) {
  const hasHistory = await knex.schema.hasTable('knex_migrations');
  if (!hasHistory) return null; // brand-new database, nothing to protect

  const [, pending] = await knex.migrate.list();
  if (pending.length === 0) return null;

  const dir = path.join(getUserDataDir(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `data-pre-migrate-${stamp}.db`);
  await knex.raw('VACUUM INTO ?', [file]);

  const old = fs.readdirSync(dir).filter((f) => f.startsWith('data-pre-migrate-')).sort();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) {
    fs.unlinkSync(path.join(dir, f));
  }
  return file;
}

async function runMigrations() {
  const knex = getKnex();
  const backup = await backupBeforeMigrating(knex);
  if (backup) console.log(`Database backed up to ${backup}`);

  const [batch, applied] = await knex.migrate.latest();
  if (applied.length > 0) {
    console.log(`Applied migrations (batch ${batch}): ${applied.join(', ')}`);
  } else {
    console.log('Database schema is up to date.');
  }
}

module.exports = { runMigrations };
