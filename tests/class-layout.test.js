"use strict";
// PUT /classes/:id/layout, run for real against an in-memory database: KnowledgeApp
// re-files a book's cards, and FlashcardApp moves them -- same card ids, so history stays.
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
  CREATE TABLE classes (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, archived INTEGER DEFAULT 0);
  CREATE TABLE lessons (id TEXT PRIMARY KEY, class_id TEXT, title TEXT, format TEXT, sort_order INTEGER DEFAULT 0, created_at INTEGER DEFAULT 0);
  CREATE TABLE cards (id TEXT PRIMARY KEY, lesson_id TEXT, format TEXT, data TEXT DEFAULT '{}', external_id TEXT,
                      sort_order INTEGER DEFAULT 0, created_at INTEGER DEFAULT 0);
  INSERT INTO classes (id, user_id, name) VALUES ('k1', 'u1', 'Stats'), ('k2', 'u2', 'Other');
  INSERT INTO lessons VALUES ('Ldiag', 'k1', 'Diagnostic', 'term-def', 0, 0), ('Lt1', 'k1', 'Graphs', 'term-def', 1, 0),
                             ('Lt2', 'k1', 'Spread', 'term-def', 2, 0), ('Lmine', 'k1', 'My notes', 'term-def', 3, 0),
                             ('Lempty', 'k1', 'Empty', 'term-def', 4, 0), ('X', 'k2', 'X', 'term-def', 0, 0);
  INSERT INTO cards (id, lesson_id, format, external_id, sort_order) VALUES
    ('d1', 'Ldiag', 'term-def', 's:1', 0), ('d2', 'Ldiag', 'term-def', 's:2', 1),
    ('g1', 'Lt1', 'term-def', 's:3', 0), ('g2', 'Lt1', 'term-def', 's:4', 1),
    ('p1', 'Lt2', 'term-def', 's:5', 0),
    ('m1', 'Lmine', 'term-def', NULL, 0),
    ('x1', 'X', 'term-def', 's:9', 0);
`);

function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub("server/db.js", db);
stub("server/middleware/apiToken.js", { requireApiToken(req, res, next) { req.userId = req.get("x-user"); next(); } });
const app = express();
app.use(express.json());
app.use("/api/integrations/knowledge", require(path.join(root, "server/routes/integrations.js")));

let base, server;
test.before(() => new Promise((ok) => { server = app.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + server.address().port; ok(); }); }));
test.after(() => server.close());

async function put(id, body, user = "u1") {
  const r = await fetch(base + "/api/integrations/knowledge/classes/" + id + "/layout",
    { method: "PUT", headers: { "content-type": "application/json", "x-user": user }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

test("cards move into the new lessons by id; emptied lessons go, the learner's stay", async () => {
  const r = await put("k1", { lessons: [
    { title: "1. Graphs", external_ids: ["s:3", "s:1", "s:4"] },
    { title: "Spread", external_ids: ["s:5", "s:2", "s:404", "s:9"] },
  ] });
  assert.equal(r.status, 200);
  assert.equal(r.body.moved, 3);           // d1, d2 move in; g2 shifts down a place
  assert.equal(r.body.not_found, 2);       // unknown, and another user's card
  assert.equal(r.body.renamed, 1);
  assert.equal(r.body.created, 0);
  assert.equal(r.body.removed, 1);         // Diagnostic, emptied

  const lessons = raw.all("SELECT id, title, sort_order FROM lessons WHERE class_id = 'k1' ORDER BY sort_order");
  assert.equal(JSON.stringify(lessons.map((l) => [l.id, l.title])),
    JSON.stringify([["Lt1", "1. Graphs"], ["Lt2", "Spread"], ["Lmine", "My notes"], ["Lempty", "Empty"]]));
  const cards = raw.all("SELECT id, lesson_id, sort_order FROM cards WHERE lesson_id IN ('Lt1','Lt2') ORDER BY lesson_id, sort_order");
  assert.equal(cards.map((c) => c.id).join(","), "g1,d1,g2,p1,d2");
  assert.equal(raw.get("SELECT lesson_id FROM cards WHERE id = 'x1'").lesson_id, "X");
  assert.equal(raw.get("SELECT lesson_id FROM cards WHERE id = 'm1'").lesson_id, "Lmine");
});

test("a lesson with no existing home is created, and a repeat is a no-op", async () => {
  const layout = { lessons: [
    { title: "1. Graphs", external_ids: ["s:3", "s:1"] },
    { title: "2. Spread", external_ids: ["s:5", "s:2"] },
    { title: "3. Review", external_ids: ["s:4"] },
  ] };
  const first = await put("k1", layout);
  assert.equal(first.body.created, 1);
  const again = await put("k1", layout);
  assert.equal(again.body.moved, 0);
  assert.equal(again.body.unchanged, 5);
  assert.equal(again.body.created + again.body.renamed + again.body.removed, 0);
});

test("bad bodies and other users' classes are refused", async () => {
  assert.equal((await put("k1", { lessons: [] })).status, 400);
  assert.equal((await put("k1", { lessons: [{ title: "", external_ids: [] }] })).status, 400);
  assert.equal((await put("k1", { lessons: [{ title: "a", external_ids: ["s:1"] }, { title: "b", external_ids: ["s:1"] }] })).status, 400);
  assert.equal((await put("k1", { lessons: [{ title: "a", external_ids: ["s:1"] }] }, "u2")).status, 404);
});
