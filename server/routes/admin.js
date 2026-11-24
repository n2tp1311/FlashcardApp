"use strict";

const express = require("express");
const db = require("../db");
const { requireAdmin } = require("../middleware/admin");
const plans = require("../lib/plans");

const router = express.Router();
router.use(requireAdmin);

const DAY = 86400, WEEK = 7 * DAY;
const now = () => Math.floor(Date.now() / 1000);

// "Active" means answered at least one card in the window; signing in alone does not count.
function activeSince(t) {
  return db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM attempts WHERE created_at >= ?").get(t).n;
}

// GET /api/admin/overview: the counts at the top of the page and the 12-week chart.
router.get("/overview", (req, res) => {
  const t = now();
  const utcMidnight = Math.floor(t / DAY) * DAY;
  const created = db.prepare("SELECT created_at FROM users").all().map((r) => r.created_at);
  // Week 11 is the seven days up to now, week 0 the seven days ending 77 days ago.
  const act = db.prepare("SELECT CAST((? - created_at) / ? AS INTEGER) AS ago, COUNT(DISTINCT user_id) AS n " +
    "FROM attempts WHERE created_at > ? GROUP BY ago").all(t, WEEK, t - 12 * WEEK);
  const activeAgo = {};
  act.forEach((r) => { activeAgo[r.ago] = r.n; });
  const weeks = [];
  for (let i = 0; i < 12; i++) {
    const end = t - (11 - i) * WEEK;
    weeks.push({ end, registered: created.filter((c) => c <= end).length, active: activeAgo[11 - i] || 0 });
  }
  const byPlan = {};
  plans.ORDER.forEach((p) => { byPlan[p] = 0; });
  db.prepare("SELECT id FROM users").all().forEach((u) => { byPlan[plans.resolve(db, u.id, t).plan]++; });
  res.json({
    registered: created.length,
    new7: created.filter((c) => c > t - WEEK).length,
    activeToday: activeSince(utcMidnight),
    active7: activeSince(t - WEEK),
    active30: activeSince(t - 30 * DAY),
    weeks, byPlan,
    tiers: plans.ORDER.map((id) => ({ id, ...plans.PLANS[id] })),
  });
});

// GET /api/admin/users?q=: newest first, at most 200, filtered by email.
router.get("/users", (req, res) => {
  const t = now();
  const q = String(req.query.q || "").trim().toLowerCase().slice(0, 100);
  const like = "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
  const rows = db.prepare(
    "SELECT u.id, u.email, u.name, u.created_at, " +
    "(SELECT MAX(created_at) FROM attempts a WHERE a.user_id = u.id) AS last_at, " +
    "(SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id AND a.created_at >= ?) AS answers30, " +
    "(SELECT COUNT(*) FROM classes c WHERE c.user_id = u.id AND c.archived = 0) AS classes, " +
    "(SELECT COUNT(*) FROM cards k JOIN lessons l ON l.id = k.lesson_id JOIN classes c ON c.id = l.class_id " +
    " WHERE c.user_id = u.id AND c.archived = 0) AS cards " +
    "FROM users u WHERE (? = '' OR u.email LIKE ? ESCAPE '\\') ORDER BY u.created_at DESC LIMIT 200"
  ).all(t - 30 * DAY, q, like);
  const total = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  res.json({ total, users: rows.map((r) => ({ ...r, plan: plans.status(db, r.id, t) })) });
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

module.exports = router;
