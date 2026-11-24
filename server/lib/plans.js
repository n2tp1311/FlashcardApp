"use strict";

// Plans and pages. A plan is a monthly page allowance for turning books into cards; nothing
// else in the app is limited by it. Free is 150 pages once, never reset. A paid plan resets
// every month on the day it started (the 31st falls back to a short month's last day),
// which is how app-store and RevenueCat subscriptions count, so real billing can take over
// without moving anyone's reset day. Every function takes the database so the rules can be
// tested on an in-memory one.

const PLANS = {
  free:  { name: "Free",   pages: 150,  price: 0,  once: true },
  tier1: { name: "Tier 1", pages: 500,  price: 7 },
  tier2: { name: "Tier 2", pages: 1500, price: 14 },
  tier3: { name: "Tier 3", pages: 3000, price: 24 },
};
const ORDER = ["free", "tier1", "tier2", "tier3"];
// A reservation the worker never commits or refunds (it crashed mid-book) stops counting
// after a day, so lost jobs do not eat a user's allowance.
const RESERVE_TTL = 24 * 3600;

const now = () => Math.floor(Date.now() / 1000);

function addMonths(anchor, n) {
  const a = new Date(anchor * 1000);
  const y = a.getUTCFullYear(), m = a.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Math.floor(Date.UTC(y, m, Math.min(a.getUTCDate(), last),
    a.getUTCHours(), a.getUTCMinutes(), a.getUTCSeconds()) / 1000);
}

function periodBounds(anchor, at) {
  const a = new Date(anchor * 1000), t = new Date(at * 1000);
  let k = (t.getUTCFullYear() - a.getUTCFullYear()) * 12 + t.getUTCMonth() - a.getUTCMonth();
  if (addMonths(anchor, k) > at) k--;
  if (k < 0) k = 0;
  return { start: addMonths(anchor, k), end: addMonths(anchor, k + 1) };
}

