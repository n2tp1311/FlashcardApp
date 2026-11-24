"use strict";

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

// Suspending deletes the user's session rows, but a request already in flight can write its
// session back after that. Checking the account on every signed-in request closes the gap,
// and also signs out a session whose account was deleted. One primary-key read per request.
function sessionGuard(req, res, next) {
  const id = req.session && req.session.userId;
  if (!id) return next();
  const db = require("../db");
  const u = db.prepare("SELECT suspended_at FROM users WHERE id = ?").get(id);
  if (u && !u.suspended_at) return next();
  // regenerate, not destroy: it leaves an empty session behind, so the page routes that read
  // req.session.userId see a signed-out visitor instead of crashing on a missing session.
  req.session.regenerate(() => {
    if (req.path.startsWith("/api/"))
      return res.status(401).json({ error: "Not authenticated", code: u ? "accountSuspended" : undefined });
    next();
  });
}

module.exports = { requireAuth, sessionGuard };
