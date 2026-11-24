"use strict";
// Suspending, restoring and deleting accounts: lib/accounts.js on an in-memory database with
// the users-side tables as server/db.js makes them (foreign keys on, so a delete cascades as
// it does in production), then the admin, sign-in, token, worker and share routes for real.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const express = require("express");
const bcrypt = require("bcryptjs");
const { Database } = require("node-sqlite3-wasm");

const root = path.join(__dirname, "..");
const db = new Database();
require(path.join(root, "server/lib/statements")).shimPrepare(db);
db.transaction = (fn) => (...a) => { db.exec("BEGIN"); try { const r = fn(...a); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };
db.exec("PRAGMA foreign_keys = ON");
const schema = fs.readFileSync(path.join(root, "server/db.js"), "utf8");
const table = (t) => db.exec(schema.match(new RegExp("CREATE TABLE IF NOT EXISTS " + t + " \\([\\s\\S]*?\\n  \\)"))[0]);
for (const t of ["users", "password_reset_tokens", "classes", "lessons", "cards", "attempts", "class_share_links", "sessions"]) table(t);
for (const t of ["api_tokens", "user_plans", "plan_changes", "page_ledger", "account_actions"])
  db.exec(schema.match(new RegExp("CREATE TABLE IF NOT EXISTS " + t + " \\([\\s\\S]*?\\n  \\)"))[0]);
db.exec("ALTER TABLE users ADD COLUMN preferences TEXT; ALTER TABLE classes ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
for (const m of schema.match(/ALTER TABLE users ADD COLUMN suspended_\w+ \w+/g)) db.exec(m);
db.exec("CREATE TABLE push_subscriptions (id TEXT, user_id TEXT, endpoint TEXT, p256dh TEXT, auth TEXT)");

const accounts = require(path.join(root, "server/lib/accounts"));
const plans = require(path.join(root, "server/lib/plans"));
let n = 0;
function user(password) {
  const id = "acc" + (++n);
  db.prepare("INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)")
    .run(id, id + "@example.com", "User " + n, password ? bcrypt.hashSync(password, 4) : null);
  return id;
}
const session = (sid, userId) => db.prepare("INSERT INTO sessions (sid, sess, expired) VALUES (?, ?, ?)")
  .run(sid, JSON.stringify({ cookie: {}, userId }), 2e9);
function content(u) {
  db.exec(`INSERT INTO classes (id, user_id, name) VALUES ('c-${u}', '${u}', 'Class');
    INSERT INTO lessons (id, class_id, title, format) VALUES ('l-${u}', 'c-${u}', 'L', 'term-def');
    INSERT INTO cards (id, lesson_id, format, data) VALUES ('k-${u}', 'l-${u}', 'term-def', '{}');
    INSERT INTO attempts (id, card_id, user_id, correct, source) VALUES ('a-${u}', 'k-${u}', '${u}', 1, 'quiz');
    INSERT INTO class_share_links (class_id, token) VALUES ('c-${u}', 'tok-${u}');`);
}

test("suspending ends only that user's sessions and reset links, and is logged", () => {
  const u = user(), other = user();
  session("s1", u); session("s2", u); session("s3", other);
  // A longer id that starts with u's must not lose its session.
  db.prepare("INSERT INTO users (id, email, name) VALUES (?, ?, ?)").run(u + "x", u + "x@example.com", "X");
  session("s4", u + "x");
  db.prepare("INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES ('rt', ?, 2e9)").run(u);
  assert.deepEqual(accounts.suspend(db, u, { by: "boss", note: "spam", at: 100 }), { ok: true });
  assert.deepEqual(db.prepare("SELECT sid FROM sessions ORDER BY sid").all().map((r) => r.sid), ["s3", "s4"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM password_reset_tokens WHERE user_id = ?").get(u).n, 0);
  assert.equal(accounts.isSuspended(db, u), true);
  assert.equal(accounts.suspend(db, u).code, "already_suspended");
  const row = db.prepare("SELECT * FROM account_actions WHERE user_id = ?").get(u);
  assert.deepEqual([row.action, row.by_user_id, row.note, row.email, row.created_at], ["suspend", "boss", "spam", u + "@example.com", 100]);
  assert.equal(accounts.restore(db, u, { by: "boss" }).ok, true);
  assert.equal(accounts.isSuspended(db, u), false);
  assert.equal(accounts.restore(db, u).code, "not_suspended");
});

test("delete needs a suspended account and its email typed; it removes everything but one log line", () => {
  const u = user();
  content(u);
  plans.adjust(db, u, -40, { at: 50 });
  plans.reserve(db, u, "job-del", 30, { at: 60 });
  plans.settle(db, "job-del", "committed", 70);
  assert.equal(accounts.remove(db, u, { email: u + "@example.com" }).code, "not_suspended");
  accounts.suspend(db, u, { by: "boss" });
  assert.equal(accounts.remove(db, u, { email: "someone@example.com" }).code, "email_mismatch");
  assert.equal(accounts.remove(db, u, {}).code, "email_mismatch");
  const r = accounts.remove(db, u, { email: " " + u.toUpperCase() + "@EXAMPLE.COM ", by: "boss", note: "asked" });
  assert.deepEqual(r, { ok: true, pages: 70 });
  for (const t of ["users WHERE id", "classes WHERE user_id", "attempts WHERE user_id", "page_ledger WHERE user_id"])
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t} = ?`).get(u).n, 0, t);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cards WHERE id = ?").get("k-" + u).n, 0, "cards cascade through classes");
  const log = accounts.actions(db).filter((a) => a.user_id === u);
  assert.deepEqual(log.map((a) => a.action), ["delete", "suspend"]);
  assert.deepEqual([log[0].email, log[0].pages, log[0].note, log[0].deleted], [u + "@example.com", 70, "asked", 1]);
});

// ── Routes ────────────────────────────────────────────────────────────────────
function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub("server/db.js", db);
stub("server/services/mailer.js", { sendPasswordReset: async () => ({ ok: true }) });
const { sessionGuard } = require(path.join(root, "server/middleware/auth"));
const app = express();
app.use(express.json());
// A session made from x-user, with regenerate as express-session has it.
app.use((req, _res, next) => {
  const mk = (userId) => ({ userId, regenerate(cb) { req.session = mk(undefined); req.regenerated = true; cb(); } });
  req.session = mk(req.get("x-user") || undefined);
  next();
});
app.use(sessionGuard);
app.get("/api/whoami", (req, res) => res.json({ userId: req.session.userId || null }));
app.get("/page", (req, res) => res.json({ userId: req.session.userId || null }));
app.use("/api/auth", require(path.join(root, "server/routes/auth")));
app.use("/api/admin", require(path.join(root, "server/routes/admin")));
app.use("/api/pages", require(path.join(root, "server/routes/pages")));
app.use("/api/share", require(path.join(root, "server/routes/share")));
const { requireApiToken, hashToken } = require(path.join(root, "server/middleware/apiToken"));
app.get("/api/integrations/ping", requireApiToken, (req, res) => res.json({ userId: req.userId }));

let base, server;
test.before(() => new Promise((ok) => { server = app.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + server.address().port; ok(); }); }));
test.after(() => server.close());
async function call(method, url, { user, body, token } = {}) {
  const headers = { "content-type": "application/json" };
  if (user) headers["x-user"] = user;
  if (token) headers.authorization = "Bearer " + token;
  const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  return { status: r.status, body: await r.json().catch(() => null) };
}

test("a suspended user hears so only after the right password, and gets no reset email", async () => {
  const u = user("right-pass");
  accounts.suspend(db, u);
  const email = u + "@example.com";
  const wrong = await call("POST", "/api/auth/login", { body: { email, password: "nope-nope" } });
  assert.deepEqual([wrong.status, wrong.body.code], [401, "invalidCredentials"]);
  const right = await call("POST", "/api/auth/login", { body: { email, password: "right-pass" } });
  assert.deepEqual([right.status, right.body.code], [403, "accountSuspended"]);
  await call("POST", "/api/auth/forgot-password", { body: { email } });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM password_reset_tokens WHERE user_id = ?").get(u).n, 0);
  const taken = await call("POST", "/api/auth/register", { body: { name: "Again", email, password: "another-pass" } });
  assert.equal(taken.body.code, "emailTaken", "a suspended account keeps its email");
});

test("a suspended or deleted user's session ends on its next request", async () => {
  const u = user();
  assert.equal((await call("GET", "/api/whoami", { user: u })).body.userId, u);
  accounts.suspend(db, u);
  const api = await call("GET", "/api/whoami", { user: u });
  assert.deepEqual([api.status, api.body.code], [401, "accountSuspended"]);
  assert.equal((await call("GET", "/page", { user: u })).body.userId, null, "a page loads signed out");
  assert.equal((await call("GET", "/api/whoami", { user: "nobody" })).status, 401);
});

test("API tokens, the page worker and share links stop for a suspended owner and come back on restore", async () => {
  const u = user();
  content(u);
  db.prepare("INSERT INTO api_tokens (id, user_id, name, token_hash, prefix) VALUES ('t1', ?, 'ka', ?, 'fc_')").run(u, hashToken("fc_tok"));
  process.env.PAGES_WORKER_TOKEN = "worker-secret";
  accounts.suspend(db, u);
  const ping = await call("GET", "/api/integrations/ping", { token: "fc_tok" });
  assert.deepEqual([ping.status, ping.body.code], [403, "account_suspended"]);
  const job = await call("POST", "/api/pages/reserve", { token: "worker-secret", body: { jobId: "sus-job", userId: u, pages: 5 } });
  assert.deepEqual([job.status, job.body.code], [403, "account_suspended"]);
  const view = await call("GET", "/api/share/view/tok-" + u);
  assert.deepEqual([view.status, view.body.code], [404, "linkUnavailable"]);
  const clone = await call("POST", "/api/share/clone/tok-" + u, { user: user() });
  assert.equal(clone.body.code, "linkUnavailable");
  assert.equal((await call("GET", "/api/share/view/nope")).body.code, "linkInvalid");

  accounts.restore(db, u);
  assert.equal((await call("GET", "/api/integrations/ping", { token: "fc_tok" })).body.userId, u);
  assert.equal((await call("POST", "/api/pages/reserve", { token: "worker-secret", body: { jobId: "sus-job", userId: u, pages: 5 } })).status, 200);
});

test("reminders skip suspended users", async () => {
  const src = fs.readFileSync(path.join(root, "server/lib/reminders.js"), "utf8");
  assert.match(src, /FROM users u WHERE u\.suspended_at IS NULL/);
});

test("the admin suspends, restores and deletes, but never an admin; counts leave suspended users out", async () => {
  const boss = user(), boss2 = user(), learner = user(), quiet = user();
  process.env.ADMIN_USER_IDS = boss + "," + boss2;
  db.prepare("INSERT INTO attempts (id, card_id, user_id, correct, source) VALUES ('q1', 'x', ?, 1, 'quiz')").run(learner);
  const before = (await call("GET", "/api/admin/overview", { user: boss })).body;

  assert.equal((await call("POST", "/api/admin/users/" + learner + "/suspend", { user: learner })).status, 404, "non-admins get 404");
  assert.equal((await call("POST", "/api/admin/users/" + boss + "/suspend", { user: boss })).body.code, "is_admin");
  assert.equal((await call("POST", "/api/admin/users/" + boss2 + "/suspend", { user: boss })).body.code, "is_admin");
  assert.equal((await call("POST", "/api/admin/users/nobody/suspend", { user: boss })).status, 404);
  const sus = await call("POST", "/api/admin/users/" + learner + "/suspend", { user: boss, body: { note: " spam " } });
  assert.equal(sus.status, 200);
  assert.equal((await call("POST", "/api/admin/users/" + learner + "/suspend", { user: boss })).status, 409);

  const after = (await call("GET", "/api/admin/overview", { user: boss })).body;
  assert.equal(after.registered, before.registered - 1);
  assert.equal(after.suspended, before.suspended + 1);
  assert.equal(after.active7, before.active7 - 1, "a suspended user's answers do not make them active");
  assert.equal(Object.values(after.byPlan).reduce((a, b) => a + b, 0), after.registered);

  const all = (await call("GET", "/api/admin/users", { user: boss })).body;
  assert.equal(all.counts.all, all.counts.active + all.counts.suspended);
  const row = all.users.find((x) => x.id === learner);
  assert.deepEqual([row.suspended_note, row.suspended_by_name, row.isAdmin], ["spam", "User " + boss.slice(3), false]);
  assert.equal(all.users.find((x) => x.id === boss).isAdmin, true);
  const susList = (await call("GET", "/api/admin/users?status=suspended", { user: boss })).body;
  assert.ok(susList.users.every((x) => x.suspended_at) && susList.users.some((x) => x.id === learner));
  assert.equal(susList.total, all.counts.suspended);
  const live = (await call("GET", "/api/admin/users?status=active", { user: boss })).body;
  assert.ok(live.users.every((x) => !x.suspended_at) && live.users.some((x) => x.id === quiet));

  assert.equal((await call("POST", "/api/admin/users/" + quiet + "/delete", { user: boss, body: { email: quiet + "@example.com" } })).body.code,
    "not_suspended", "only a suspended account can be deleted");
  const typo = await call("POST", "/api/admin/users/" + learner + "/delete", { user: boss, body: { email: "wrong@example.com" } });
  assert.deepEqual([typo.status, typo.body.code], [400, "email_mismatch"]);
  const del = await call("POST", "/api/admin/users/" + learner + "/delete", { user: boss, body: { email: learner + "@example.com", note: "asked" } });
  assert.equal(del.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(learner).n, 0);

  const log = (await call("GET", "/api/admin/accounts/log", { user: boss })).body.actions.filter((a) => a.user_id === learner);
  assert.deepEqual(log.map((a) => [a.action, a.by_user_id, a.deleted]), [["delete", boss, 1], ["suspend", boss, 1]]);
  assert.equal(log[0].by_name, "User " + boss.slice(3));

  const again = await call("POST", "/api/auth/register", { body: { name: "New", email: learner + "@example.com", password: "fresh-pass" } });
  assert.equal(again.status, 200, "a deleted account's email can be registered again");
});
