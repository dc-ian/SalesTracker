// Phase 6 — HTTP hardening for the local server.

// DNS-rebinding defence: only answer requests addressed to the loopback host.
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function hostGuard(req, res, next) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return res.status(400).type('text/plain').send('Bad host header');
  next();
}

// No inline scripts or styles are used anywhere, so the policy can be strict.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
}

// Dynamic pages contain business data: never let them be cached.
function noStore(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

module.exports = { hostGuard, securityHeaders, noStore };
