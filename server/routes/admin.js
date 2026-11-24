"use strict";

const express = require("express");
const db = require("../db");
const { requireAdmin, isAdmin } = require("../middleware/admin");
const plans = require("../lib/plans");
const accounts = require("../lib/accounts");

const router = express.Router();
router.use(requireAdmin);

const DAY = 86400, WEEK = 7 * DAY;
const now = () => Math.floor(Date.now() / 1000);

// "Active" means answered at least one card in the window; signing in alone does not count.
// Suspended accounts are left out of every count and the chart, so the numbers are of
// accounts that can use the app; the page shows how many are suspended beside them.
const LIVE = "user_id IN (SELECT id FROM users WHERE suspended_at IS NULL)";
function activeSince(t) {
  return db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM attempts WHERE created_at >= ? AND ${LIVE}`).get(t).n;
}

// GET /api/admin/overview: the counts at the top of the page and the 12-week chart.
router.get("/overview", (req, res) => {
  const t = now();
  const utcMidnight = Math.floor(t / DAY) * DAY;
  const created = db.prepare("SELECT created_at FROM users WHERE suspended_at IS NULL").all().map((r) => r.created_at);
  // Week 11 is the seven days up to now, week 0 the seven days ending 77 days ago.
  const act = db.prepare("SELECT CAST((? - created_at) / ? AS INTEGER) AS ago, COUNT(DISTINCT user_id) AS n " +
    `FROM attempts WHERE created_at > ? AND ${LIVE} GROUP BY ago`).all(t, WEEK, t - 12 * WEEK);
  const activeAgo = {};
  act.forEach((r) => { activeAgo[r.ago] = r.n; });
  const weeks = [];
  for (let i = 0; i < 12; i++) {
    const end = t - (11 - i) * WEEK;
    weeks.push({ end, registered: created.filter((c) => c <= end).length, active: activeAgo[11 - i] || 0 });
  }
  const byPlan = {};
  plans.ORDER.forEach((p) => { byPlan[p] = 0; });
  db.prepare("SELECT id FROM users WHERE suspended_at IS NULL").all()
    .forEach((u) => { byPlan[plans.resolve(db, u.id, t).plan]++; });
  res.json({
    registered: created.length,
    suspended: db.prepare("SELECT COUNT(*) AS n FROM users WHERE suspended_at IS NOT NULL").get().n,
    new7: created.filter((c) => c > t - WEEK).length,
    activeToday: activeSince(utcMidnight),
    active7: activeSince(t - WEEK),
    active30: activeSince(t - 30 * DAY),
    weeks, byPlan,
    tiers: plans.ORDER.map((id) => ({ id, ...plans.PLANS[id] })),
  });
});

// GET /api/admin/users?q=&status=all|active|suspended: newest first, at most 200, filtered by
// email. counts are for the filter buttons and ignore q.
router.get("/users", (req, res) => {
  const t = now();
  const q = String(req.query.q || "").trim().toLowerCase().slice(0, 100);
  const like = "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
  const st = ["active", "suspended"].includes(req.query.status) ? req.query.status : "all";
  const rows = db.prepare(
    "SELECT u.id, u.email, u.name, u.created_at, u.suspended_at, u.suspended_by, u.suspended_note, " +
    "(SELECT COALESCE(b.name, b.email) FROM users b WHERE b.id = u.suspended_by) AS suspended_by_name, " +
    "(SELECT MAX(created_at) FROM attempts a WHERE a.user_id = u.id) AS last_at, " +
    "(SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id AND a.created_at >= ?) AS answers30, " +
    "(SELECT COUNT(*) FROM classes c WHERE c.user_id = u.id AND c.archived = 0) AS classes, " +
    "(SELECT COUNT(*) FROM cards k JOIN lessons l ON l.id = k.lesson_id JOIN classes c ON c.id = l.class_id " +
    " WHERE c.user_id = u.id AND c.archived = 0) AS cards " +
    "FROM users u WHERE (? = '' OR u.email LIKE ? ESCAPE '\\') " +
    "AND (? = 'all' OR (? = 'suspended') = (u.suspended_at IS NOT NULL)) ORDER BY u.created_at DESC LIMIT 200"
  ).all(t - 30 * DAY, q, like, st, st);
  const c = db.prepare("SELECT COUNT(*) AS n, COUNT(suspended_at) AS s FROM users").get();
  const counts = { all: c.n, active: c.n - c.s, suspended: c.s };
  const total = counts[st];
  res.json({ total, counts, users: rows.map((r) => ({ ...r, isAdmin: isAdmin(r.id), plan: plans.status(db, r.id, t) })) });
});

function userOr404(req, res) {
  const u = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
  if (!u) res.status(404).json({ error: "Unknown user" });
  return u;
}
const note = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);

// POST /api/admin/users/:id/plan { plan, expiresOn: "YYYY-MM-DD" | null, note }
// The plan ends at 00:00 UTC on expiresOn.
router.post("/users/:id/plan", (req, res) => {
  if (!userOr404(req, res)) return;
  const { plan, expiresOn } = req.body || {};
  if (!plans.PLANS[plan]) return res.status(400).json({ error: "Unknown plan" });
  let expiresAt = null;
  if (expiresOn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return res.status(400).json({ error: "expiresOn must be YYYY-MM-DD" });
    expiresAt = Math.floor(Date.parse(expiresOn + "T00:00:00Z") / 1000);
    if (!(expiresAt > now())) return res.status(400).json({ error: "The end date must be in the future" });
  }
  const r = db.transaction(() => plans.setPlan(db, req.params.id, plan,
    { expiresAt, note: note(req.body.note), by: req.session.userId }))();
  res.json({ startsAt: r.startsAt, plan: plans.status(db, req.params.id) });
});

// POST /api/admin/users/:id/pages { delta, note }: negative takes pages, positive gives.
router.post("/users/:id/pages", (req, res) => {
  if (!userOr404(req, res)) return;
  const delta = req.body && req.body.delta;
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000)
    return res.status(400).json({ error: "delta must be a non-zero whole number" });
  res.json({ plan: plans.adjust(db, req.params.id, delta, { note: note(req.body.note), by: req.session.userId }) });
});

// Suspend, restore, delete. Never on yourself or another admin: an admin is listed in the
// environment, so a suspended one could still be named an admin there, and nobody should be
// able to lock the only admin out from the page.
function target(req, res) {
  const u = userOr404(req, res);
  if (!u) return null;
  if (isAdmin(u.id)) { res.status(400).json({ error: "An admin's account cannot be suspended or deleted", code: "is_admin" }); return null; }
  return u;
}
const CODES = { unknown_user: 404, already_suspended: 409, not_suspended: 409, email_mismatch: 400 };
const answer = (res, r) => (r.ok ? res.json(r) : res.status(CODES[r.code] || 400).json({ error: r.code, code: r.code }));

router.post("/users/:id/suspend", (req, res) => {
  if (!target(req, res)) return;
  answer(res, db.transaction(() => accounts.suspend(db, req.params.id, { by: req.session.userId, note: note(req.body && req.body.note) }))());
});

router.post("/users/:id/restore", (req, res) => {
  if (!target(req, res)) return;
  answer(res, db.transaction(() => accounts.restore(db, req.params.id, { by: req.session.userId, note: note(req.body && req.body.note) }))());
});

// { email, note }: email must be the account's own, typed by the admin.
router.post("/users/:id/delete", (req, res) => {
  if (!target(req, res)) return;
  answer(res, db.transaction(() => accounts.remove(db, req.params.id,
    { email: req.body && req.body.email, by: req.session.userId, note: note(req.body && req.body.note) }))());
});

// GET /api/admin/accounts/log: the last 50 suspends, restores and deletes.
router.get("/accounts/log", (req, res) => {
  res.json({ actions: accounts.actions(db, 50) });
});

module.exports = router;
