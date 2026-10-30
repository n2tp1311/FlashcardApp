"use strict";
// "Move to…" in the card Select bar: the route run for real on an in-memory database, and the
// client wiring. Moving keeps review state, refuses KnowledgeApp cards and other formats, and
// drops a passage that came from the old class's book.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { Database } = require("node-sqlite3-wasm");

const root = path.join(__dirname, "..");
const raw = new Database();
const _prepare = raw.prepare.bind(raw);
const db = {
  exec: (sql) => raw.exec(sql),
  transaction: (fn) => () => { raw.exec("BEGIN"); try { fn(); raw.exec("COMMIT"); } catch (e) { raw.exec("ROLLBACK"); throw e; } },
  prepare(sql) {
    const stmt = _prepare(sql);
    const arg = (a) => (a.length === 0 ? [] : a.length === 1 ? a[0] : a);
    return { run: (...a) => stmt.run(arg(a)), get: (...a) => stmt.get(arg(a)), all: (...a) => stmt.all(arg(a)) };
  }
};
raw.exec(`
  CREATE TABLE classes (id TEXT PRIMARY KEY, user_id TEXT);
  CREATE TABLE lessons (id TEXT PRIMARY KEY, class_id TEXT, format TEXT);
  CREATE TABLE cards (id TEXT PRIMARY KEY, lesson_id TEXT, external_id TEXT, sort_order INTEGER DEFAULT 0,
    source TEXT, source_verdict TEXT, source_rejected TEXT, source_note TEXT, source_before TEXT,
    source_after TEXT, source_related TEXT);
  CREATE TABLE card_states (card_id TEXT, user_id TEXT, srs_due_at INTEGER);
  INSERT INTO classes VALUES ('bets', 'u1'), ('signal', 'u1'), ('theirs', 'u2');
  INSERT INTO lessons VALUES ('b4', 'bets', 'term-def'), ('b5', 'bets', 'term-def'),
    ('s8', 'signal', 'term-def'), ('sq', 'signal', 'mcq'), ('t1', 'theirs', 'term-def');
  INSERT INTO cards (id, lesson_id, external_id, sort_order, source, source_verdict, source_before) VALUES
    ('voul', 'b4', NULL, 0, 'A Thinking in Bets passage.', 'good', 'Before.'),
    ('kept', 'b4', NULL, 1, 'Stays with its book.', NULL, NULL),
    ('ka', 'b4', 'u:7', 2, 'KA passage.', NULL, NULL),
    ('s1', 's8', NULL, 4, NULL, NULL, NULL);
  INSERT INTO card_states VALUES ('voul', 'u1', 12345);
`);

function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub("server/db.js", db);
stub("server/middleware/auth.js", {
  requireAuth(req, res, next) { req.session = { userId: req.get("x-user") }; next(); }
});
stub("server/middleware/apiToken.js", {
  requireApiToken(req, res, next) { req.userId = req.get("x-user"); next(); },
  hashToken: (t) => t
});
const app = express();
app.use(express.json());
app.use("/api/integrations/knowledge", require(path.join(root, "server/routes/integrations.js")));
app.use("/api", require(path.join(root, "server/routes/cards.js")));

let base, server;
test.before(() => new Promise((ok) => { server = app.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + server.address().port; ok(); }); }));
test.after(() => server.close());

async function move(body, user = "u1") {
  const r = await fetch(base + "/api/cards/move", { method: "POST",
    headers: { "content-type": "application/json", "x-user": user }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
const card = (id) => db.prepare("SELECT lesson_id, sort_order, source, source_verdict, source_before FROM cards WHERE id = ?").get(id);

test("a card moves to another class's lesson with its review state, after the cards there, without its old passage", async () => {
  const r = await move({ card_ids: ["voul", "ka"], lesson_id: "s8" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { moved: 1, linked: 1, format: 0, not_found: 0 });
  assert.deepEqual(card("voul"), { lesson_id: "s8", sort_order: 5, source: null, source_verdict: null, source_before: null });
  assert.equal(db.prepare("SELECT srs_due_at FROM card_states WHERE card_id = 'voul'").get().srs_due_at, 12345);
  assert.equal(card("ka").lesson_id, "b4", "a KnowledgeApp card stays where it was put");
});

test("within a class the passage stays; other formats, other users' cards and lessons are refused", async () => {
  assert.deepEqual((await move({ card_ids: ["kept"], lesson_id: "b5" })).body, { moved: 1, linked: 0, format: 0, not_found: 0 });
  assert.equal(card("kept").source, "Stays with its book.");
  assert.deepEqual((await move({ card_ids: ["kept"], lesson_id: "sq" })).body, { moved: 0, linked: 0, format: 1, not_found: 0 });
  assert.equal((await move({ card_ids: ["kept"], lesson_id: "t1" })).status, 404);
  assert.deepEqual((await move({ card_ids: ["kept"], lesson_id: "s8" }, "u2")).status, 404);
  assert.deepEqual((await move({ card_ids: ["s1"], lesson_id: "b5" }, "u2")).status, 404);
  assert.equal((await move({ card_ids: [], lesson_id: "b5" })).status, 400);
  assert.equal((await move({ card_ids: [7], lesson_id: "b5" })).status, 400);
  assert.equal((await move({ card_ids: ["kept"] })).status, 400);
});

test("KnowledgeApp's token moves the same cards under the same rules, and only its user's", async () => {
  raw.exec("INSERT INTO cards (id, lesson_id, external_id, sort_order, source) VALUES ('tok', 'b4', NULL, 9, 'Old book.'), ('tka', 'b4', 'u:9', 10, NULL)");
  const send = async (body, user = "u1") => {
    const r = await fetch(base + "/api/integrations/knowledge/move-cards", { method: "POST",
      headers: { "content-type": "application/json", "x-user": user }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  assert.equal((await send({ card_ids: ["tok"], lesson_id: "s8" }, "u2")).status, 404);
  assert.deepEqual((await send({ card_ids: ["tok", "tka"], lesson_id: "s8" })).body, { moved: 1, linked: 1, format: 0, not_found: 0 });
  assert.equal(card("tok").lesson_id, "s8");
  assert.equal(card("tok").source, null);
  assert.equal(card("tka").lesson_id, "b4");
  assert.equal((await send({ card_ids: "tok", lesson_id: "s8" })).status, 400);
});

test("the Select bar offers Move to… only where the store can move, and the dialog is wired", () => {
  const appJs = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
  assert.match(appJs, /typeof store\.moveCards === "function"\s*\?\s*'<button class="btn btn-sm btn-primary" id="btn-move-selected-cards" disabled>'/);
  assert.match(appJs, /moveCards: function\(ids, lessonId\)\s*\{ return req\("POST", "\/cards\/move", \{ card_ids: ids, lesson_id: lessonId \}\); \}/);
  assert.match(appJs, /l\.format === from\.format && l\.id !== from\.id/);
  assert.match(appJs, /moveBtn\.disabled = n === 0/);
  assert.match(html, /id="modal-move"[\s\S]*id="move-class"[\s\S]*id="move-lesson"[\s\S]*id="btn-move-cards"/);
  // names from the model or the learner go through escHtml before innerHTML
  assert.match(appJs, /escHtml\(l\.title\)/);
  assert.match(appJs, /escHtml\(c\.name\)/);
});
