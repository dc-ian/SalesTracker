// One-shot messages stored in the session, shown on the next page.
module.exports = function flash(req, res, next) {
  req.flash = (type, msg) => {
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ type, msg });
  };
  res.locals.flash = [];
  // Background JSON polling must not swallow messages meant for the next page.
  if (!req.path.startsWith('/api/')) {
    res.locals.flash = req.session.flash || [];
    if (req.session.flash) delete req.session.flash;
  }
  next();
};
