// Phase 2 — Secrets Management
// Resolution order for the session encryption key:
//   1. SESSION_SECRET from the environment / .env file
//   2. A key auto-generated on first run and persisted in the user-data
//      directory (outside the repo), so it survives restarts but can never
//      be committed to source control.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getUserDataDir } = require('./paths');

const MIN_LENGTH = 32;

function loadEnv() {
  // Loads .env from the project root if present; silently skipped if absent.
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
}

function getSessionSecret() {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.trim()) {
    if (fromEnv.trim().length < MIN_LENGTH) {
      throw new Error(`SESSION_SECRET must be at least ${MIN_LENGTH} characters.`);
    }
    return fromEnv.trim();
  }

  const dir = getUserDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const keyFile = path.join(dir, 'session.key');

  if (fs.existsSync(keyFile)) {
    const existing = fs.readFileSync(keyFile, 'utf8').trim();
    if (existing.length >= MIN_LENGTH) return existing;
  }

  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(keyFile, generated, { mode: 0o600 }); // owner read/write only
  return generated;
}

module.exports = { loadEnv, getSessionSecret };
