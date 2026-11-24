"use strict";

// Admins are listed by user id in ADMIN_USER_IDS, never by email: a password sign-up does
// not prove it owns its address, so anyone could register an admin's email before they do.
// The list lives in the environment, so no bug that writes to the database can make an
// admin. Anyone else gets a 404, so the admin routes do not show that they exist.
function adminIds() {
  return (process.env.ADMIN_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function isAdmin(userId) {
  return !!userId && adminIds().includes(userId);
}

function requireAdmin(req, res, next) {
  if (!req.session || !isAdmin(req.session.userId)) return res.status(404).json({ error: "Not found" });
  next();
}

module.exports = { isAdmin, requireAdmin };
