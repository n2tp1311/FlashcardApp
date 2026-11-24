"use strict";

// Suspending, restoring and deleting accounts. Suspending is a switch on the users row and
// nothing is removed, so restoring is exact. Deleting is only allowed on a suspended
// account, so it always comes second, after a step that could be undone. Every function
// takes the database so the rules can be tested on an in-memory one.

const now = () => Math.floor(Date.now() / 1000);

function log(db, user, action, by, note, pages, at) {
  db.prepare("INSERT INTO account_actions (user_id, email, action, by_user_id, note, pages, created_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?)").run(user.id, user.email, action, by || null, note || null, pages == null ? null : pages, at);
}

function isSuspended(db, userId) {
  const u = db.prepare("SELECT suspended_at FROM users WHERE id = ?").get(userId);
  return !!(u && u.suspended_at);
}

// Ends every session at once. Session rows hold JSON, and ids are made of [0-9a-z] only,
// so the quoted id cannot match inside another user's row.
function endSessions(db, userId) {
  db.prepare("DELETE FROM sessions WHERE sess LIKE ?").run('%"userId":"' + userId + '"%');
}

function suspend(db, userId, { by = null, note = null, at = now() } = {}) {
  const u = db.prepare("SELECT id, email, suspended_at FROM users WHERE id = ?").get(userId);
  if (!u) return { ok: false, code: "unknown_user" };
  if (u.suspended_at) return { ok: false, code: "already_suspended" };
  db.prepare("UPDATE users SET suspended_at = ?, suspended_by = ?, suspended_note = ? WHERE id = ?").run(at, by, note, userId);
  endSessions(db, userId);
  // A reset link sent before the suspension would otherwise still sign them in.
  db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(userId);
  log(db, u, "suspend", by, note, null, at);
  return { ok: true };
}

function restore(db, userId, { by = null, note = null, at = now() } = {}) {
  const u = db.prepare("SELECT id, email, suspended_at FROM users WHERE id = ?").get(userId);
  if (!u) return { ok: false, code: "unknown_user" };
  if (!u.suspended_at) return { ok: false, code: "not_suspended" };
  db.prepare("UPDATE users SET suspended_at = NULL, suspended_by = NULL, suspended_note = NULL WHERE id = ?").run(userId);
  log(db, u, "restore", by, note, null, at);
  return { ok: true };
}

// The typed email is checked here, not only in the dialog, so no request without it can
// delete. Pages the account used are kept on the log line as one number, so the totals of
// pages used do not drop when an account goes; the ledger rows themselves cascade away.
function remove(db, userId, { email, by = null, note = null, at = now() } = {}) {
  const u = db.prepare("SELECT id, email, suspended_at FROM users WHERE id = ?").get(userId);
  if (!u) return { ok: false, code: "unknown_user" };
  if (!u.suspended_at) return { ok: false, code: "not_suspended" };
  if (String(email || "").trim().toLowerCase() !== u.email.toLowerCase()) return { ok: false, code: "email_mismatch" };
  const pages = db.prepare("SELECT COALESCE(SUM(pages), 0) AS n FROM page_ledger WHERE user_id = ? " +
    "AND (kind = 'adjust' OR status = 'committed')").get(userId).n;
  log(db, u, "delete", by, note, pages, at);
  endSessions(db, userId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  return { ok: true, pages };
}

function actions(db, limit = 50) {
  return db.prepare("SELECT a.user_id, a.email, a.action, a.note, a.pages, a.created_at, a.by_user_id, " +
    "b.email AS by_email, b.name AS by_name, " +
    "(SELECT 1 FROM users x WHERE x.id = a.user_id) IS NULL AS deleted " +
    "FROM account_actions a LEFT JOIN users b ON b.id = a.by_user_id ORDER BY a.created_at DESC, a.id DESC LIMIT ?").all(limit);
}

module.exports = { isSuspended, endSessions, suspend, restore, remove, actions };
