const { UserError, translateDbError } = require('./errors');

// Express 4 doesn't catch rejected promises from async handlers.
function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// POST handler: user-facing errors become a flash message + redirect.
// `fn` is responsible for the success redirect.
function action(redirect, fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (e) {
      const err = translateDbError(e);
      if (err instanceof UserError) {
        req.flash('error', err.message);
        return res.redirect(typeof redirect === 'function' ? redirect(req) : redirect);
      }
      next(err);
    }
  };
}

module.exports = { wrap, action };
