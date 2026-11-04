"use strict";
// A `deleted` event with `merged_into`: KnowledgeApp merged two units, so where both cards
// are in one class the merged-away card goes and its progress moves over when it is ahead.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const express = require("express");

const root = path.join(__dirname, "..");
const dbFile = path.join(root, "server", "db.js");

// The real schema and migrations, in memory: db.js opens data/flashcards.db and clears its
// lock, which must not touch a running dev server's database.
const realLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent && parent.filename === dbFile) {
    if (request === "node-sqlite3-wasm") {
      const { Database } = realLoad.call(this, request, parent, isMain);
      return { Database: class extends Database { constructor() { super(); } } };
    }
    if (request === "fs") return { ...fs, rmSync() {}, mkdirSync() {}, existsSync: () => true };
    if (request === "./lib/dbLock") return { claim() {}, hold() { return function() {}; } };
  }
  return realLoad.call(this, request, parent, isMain);
};
const db = require(dbFile);
Module._load = realLoad;

function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub("server/middleware/auth.js", {
  requireAuth(req, res, next) { req.session = { userId: req.get("x-user") }; next(); }
});
stub("server/middleware/apiToken.js", {
  requireApiToken(req, res, next) { req.userId = req.get("x-user"); next(); },
  hashToken: (t) => t
});

const server = express();
server.use(express.json());
server.use("/api/integrations/knowledge", require(path.join(root, "server/routes/integrations.js")));
server.use("/api", require(path.join(root, "server/routes/cards.js")));
server.use("/api/attempts", require(path.join(root, "server/routes/attempts.js")));

db.exec(`
  INSERT INTO users (id, email, name) VALUES ('u1', 'a@x', 'A');
  INSERT INTO classes (id, user_id, name) VALUES ('k1', 'u1', 'Deep Learning'), ('k2', 'u1', 'Other');
  INSERT INTO lessons (id, class_id, title, format) VALUES
    ('l1', 'k1', '5. Basics', 'term-def'), ('l2', 'k1', '6. More', 'term-def'), ('l3', 'k2', 'A', 'term-def');
  INSERT INTO cards (id, lesson_id, format, data, sort_order, external_id) VALUES
    ('lose1', 'l1', 'term-def', '{"term":"Unsupervised learning","def":"a"}', 0, 's:2063'),
    ('keep1', 'l2', 'term-def', '{"term":"Unsupervised Learning","def":"b"}', 0, 's:2086'),
    ('lose2', 'l1', 'term-def', '{"term":"Dropout","def":"a"}', 1, 's:10'),
    ('keep2', 'l1', 'term-def', '{"term":"Dropout","def":"b"}', 2, 's:11'),
    ('lose3', 'l1', 'term-def', '{"term":"Bias","def":"a"}', 3, 's:20'),
    ('keep3', 'l1', 'term-def', '{"term":"Bias","def":"b"}', 4, 's:21'),
    ('alone', 'l3', 'term-def', '{"term":"Lonely","def":"a"}', 0, 's:30');
  INSERT INTO card_states (card_id, user_id, known, fsrs_reps, fsrs_last_review_at) VALUES
    ('lose2', 'u1', 1, 5, 100), ('keep2', 'u1', 0, 1, 200),
    ('lose3', 'u1', 1, 2, 100), ('keep3', 'u1', 1, 2, 300);
  INSERT INTO attempts (id, card_id, user_id, correct, source) VALUES ('a1', 'lose2', 'u1', 1, 'quiz');
`);

let base, listener;
test.before(() => new Promise((ok) => { listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); }); }));
test.after(() => listener.close());

async function events(list) {
  const r = await fetch(base + "/api/integrations/knowledge/events", {
    method: "POST", headers: { "content-type": "application/json", "x-user": "u1" }, body: JSON.stringify({ events: list }) });
  return { status: r.status, body: await r.json() };
}
const card = id => db.prepare("SELECT id, upstream_change FROM cards WHERE id = ?").get(id);
const state = id => db.prepare("SELECT fsrs_reps, fsrs_last_review_at FROM card_states WHERE card_id = ? AND user_id = 'u1'").get(id);

test("a merged card is removed when the survivor's card is in the same class", async function() {
  const r = await events([{ id: "e1", type: "deleted", external_id: "s:2063", merged_into: "s:2086" }]);
  assert.equal(r.body.results[0].status, "applied");
  assert.ok(!card("lose1"));
  assert.ok(card("keep1"));
  const again = await events([{ id: "e1", type: "deleted", external_id: "s:2063", merged_into: "s:2086" }]);
  assert.equal(again.body.results[0].status, "not_found");
});

test("progress ahead on the merged card moves to the survivor; attempts stay", async function() {
  await events([{ id: "e2", type: "deleted", external_id: "s:10", merged_into: "s:11" }]);
  assert.ok(!card("lose2"));
  assert.deepEqual({ ...state("keep2") }, { fsrs_reps: 5, fsrs_last_review_at: 100 });
  assert.equal(db.prepare("SELECT card_id FROM attempts WHERE id = 'a1'").get().card_id, "lose2");
});

test("on a tie in reviews the later review wins, and the survivor keeps its own", async function() {
  await events([{ id: "e3", type: "deleted", external_id: "s:20", merged_into: "s:21" }]);
  assert.ok(!card("lose3"));
  assert.deepEqual({ ...state("keep3") }, { fsrs_reps: 2, fsrs_last_review_at: 300 });
  assert.ok(!state("lose3"));
});

test("with no survivor card in the class, the card is only flagged, as before", async function() {
  const r = await events([{ id: "e4", type: "deleted", external_id: "s:30", merged_into: "s:2086" }]);
  assert.equal(r.body.results[0].status, "applied");
  assert.equal(card("alone").upstream_change, "deleted");
});

test("merged_into is refused on other events and when it names the same unit", async function() {
  const r = await events([
    { id: "e5", type: "updated", external_id: "s:11", term: "x", def: "y", merged_into: "s:21" },
    { id: "e6", type: "deleted", external_id: "s:11", merged_into: "s:11" }]);
  assert.deepEqual(r.body.results.map(x => x.status), ["invalid", "invalid"]);
  assert.ok(card("keep2"));
});
