#!/usr/bin/env node
// Phase 6 — static security checklist. Run: npm run check:security
// Fails (exit 1) if a hardening rule from the checklist is violated.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const problems = [];
const fail = (msg) => problems.push(msg);

function walk(dir, ext, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, ext, out);
    else if (full.endsWith(ext)) out.push(full);
  }
  return out;
}
const rel = (f) => path.relative(root, f);

// 1. Electron webPreferences
const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
if (!/contextIsolation:\s*true/.test(main)) fail('electron/main.js: contextIsolation must be true');
if (!/nodeIntegration:\s*false/.test(main)) fail('electron/main.js: nodeIntegration must be false');
if (/contextIsolation:\s*false|nodeIntegration:\s*true|webSecurity:\s*false/.test(main)) {
  fail('electron/main.js: an insecure webPreferences value is present');
}

// 2. SQL: no string building in raw SQL
const RAW = /\b(raw|whereRaw|orderByRaw|havingRaw|groupByRaw|joinRaw|prepare|exec)\(\s*(`[^`]*\$\{|[^,)\n]*['"]\s*\+|[^,)\n]*\+\s*['"])/;
for (const file of walk(path.join(root, 'server'), '.js')) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (RAW.test(line)) fail(`${rel(file)}:${i + 1}: SQL built with interpolation/concatenation: ${line.trim()}`);
  });
}

// 3. Every POST form carries a CSRF token; no inline event handlers
for (const file of walk(path.join(root, 'views'), '.ejs')) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/<form\b[\s\S]*?<\/form>/g)) {
    if (/method\s*=\s*"post"/i.test(m[0]) && !/csrf/.test(m[0])) {
      fail(`${rel(file)}: POST form without CSRF token near: ${m[0].slice(0, 70).replace(/\s+/g, ' ')}`);
    }
  }
  if (/\son[a-z]+\s*=\s*["']/i.test(src)) fail(`${rel(file)}: inline event handler (blocked by CSP)`);
}

// 4. Session cookie flags
const app = fs.readFileSync(path.join(root, 'server', 'app.js'), 'utf8');
if (!/httpOnly:\s*true/.test(app)) fail('server/app.js: session cookie must be httpOnly');
if (!/sameSite:\s*'(strict|lax)'/.test(app)) fail('server/app.js: session cookie needs sameSite strict/lax');
if (!/app\.use\(csrf\)/.test(app)) fail('server/app.js: csrf middleware not mounted');

// 5. Passwords go through bcrypt
const authSvc = fs.readFileSync(path.join(root, 'server', 'services', 'auth.js'), 'utf8');
if (!/bcrypt\.hash\(/.test(authSvc)) fail('services/auth.js: passwords must be hashed with bcrypt');
if (/createHash\(['"](md5|sha1|sha256)['"]\)/.test(authSvc)) fail('services/auth.js: plain hash used for passwords');

if (problems.length) {
  console.error(`Security check FAILED (${problems.length}):\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log('Security check passed.');
