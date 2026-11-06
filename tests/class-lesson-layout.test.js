"use strict";
// A KnowledgeApp class by chapter or by concept: KnowledgeApp sends both layouts, both are
// stored, and the learner's switch moves the cards at once -- same card ids, so progress stays.
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
  },
  transaction: (fn) => (...a) => {
    raw.exec("BEGIN");
    try { const r = fn(...a); raw.exec("COMMIT"); return r; } catch (e) { raw.exec("ROLLBACK"); throw e; }
  }
};
raw.exec(`
  CREATE TABLE classes (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, archived INTEGER DEFAULT 0, tags TEXT DEFAULT '[]');
  CREATE TABLE lessons (id TEXT PRIMARY KEY, class_id TEXT, title TEXT, format TEXT, sort_order INTEGER DEFAULT 0, created_at INTEGER DEFAULT 0);
  CREATE TABLE cards (id TEXT PRIMARY KEY, lesson_id TEXT, format TEXT, data TEXT DEFAULT '{}', external_id TEXT,
                      sort_order INTEGER DEFAULT 0, created_at INTEGER DEFAULT 0);
  CREATE TABLE class_layouts (class_id TEXT PRIMARY KEY, chapter TEXT NOT NULL, concept TEXT,
                              active TEXT NOT NULL DEFAULT 'chapter', updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
  CREATE TABLE crams (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, lesson_ids TEXT);
  INSERT INTO classes (id, user_id, name) VALUES ('k1', 'u1', 'Deep Learning'), ('k2', 'u1', 'Own');
  INSERT INTO lessons VALUES ('L1', 'k1', 'Ch 1 part 1', 'term-def', 0, 0), ('L2', 'k1', 'Ch 1 part 2', 'term-def', 1, 0);
  INSERT INTO cards (id, lesson_id, format, external_id, sort_order) VALUES
    ('a', 'L1', 'term-def', 's:1', 0), ('b', 'L1', 'term-def', 's:2', 1),
    ('c', 'L2', 'term-def', 's:3', 0), ('d', 'L2', 'term-def', 's:4', 1);
  INSERT INTO crams VALUES ('cr1', 'u1', 'Exam', '["L2"]');
`);

function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub("server/db.js", db);
stub("server/middleware/apiToken.js", { requireApiToken(req, res, next) { req.userId = "u1"; next(); } });
stub("server/middleware/auth.js", { requireAuth(req, res, next) { req.session = { userId: req.get("x-user") || "u1" }; next(); } });
stub("server/services/classifier.js", {});
const app = express();
app.use(express.json());
app.use("/api/integrations/knowledge", require(path.join(root, "server/routes/integrations.js")));
app.use("/api/classes", require(path.join(root, "server/routes/classes.js")));

let base, server;
test.before(() => new Promise((ok) => { server = app.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + server.address().port; ok(); }); }));
test.after(() => server.close());

async function call(method, url, body, user = "u1") {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-user": user },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
}
const CHAPTER = [{ title: "Ch 1 part 1", external_ids: ["s:1", "s:2"] }, { title: "Ch 1 part 2", external_ids: ["s:3", "s:4"] }];
const CONCEPT = [{ title: "Gradient descent", external_ids: ["s:3", "s:1", "s:4"] }, { title: "Momentum", external_ids: ["s:2"] }];
const where = () => Object.fromEntries(raw.all("SELECT c.id, l.title FROM cards c JOIN lessons l ON l.id = c.lesson_id").map((r) => [r.id, r.title]));

test("a sync stores both layouts and still shows the class by chapter", async () => {
  const r = await call("PUT", "/api/integrations/knowledge/classes/k1/layout", { lessons: CHAPTER, concept: CONCEPT });
  assert.equal(r.status, 200);
  assert.equal(r.body.active, "chapter");
  assert.equal(where().a, "Ch 1 part 1");
  const cls = await call("GET", "/api/classes/k1");
  assert.equal(cls.body.lesson_layout, "chapter");
  assert.equal((await call("GET", "/api/classes/k2")).body.lesson_layout, undefined);   // no switch
  // what GET /classes/:id/cards reports to KnowledgeApp as lesson_layout
  assert.deepEqual(require(path.join(root, "server/lib/classLayout.js")).summary("k1"), { active: "chapter", concept: true });
});

test("switching to concept moves the same cards, and a cram follows them", async () => {
  const ids = raw.all("SELECT id FROM cards ORDER BY id").map((r) => r.id).join();
  const r = await call("PUT", "/api/classes/k1/lesson-layout", { layout: "concept" });
  assert.equal(r.status, 200);
  assert.equal(r.body.active, "concept");
  assert.equal(r.body.lessons, 2);
  assert.deepEqual(where(), { a: "Gradient descent", c: "Gradient descent", d: "Gradient descent", b: "Momentum" });
  assert.equal(raw.all("SELECT id FROM cards ORDER BY id").map((r) => r.id).join(), ids);
  const order = raw.all("SELECT id FROM cards WHERE lesson_id = (SELECT lesson_id FROM cards WHERE id = 'c') ORDER BY sort_order");
  assert.equal(order.map((r) => r.id).join(), "c,a,d");
  // the cram named "Ch 1 part 2" (c, d); if that lesson went, it now names where c and d are
  const cram = JSON.parse(raw.get("SELECT lesson_ids FROM crams WHERE id = 'cr1'").lesson_ids);
  const lessonIds = new Set(raw.all("SELECT id FROM lessons WHERE class_id = 'k1'").map((r) => r.id));
  assert.ok(cram.length >= 1 && cram.every((id) => lessonIds.has(id)));
  assert.ok(cram.includes(raw.get("SELECT lesson_id FROM cards WHERE id = 'c'").lesson_id));
});

test("the next sync keeps the learner's pick; one without concept goes back to chapter", async () => {
  let r = await call("PUT", "/api/integrations/knowledge/classes/k1/layout", { lessons: CHAPTER, concept: CONCEPT });
  assert.equal(r.body.active, "concept");
  assert.equal(r.body.moved, 0);
  r = await call("PUT", "/api/integrations/knowledge/classes/k1/layout", { lessons: CHAPTER });
  assert.equal(r.body.active, "chapter");
  assert.equal(where().b, "Ch 1 part 1");
  assert.equal((await call("GET", "/api/classes/k1")).body.lesson_layout, undefined);
  assert.equal((await call("PUT", "/api/classes/k1/lesson-layout", { layout: "concept" })).status, 409);
});

test("bad switches are refused", async () => {
  assert.equal((await call("PUT", "/api/classes/k1/lesson-layout", { layout: "random" })).status, 400);
  assert.equal((await call("PUT", "/api/classes/k1/lesson-layout", { layout: "chapter" }, "u2")).status, 404);
  const bad = await call("PUT", "/api/integrations/knowledge/classes/k1/layout", { lessons: CHAPTER, concept: [{ title: "", external_ids: [] }] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /concept lesson 0/);
});
