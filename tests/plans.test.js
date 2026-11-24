"use strict";
// Plans and pages: the rules in lib/plans.js on an in-memory database with the tables
// exactly as server/db.js makes them, then the admin, plan and worker routes run for real.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const express = require("express");
const { Database } = require("node-sqlite3-wasm");

const root = path.join(__dirname, "..");
const db = new Database();
require(path.join(root, "server/lib/statements")).shimPrepare(db);
db.transaction = (fn) => (...a) => { db.exec("BEGIN"); try { const r = fn(...a); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };
db.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, name TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
  CREATE TABLE classes (id TEXT PRIMARY KEY, user_id TEXT, archived INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE lessons (id TEXT PRIMARY KEY, class_id TEXT);
  CREATE TABLE cards (id TEXT PRIMARY KEY, lesson_id TEXT);
  CREATE TABLE attempts (id TEXT PRIMARY KEY, card_id TEXT, user_id TEXT, created_at INTEGER);
`);
const schema = fs.readFileSync(path.join(root, "server/db.js"), "utf8");
for (const t of ["user_plans", "plan_changes", "page_ledger"])
  db.exec(schema.match(new RegExp("CREATE TABLE IF NOT EXISTS " + t + " \\([\\s\\S]*?\\n  \\)"))[0]);

const plans = require(path.join(root, "server/lib/plans"));
const at = (iso) => Math.floor(Date.parse(iso) / 1000);
let n = 0;
function user() {
  const id = "u" + (++n);
  db.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(id, id + "@example.com", "U " + n, at("2026-01-01T00:00:00Z"));
  return id;
}

test("a period runs from the plan's start day, and the 31st falls back to a short month's end", () => {
  const a = at("2026-01-31T10:00:00Z");
  assert.equal(plans.addMonths(a, 1), at("2026-02-28T10:00:00Z"));
  assert.equal(plans.addMonths(a, 2), at("2026-03-31T10:00:00Z"));
  const b = plans.periodBounds(at("2026-11-17T08:00:00Z"), at("2026-12-20T00:00:00Z"));
  assert.deepEqual(b, { start: at("2026-12-17T08:00:00Z"), end: at("2027-01-17T08:00:00Z") });
  assert.equal(plans.periodBounds(at("2026-11-17T08:00:00Z"), at("2026-12-17T07:59:59Z")).start, at("2026-11-17T08:00:00Z"));
});

test("Free is 150 pages once; a paid plan resets each period", () => {
  const u = user();
  assert.equal(plans.status(db, u).limit, 150);
  plans.adjust(db, u, -100, { at: at("2026-02-01T00:00:00Z") });
  assert.equal(plans.status(db, u, at("2026-09-01T00:00:00Z")).remaining, 50, "Free never resets");
  plans.setPlan(db, u, "tier1", { at: at("2026-03-10T00:00:00Z") });
  assert.equal(plans.status(db, u, at("2026-03-10T00:00:01Z")).remaining, 500, "pages used before an upgrade do not count");
  plans.adjust(db, u, -300, { at: at("2026-03-12T00:00:00Z") });
  const mid = plans.status(db, u, at("2026-03-20T00:00:00Z"));
  assert.equal(mid.remaining, 200);
  assert.equal(mid.resetsAt, at("2026-04-10T00:00:00Z"));
  assert.equal(plans.status(db, u, at("2026-04-10T00:00:00Z")).remaining, 500);
});

test("an expired plan returns to Free, whose earlier use still counts", () => {
  const u = user();
  plans.adjust(db, u, -120, { at: at("2026-02-01T00:00:00Z") });
  plans.setPlan(db, u, "tier2", { expiresAt: at("2026-04-01T00:00:00Z"), by: "admin", at: at("2026-03-01T00:00:00Z") });
  const s = plans.status(db, u, at("2026-04-02T00:00:00Z"));
  assert.equal(s.plan, "free");
  assert.equal(s.remaining, 30);
  const log = db.prepare("SELECT from_plan, to_plan, by_user_id, note FROM plan_changes WHERE user_id = ? ORDER BY id").all(u);
  assert.deepEqual(log.map((r) => [r.from_plan, r.to_plan, r.by_user_id, r.note]),
    [["free", "tier2", "admin", null], ["tier2", "free", null, "expired"]]);
});

test("a downgrade waits for the period to end; choosing the same plan again cancels it", () => {
  const u = user();
  plans.setPlan(db, u, "tier3", { at: at("2026-05-05T00:00:00Z") });
  const r = plans.setPlan(db, u, "tier1", { at: at("2026-05-20T00:00:00Z") });
  assert.equal(r.startsAt, at("2026-06-05T00:00:00Z"));
  assert.equal(plans.status(db, u, at("2026-06-04T00:00:00Z")).plan, "tier3");
  assert.equal(plans.status(db, u, at("2026-06-04T00:00:00Z")).pendingPlan, "tier1");
  assert.equal(plans.status(db, u, at("2026-06-05T00:00:00Z")).plan, "tier1");
  assert.equal(plans.status(db, u, at("2026-06-05T00:00:00Z")).resetsAt, at("2026-07-05T00:00:00Z"));

  const v = user();
  plans.setPlan(db, v, "tier2", { at: at("2026-05-05T00:00:00Z") });
  plans.setPlan(db, v, "free", { at: at("2026-05-06T00:00:00Z") });
  plans.setPlan(db, v, "tier2", { at: at("2026-05-07T00:00:00Z") });
  const s = plans.status(db, v, at("2026-07-01T00:00:00Z"));
  assert.equal(s.plan, "tier2");
  assert.equal(s.resetsAt, at("2026-07-05T00:00:00Z"), "the same plan again keeps the reset day");
});

test("an admin can take more pages than are left; the user sees 0", () => {
  const u = user();
  const s = plans.adjust(db, u, -200, { note: "pilot", by: "admin" });
  assert.equal(s.used, 200);
  assert.equal(s.remaining, 0);
});

test("a job is reserved once, refused when too big, and a forgotten reservation frees itself after a day", () => {
  const u = user();
  plans.setPlan(db, u, "tier1", { at: at("2026-08-01T00:00:00Z") });
  const t0 = at("2026-08-02T00:00:00Z");
  assert.deepEqual(plans.reserve(db, u, "job-a", 300, { at: t0 }), { ok: true, status: "reserved", pages: 300 });
  assert.equal(plans.reserve(db, u, "job-a", 300, { at: t0 }).again, true, "a retried reserve does not charge twice");
  const big = plans.reserve(db, u, "job-b", 420, { at: t0 });
  assert.equal(big.ok, false);
  assert.equal(big.code, "not_enough_pages");
  assert.equal(big.remaining, 200);
  assert.equal(plans.reserve(db, user(), "job-a", 1, { at: t0 }).code, "job_other_user");

  assert.equal(plans.status(db, u, t0 + 3600).remaining, 200);
  assert.equal(plans.status(db, u, t0 + plans.RESERVE_TTL + 1).remaining, 500);
  assert.equal(plans.settle(db, "job-a", "committed", t0 + plans.RESERVE_TTL + 1).code, "reservation_expired");

  plans.reserve(db, u, "job-c", 100, { at: t0 + 10 });
  assert.equal(plans.settle(db, "job-c", "committed", t0 + 20).status, "committed");
  assert.equal(plans.settle(db, "job-c", "committed", t0 + 30).again, true);
  assert.equal(plans.settle(db, "job-c", "refunded", t0 + 40).code, "already_committed");
  assert.equal(plans.status(db, u, t0 + 2 * plans.RESERVE_TTL).remaining, 400, "a committed job keeps counting");

  plans.reserve(db, u, "job-d", 100, { at: t0 + 50 });
  plans.settle(db, "job-d", "refunded", t0 + 60);
  // job-a's 300 still count at this time, job-c's 100 too; job-d's 100 came back.
  assert.equal(plans.status(db, u, t0 + 70).remaining, 100, "a refund gives the pages back");
});

// ── Routes ────────────────────────────────────────────────────────────────────
function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub("server/db.js", db);
stub("server/middleware/auth.js", {
  requireAuth(req, res, next) { if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" }); next(); }
});
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.session = { userId: req.get("x-user") || undefined }; next(); });
app.use("/api/pages", require(path.join(root, "server/routes/pages")));
app.use("/api/plan", require(path.join(root, "server/routes/plan")));
app.use("/api/admin", require(path.join(root, "server/routes/admin")));

let base, server;
test.before(() => new Promise((ok) => { server = app.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + server.address().port; ok(); }); }));
test.after(() => server.close());
async function call(method, url, { user, body, token } = {}) {
  const headers = { "content-type": "application/json" };
  if (user) headers["x-user"] = user;
  if (token) headers.authorization = "Bearer " + token;
  const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

test("admin routes are a 404 to everyone not in ADMIN_USER_IDS", async () => {
  const boss = user(), other = user();
  process.env.ADMIN_USER_IDS = " " + boss + " ,x";
  assert.equal((await call("GET", "/api/admin/overview", { user: other })).status, 404);
  assert.equal((await call("GET", "/api/admin/overview")).status, 404);
  assert.equal((await call("POST", "/api/admin/users/" + other + "/plan", { user: other, body: { plan: "tier3" } })).status, 404);
  assert.equal((await call("GET", "/api/admin/overview", { user: boss })).status, 200);
});

test("the admin sees counts, users with classes and cards, and changes plans and pages", async () => {
  const boss = user(), learner = user();
  process.env.ADMIN_USER_IDS = boss;
  const t = Math.floor(Date.now() / 1000);
  db.exec(`INSERT INTO classes VALUES ('c1', '${learner}', 0), ('c2', '${learner}', 1);
    INSERT INTO lessons VALUES ('l1', 'c1'), ('l2', 'c2');
    INSERT INTO cards VALUES ('k1', 'l1'), ('k2', 'l1'), ('k3', 'l2');
    INSERT INTO attempts VALUES ('a1', 'k1', '${learner}', ${t - 60}), ('a2', 'k1', '${learner}', ${t - 10 * 86400});`);

  const o = (await call("GET", "/api/admin/overview", { user: boss })).body;
  assert.equal(o.active7, 1);
  assert.equal(o.active30, 1);
  assert.equal(o.weeks.length, 12);
  assert.equal(o.weeks[11].active, 1);
  assert.equal(o.weeks[10].active, 1);
  assert.equal(o.weeks[11].registered, o.registered);

  const list = (await call("GET", "/api/admin/users?q=" + learner + "@", { user: boss })).body;
  assert.equal(list.users.length, 1);
  const row = list.users[0];
  assert.deepEqual([row.classes, row.cards, row.answers30, row.last_at], [1, 2, 2, t - 60], "archived classes and their cards are not counted");
  assert.equal((await call("GET", "/api/admin/users?q=%25", { user: boss })).body.users.length, 0, "% in the search is literal");

  const bad = await call("POST", "/api/admin/users/" + learner + "/plan", { user: boss, body: { plan: "tier1", expiresOn: "2020-01-01" } });
  assert.equal(bad.status, 400);
  const set = await call("POST", "/api/admin/users/" + learner + "/plan", { user: boss, body: { plan: "tier2", expiresOn: "2099-01-01", note: " pilot " } });
  assert.equal(set.status, 200);
  assert.equal(set.body.plan.plan, "tier2");
  assert.equal(set.body.plan.expiresAt, at("2099-01-01T00:00:00Z"));
  const log = db.prepare("SELECT by_user_id, note FROM plan_changes WHERE user_id = ? ORDER BY id DESC").get(learner);
  assert.deepEqual([log.by_user_id, log.note], [boss, "pilot"]);

  const pages = await call("POST", "/api/admin/users/" + learner + "/pages", { user: boss, body: { delta: -240, note: "PMP book" } });
  assert.equal(pages.body.plan.remaining, 1260);
  assert.equal((await call("POST", "/api/admin/users/" + learner + "/pages", { user: boss, body: { delta: 1.5 } })).status, 400);

  const mine = (await call("GET", "/api/plan", { user: learner })).body;
  assert.equal(mine.plan, "tier2");
  assert.equal(mine.tiers.length, 4);
  assert.equal(mine.history[0].note, "PMP book");
});

test("the worker routes need PAGES_WORKER_TOKEN and answer 402 when pages run short", async () => {
  const u = user();
  delete process.env.PAGES_WORKER_TOKEN;
  assert.equal((await call("POST", "/api/pages/reserve", { token: "x", body: {} })).status, 404);
  process.env.PAGES_WORKER_TOKEN = "worker-secret";
  assert.equal((await call("POST", "/api/pages/reserve", { token: "wrong", body: {} })).status, 401);
  const job = { jobId: "route-job", userId: u, pages: 100, title: "Ch. 1" };
  assert.equal((await call("POST", "/api/pages/reserve", { token: "worker-secret", body: { ...job, pages: 0 } })).status, 400);
  assert.equal((await call("POST", "/api/pages/reserve", { token: "worker-secret", body: job })).status, 200);
  const short = await call("POST", "/api/pages/reserve", { token: "worker-secret", body: { ...job, jobId: "big", pages: 60 } });
  assert.equal(short.status, 402);
  assert.deepEqual([short.body.needed, short.body.remaining], [60, 50]);
  assert.equal((await call("POST", "/api/pages/commit", { token: "worker-secret", body: { jobId: "route-job" } })).body.status, "committed");
  assert.equal((await call("POST", "/api/pages/refund", { token: "worker-secret", body: { jobId: "nope" } })).status, 404);
});
