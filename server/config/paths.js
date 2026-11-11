// Phase 1 — Persistent File Location
// Resolves the SQLite database path consistently whether we're running
// inside the packaged Electron app or in a plain Node dev environment
// (e.g. running `node server/index.js` directly, or in tests).

const path = require('path');
const fs = require('fs');

function getUserDataDir() {
  // Running inside Electron (main process)
  try {
    const { app } = require('electron');
    if (app) return app.getPath('userData');
  } catch (err) {
    // 'electron' module not available — we're in plain Node
  }

  // Dev / non-Electron fallback: mimics the Windows %APPDATA%/app-name
  // location the plan specifies, on whatever OS you're developing on.
  const appName = 'data-entry-app';
  const base =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(process.env.HOME, 'Library', 'Application Support')
      : path.join(process.env.HOME, '.config'));
  return path.join(base, appName);
}

function getDbPath() {
  const dir = getUserDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'data.db');
}

module.exports = { getUserDataDir, getDbPath };
