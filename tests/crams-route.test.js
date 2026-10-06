"use strict";
// The crams routes, run for real: the router is mounted on an Express app whose database is
// an in-memory one with the same prepare shim as server/db.js, and whose session is a header.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const express = require("express");
const { Database } = require("node-sqlite3-wasm");

const root = path.join(__dirname, "..");
const raw = new Database();
const _prepare = raw.prepare.bind(raw);
const db = {
  exec: (sql) => raw.exec(sql),
  prepare(sql) {
    const stmt = _prepare(sql);
    const arg = (a) => (a.length === 0 ? [] : a.length === 1 ? a[0] : a);
    return { run: (...a) => stmt.run(arg(a)), get: (...a) => stmt.get(arg(a)), all: (...a) => stmt.all(arg(a)) };
  }
};
raw.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY);
  CREATE TABLE classes (id TEXT PRIMARY KEY, user_id TEXT);
  CREATE TABLE lessons (id TEXT PRIMARY KEY, class_id TEXT);
  CREATE TABLE cards (id TEXT PRIMARY KEY, lesson_id TEXT);
  CREATE TABLE attempts (id TEXT PRIMARY KEY, card_id TEXT, user_id TEXT, correct INTEGER, created_at INTEGER);
  INSERT INTO users VALUES ('u1'), ('u2');
  INSERT INTO classes VALUES ('k1', 'u1'), ('k2', 'u2');
  INSERT INTO lessons VALUES ('L1', 'k1'), ('L2', 'k1'), ('X1', 'k2');
  INSERT INTO cards VALUES ('a', 'L1'), ('b', 'L1'), ('c', 'L2'), ('x', 'X1');
`);
// The table exactly as server/db.js creates it.
const schema = require("fs").readFileSync(path.join(root, "server/db.js"), "utf8");
raw.exec(schema.match(/CREATE TABLE IF NOT EXISTS crams \([\s\S]*?\n  \)/)[0]);

function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub("server/db.js", db);
stub("server/middleware/auth.js", {
  requireAuth(req, res, next) {
    const u = req.get("x-user");
    if (!u) return res.status(401).json({ error: "Not logged in" });
    req.session = { userId: u };
    next();
  }
});
const app = express();
app.use(express.json());
app.use("/api/crams", require(path.join(root, "server/routes/crams.js")));

let base, server;
test.before(() => new Promise((ok) => { server = app.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + server.address().port; ok(); }); }));
test.after(() => server.close());

async function call(method, url, body, user = "u1") {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-user": user },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}

const tomorrow = () => Math.floor(Date.now() / 1000) + 86400;

test("a cram is created over the user's own lessons, listed, and archived", async () => {
  const made = await call("POST", "/api/crams", { name: " Midterm ", lessonIds: ["L1", "L2"], testAt: tomorrow() });
  assert.equal(made.status, 201);
  assert.equal(made.body.name, "Midterm");
  assert.deepEqual(made.body.lesson_ids, ["L1", "L2"]);
  assert.equal(made.body.rounds, 0);
  const list = await call("GET", "/api/crams");
  assert.deepEqual(list.body.crams.map((c) => c.id), [made.body.id]);
  assert.deepEqual((await call("GET", "/api/crams", undefined, "u2")).body.crams, []);
  await call("PATCH", "/api/crams/" + made.body.id, { archived: true });
  assert.deepEqual((await call("GET", "/api/crams")).body.crams, []);
});

test("bad input and other people's lessons are refused", async () => {
  const t0 = tomorrow();
  assert.equal((await call("POST", "/api/crams", { name: "", lessonIds: ["L1"], testAt: t0 })).status, 400);
  assert.equal((await call("POST", "/api/crams", { name: "T", lessonIds: [], testAt: t0 })).status, 400);
  assert.equal((await call("POST", "/api/crams", { name: "T", lessonIds: ["L1", "L1"], testAt: t0 })).status, 400);
  assert.equal((await call("POST", "/api/crams", { name: "T", lessonIds: ["L1"], testAt: t0 + 400 * 86400 })).status, 400);
  assert.equal((await call("POST", "/api/crams", { name: "T", lessonIds: ["L1"], testAt: "soon" })).status, 400);
  assert.equal((await call("POST", "/api/crams", { name: "T", lessonIds: ["X1"], testAt: t0 })).status, 404);
  const mine = (await call("POST", "/api/crams", { name: "T", lessonIds: ["L1"], testAt: t0 })).body;
  assert.equal((await call("PATCH", "/api/crams/" + mine.id, { lessonIds: ["X1"] })).status, 404);
  assert.equal((await call("PATCH", "/api/crams/" + mine.id, { name: "Hijack" }, "u2")).status, 404);
  assert.equal((await call("GET", "/api/crams/" + mine.id + "/progress", undefined, "u2")).status, 404);
  assert.equal((await call("DELETE", "/api/crams/" + mine.id, undefined, "u2")).status, 404);
  assert.equal((await call("PATCH", "/api/crams/" + mine.id, {})).status, 400);
  assert.equal((await call("PATCH", "/api/crams/" + mine.id, { round: { missed: "a" } })).status, 400);
  assert.equal((await call("DELETE", "/api/crams/" + mine.id)).status, 204);
});

test("a finished round adds one, with its misses; progress counts answers since the cram began", async () => {
  const cram = (await call("POST", "/api/crams", { name: "Final", lessonIds: ["L1", "L2"], testAt: tomorrow() })).body;
  const since = cram.created_at;
  raw.exec(`INSERT INTO attempts VALUES
    ('old', 'a', 'u1', 0, ${since - 100}),
    ('1', 'a', 'u1', 0, ${since}), ('2', 'a', 'u1', 1, ${since + 5}), ('3', 'c', 'u1', 1, ${since + 9}),
    ('4', 'x', 'u1', 1, ${since + 9}), ('5', 'b', 'u2', 1, ${since + 9})`);
  const p = (await call("GET", "/api/crams/" + cram.id + "/progress")).body.cards;
  assert.deepEqual(p, { a: { correct: 1, wrong: 1, last_at: since + 5 }, c: { correct: 1, wrong: 0, last_at: since + 9 } });
  const after = (await call("PATCH", "/api/crams/" + cram.id, { round: { missed: ["a"] } })).body;
  assert.equal(after.rounds, 1);
  assert.deepEqual(after.last_missed, ["a"]);
  assert.ok(after.last_round_at >= since);
  const moved = (await call("PATCH", "/api/crams/" + cram.id, { testAt: tomorrow() + 3600, name: "Final exam" })).body;
  assert.equal(moved.name, "Final exam");
});

test("an unauthenticated request is refused", async () => {
  const r = await fetch(base + "/api/crams");
  assert.equal(r.status, 401);
});
