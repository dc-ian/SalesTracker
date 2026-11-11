const bcrypt = require('bcryptjs');
const { getKnex } = require('../db/connection');
const { UserError } = require('../lib/errors');

const COST = 12;
const MIN_PASSWORD = 8;

// --- validation -----------------------------------------------------------
function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validateUsername(username) {
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new UserError('Username must be 3–32 characters: letters, numbers, dot, dash or underscore.');
  }
}

function validatePassword(password) {
  if (String(password || '').length < MIN_PASSWORD) {
    throw new UserError(`Password must be at least ${MIN_PASSWORD} characters.`);
  }
  // bcrypt silently ignores everything after 72 bytes, so refuse longer input
  // rather than let two different long passwords hash identically.
  if (Buffer.byteLength(String(password), 'utf8') > 72) {
    throw new UserError('Password is too long (72 bytes maximum).');
  }
}

function hashPassword(password) {
  validatePassword(password);
  return bcrypt.hash(password, COST);
}

// --- authentication -------------------------------------------------------
let dummyHash = null; // compared against when the user doesn't exist, to keep timing similar

async function authenticate(username, password) {
  const user = await getKnex()('users').where({ username, is_active: 1 }).first();
  if (!user) {
    dummyHash = dummyHash || (await bcrypt.hash('not-a-real-password', COST));
    await bcrypt.compare(String(password), dummyHash);
    return null;
  }
  const ok = await bcrypt.compare(String(password), user.password_hash);
  return ok ? user : null;
}

// --- simple in-memory brute-force throttle (5 failures / 10 min per username)
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const failures = new Map();

function checkThrottle(key) {
  const entry = failures.get(key);
  if (!entry) return;
  if (Date.now() - entry.first > WINDOW_MS) return failures.delete(key);
  if (entry.count >= MAX_FAILURES) {
    throw new UserError('Too many failed attempts. Wait a few minutes and try again.', 429);
  }
}

function recordFailure(key) {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    failures.set(key, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
}

function clearFailures(key) {
  failures.delete(key);
}

module.exports = {
  normalizeUsername,
  validateUsername,
  validatePassword,
  hashPassword,
  authenticate,
  checkThrottle,
  recordFailure,
  clearFailures,
};
