// Errors whose message is safe to show to the user.
class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'UserError';
    this.status = status;
    this.expose = true;
  }
}

// Turn SQLite unique-constraint failures into friendly errors.
function translateDbError(err) {
  if (err && String(err.code || '').startsWith('SQLITE_CONSTRAINT') && /UNIQUE/i.test(err.message)) {
    return new UserError('That name, code, SKU or username is already in use.', 409);
  }
  return err;
}

function toId(value) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0 || String(n) !== String(value).trim()) {
    throw new UserError('Not found.', 404);
  }
  return n;
}

module.exports = { UserError, translateDbError, toId };