function logChange(db, userId, by, from, to, startsAt, expiresAt, note, at) {
  db.prepare("INSERT INTO plan_changes (user_id, by_user_id, from_plan, to_plan, starts_at, expires_at, note, created_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(userId, by || null, from, to, startsAt, expiresAt || null, note || null, at);
}

// The user's plan as of `at`, after applying an expiry or a scheduled downgrade that has
// come due. Those are written back (and logged with no admin) the first time they are seen.
function resolve(db, userId, at = now()) {
  const row = db.prepare("SELECT * FROM user_plans WHERE user_id = ?").get(userId);
  if (!row) return { plan: "free", anchor: null, expiresAt: null, pendingPlan: null, pendingAt: null };
  let p = { plan: row.plan, anchor: row.anchor_at, expiresAt: row.expires_at, pendingPlan: row.pending_plan,
    pendingAt: row.pending_at, pendingExpiresAt: row.pending_expires_at };
  let changed = false;
  for (let i = 0; i < 3; i++) {
    const expiry = p.plan !== "free" && p.expiresAt && p.expiresAt <= at ? p.expiresAt : null;
    const pending = p.pendingPlan && p.pendingAt <= at ? p.pendingAt : null;
    if (expiry === null && pending === null) break;
    const from = p.plan;
    if (pending !== null && (expiry === null || pending <= expiry)) {
      p = { plan: p.pendingPlan, anchor: p.pendingAt, expiresAt: p.pendingExpiresAt, pendingPlan: null, pendingAt: null };
      logChange(db, userId, null, from, p.plan, p.anchor, p.expiresAt, "scheduled", at);
    } else {
      p = { plan: "free", anchor: expiry, expiresAt: null, pendingPlan: null, pendingAt: null };
      logChange(db, userId, null, from, "free", expiry, null, "expired", at);
    }
    changed = true;
  }
  if (changed) {
    db.prepare("UPDATE user_plans SET plan = ?, anchor_at = ?, expires_at = ?, pending_plan = NULL, pending_at = NULL, " +
      "pending_expires_at = NULL, updated_at = ? WHERE user_id = ?").run(p.plan, p.anchor, p.expiresAt || null, at, userId);
  }
  return p;
}

// Free counts every page ever used on Free, so going back to Free does not give 150 more.
// A paid plan counts what was used since this period began.
function usedPages(db, userId, p, at) {
  const live = "(kind = 'adjust' OR status = 'committed' OR (status = 'reserved' AND created_at > ?))";
  const row = p.plan === "free"
    ? db.prepare(`SELECT COALESCE(SUM(pages), 0) AS n FROM page_ledger WHERE user_id = ? AND plan = 'free' AND ${live}`)
        .get(userId, at - RESERVE_TTL)
    : db.prepare(`SELECT COALESCE(SUM(pages), 0) AS n FROM page_ledger WHERE user_id = ? AND created_at >= ? AND ${live}`)
        .get(userId, periodBounds(p.anchor, at).start, at - RESERVE_TTL);
  return row.n;
}

function status(db, userId, at = now()) {
  const p = resolve(db, userId, at);
  const def = PLANS[p.plan] || PLANS.free;
  const used = usedPages(db, userId, p, at);
  const bounds = p.plan === "free" ? null : periodBounds(p.anchor, at);
  return {
    plan: p.plan, name: def.name, limit: def.pages, used,
    remaining: Math.max(0, def.pages - used),
    resetsAt: bounds ? bounds.end : null,
    periodStart: bounds ? bounds.start : null,
    expiresAt: p.expiresAt || null,
    pendingPlan: p.pendingPlan || null, pendingAt: p.pendingAt || null,
  };
}

// An upgrade (or a first paid plan) starts a new period now, so pages used before it do not
// count against the new allowance. A downgrade waits for the current period to end. The
// same plan again only changes its expiry and cancels a scheduled downgrade.
function setPlan(db, userId, plan, { expiresAt = null, note = null, by = null, at = now() } = {}) {
  if (!PLANS[plan]) throw new Error("unknown plan");
  if (expiresAt !== null && expiresAt <= at) throw new Error("expiry in the past");
  const cur = resolve(db, userId, at);
  const rank = (x) => ORDER.indexOf(x);
  const upsert = (fields) => {
    const exists = db.prepare("SELECT 1 FROM user_plans WHERE user_id = ?").get(userId);
    if (exists) {
      db.prepare("UPDATE user_plans SET plan = ?, anchor_at = ?, expires_at = ?, pending_plan = ?, pending_at = ?, " +
        "pending_expires_at = ?, updated_at = ? WHERE user_id = ?").run(fields.plan, fields.anchor, fields.expiresAt,
        fields.pendingPlan, fields.pendingAt, fields.pendingExpiresAt, at, userId);
    } else {
      db.prepare("INSERT INTO user_plans (user_id, plan, anchor_at, expires_at, pending_plan, pending_at, pending_expires_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(userId, fields.plan, fields.anchor, fields.expiresAt,
        fields.pendingPlan, fields.pendingAt, fields.pendingExpiresAt, at);
    }
  };
  const none = { pendingPlan: null, pendingAt: null, pendingExpiresAt: null };
  if (plan === cur.plan) {
    upsert({ plan, anchor: cur.anchor || at, expiresAt: plan === "free" ? null : expiresAt, ...none });
    logChange(db, userId, by, cur.plan, plan, at, expiresAt, note, at);
    return { startsAt: at };
  }
  if (rank(plan) > rank(cur.plan)) {
    upsert({ plan, anchor: at, expiresAt, ...none });
    logChange(db, userId, by, cur.plan, plan, at, expiresAt, note, at);
    return { startsAt: at };
  }
  const startsAt = periodBounds(cur.anchor, at).end;
  upsert({ plan: cur.plan, anchor: cur.anchor, expiresAt: cur.expiresAt || null,
    pendingPlan: plan, pendingAt: startsAt, pendingExpiresAt: plan === "free" ? null : expiresAt });
  logChange(db, userId, by, cur.plan, plan, startsAt, expiresAt, note, at);
  return { startsAt };
}

// delta is from the user's side: negative takes pages, positive gives them back. The
// balance may go below zero (a hand-run pilot can need it); the user then sees 0 left.
function adjust(db, userId, delta, { note = null, by = null, at = now() } = {}) {
  const p = resolve(db, userId, at);
  db.prepare("INSERT INTO page_ledger (user_id, kind, plan, pages, status, note, by_user_id, created_at) " +
    "VALUES (?, 'adjust', ?, ?, 'done', ?, ?, ?)").run(userId, p.plan, -delta, note, by, at);
  return status(db, userId, at);
}

// Reserving is idempotent on jobId: the worker may retry a call whose answer it lost.
function reserve(db, userId, jobId, pages, { title = null, at = now() } = {}) {
  const prior = db.prepare("SELECT user_id, pages, status FROM page_ledger WHERE job_id = ?").get(jobId);
  if (prior) {
    if (prior.user_id !== userId) return { ok: false, code: "job_other_user" };
    return { ok: true, status: prior.status, pages: prior.pages, again: true };
  }
  const s = status(db, userId, at);
  if (pages > s.remaining)
    return { ok: false, code: "not_enough_pages", needed: pages, remaining: s.remaining, resetsAt: s.resetsAt, plan: s.plan };
  db.prepare("INSERT INTO page_ledger (user_id, kind, plan, pages, status, job_id, title, created_at) " +
    "VALUES (?, 'job', ?, ?, 'reserved', ?, ?, ?)").run(userId, s.plan, pages, jobId, title, at);
  return { ok: true, status: "reserved", pages };
}

// A reservation older than a day no longer counts, so committing it would charge pages the
// user was already shown as free again: the worker has to reserve anew.
function settle(db, jobId, to, at = now()) {
  const row = db.prepare("SELECT id, status, created_at FROM page_ledger WHERE job_id = ?").get(jobId);
  if (!row) return { ok: false, code: "unknown_job" };
  if (row.status === to) return { ok: true, status: to, again: true };
  if (row.status !== "reserved") return { ok: false, code: "already_" + row.status };
  if (to === "committed" && row.created_at <= at - RESERVE_TTL) return { ok: false, code: "reservation_expired" };
  db.prepare("UPDATE page_ledger SET status = ?, settled_at = ? WHERE id = ?").run(to, at, row.id);
  return { ok: true, status: to };
}

function history(db, userId, limit = 50) {
  return db.prepare("SELECT kind, pages, status, title, note, created_at, settled_at FROM page_ledger " +
    "WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?").all(userId, limit);
}

module.exports = { PLANS, ORDER, RESERVE_TTL, addMonths, periodBounds, resolve, status, setPlan, adjust, reserve, settle, history };
