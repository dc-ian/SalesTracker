const crypto = require('crypto');
const { UserError } = require('../lib/errors');

// Synchronizer-token CSRF protection. Every POST form includes partials/csrf.ejs.
// Defence in depth: if the browser sends an Origin header it must match our Host.
// Same-origin requests that arrive with the opaque "null" Origin (e.g. because of
// Referrer-Policy: no-referrer from helmet) are allowed unless the browser itself
// says the request is cross-site. The _csrf token check below is the main protection.
module.exports = function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrf;

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const origin = req.headers.origin;
  const fetchSite = req.headers['sec-fetch-site'];

  if (origin && origin !== 'null') {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(origin).host === req.headers.host;
    } catch (e) {
      sameOrigin = false;
    }
    if (!sameOrigin) {
      console.warn('CSRF blocked: origin mismatch', {
        method: req.method,
        url: req.url,
        origin,
        host: req.headers.host,
      });
      return next(new UserError('Cross-site request blocked.', 403));
    }
  } else if (origin === 'null' && fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
    console.warn('CSRF blocked: null origin, sec-fetch-site =', fetchSite, req.method, req.url);
    return next(new UserError('Cross-site request blocked.', 403));
  }

  const sent = String((req.body && req.body._csrf) || '');
  const expected = req.session.csrf;
  const ok =
    sent.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!ok) return next(new UserError('This form expired. Reload the page and try again.', 403));
  next();
};