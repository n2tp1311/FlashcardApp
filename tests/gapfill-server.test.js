"use strict";
// Gap-fill passages on the server: what a valid one is, that the cards route takes them, and
// how KnowledgeApp adds, rewords and places them through the sync contract.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const express = require("express");

const root = path.join(__dirname, "..");
const dbFile = path.join(root, "server", "db.js");

const realLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent && parent.filename === dbFile) {
    if (request === "node-sqlite3-wasm") {
      const { Database } = realLoad.call(this, request, parent, isMain);
      return { Database: class extends Database { constructor() { super(); } } };
    }
    if (request === "fs") return { ...fs, rmSync() {}, mkdirSync() {}, existsSync: () => true };
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

db.exec(`
  INSERT INTO users (id, email, name) VALUES ('u1', 'a@x', 'A');
  INSERT INTO classes (id, user_id, name) VALUES ('k1', 'u1', 'Deep Learning');
  INSERT INTO lessons (id, class_id, title, format) VALUES ('l1', 'k1', '7. Regularization', 'term-def');
  INSERT INTO lessons (id, class_id, title, format) VALUES ('l2', 'k1', '8. Optimization', 'term-def');
  INSERT INTO cards (id, lesson_id, format, data, sort_order, external_id) VALUES
    ('t1', 'l2', 'term-def', '{"term":"Momentum","def":"Accumulates past gradients."}', 0, 's:40'),
    ('t2', 'l2', 'term-def', '{"term":"Adam","def":"Adaptive moments."}', 1, 's:41');
`);

let base, listener;
test.before(() => new Promise((ok) => { listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); }); }));
test.after(() => listener.close());

async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-user": "u1" }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

const { validGapfill, gapfillAnswers } = require(path.join(root, "server/lib/cloze.js"));
const TEXT = "Dropout trains an {{c1::ensemble}} by removing {{c2::units}}; it prevents {{c3::co-adaptation}}.";

test("a passage needs 2 to 8 gaps and at most 6 short wrong words", function() {
  assert.deepEqual(gapfillAnswers(TEXT), ["ensemble", "units", "co-adaptation"]);
  assert.equal(validGapfill({ text: TEXT }), true);
  assert.equal(validGapfill({ text: TEXT, title: "Dropout", distractors: ["batch norm", "learning rate"] }), true);
  assert.equal(validGapfill({ text: "Dropout prevents {{c1::co-adaptation}}." }), false, "one gap");
  assert.equal(validGapfill({ text: Array.from({ length: 9 }, (_, i) => `{{c${i + 1}::w${i}}}`).join(" ") }), false, "nine gaps");
  assert.equal(validGapfill({ text: "An {{c1::  }} and {{c2::b}}" }), false, "empty gap");
  assert.equal(validGapfill({ text: TEXT, distractors: "batch norm" }), false);
  assert.equal(validGapfill({ text: TEXT, distractors: ["a", "b", "c", "d", "e", "f", "g"] }), false);
  assert.equal(validGapfill({ text: TEXT, distractors: [" "] }), false);
  assert.equal(validGapfill({ text: TEXT, distractors: ["x".repeat(101)] }), false);
  assert.equal(validGapfill({ text: TEXT, title: 7 }), false);
  assert.equal(validGapfill({ text: TEXT, title: "x".repeat(201) }), false);
  assert.equal(validGapfill(null), false);
});

test("cards route: creates a passage and refuses one with a single gap", async function() {
  const ok = await call("POST", "/api/lessons/l1/cards", { format: "gapfill", data: { text: TEXT, distractors: ["batch norm"] } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const row = db.prepare("SELECT format, data FROM cards WHERE lesson_id = 'l1'").get();
  assert.equal(row.format, "gapfill");
  assert.deepEqual(JSON.parse(row.data).distractors, ["batch norm"]);
  const bad = await call("POST", "/api/lessons/l1/cards", { format: "gapfill", data: { text: "Dropout prevents {{c1::co-adaptation}}." } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /2–8/);
});

const PASSAGE = { title: "Optimization", text: "Momentum accumulates past {{c1::gradients}}; Adam adapts each {{c2::learning rate}}.",
                  distractors: ["dropout", "batch size"] };
const events = (evs) => call("POST", "/api/integrations/knowledge/events", { events: evs });
const ordered = (lesson) => db.prepare("SELECT format, data, external_id FROM cards WHERE lesson_id = ? ORDER BY sort_order").all(lesson);

test("add-cards appends a passage at the end of its lesson; a replay adds nothing", async function() {
  const body = { class_id: "k1", cards: [{ external_id: "s:p1", gapfill: { ...PASSAGE, title: " Optimization " }, lesson_id: "l2" }] };
  const r = await call("POST", "/api/integrations/knowledge/add-cards", body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.added, 1);
  const rows = ordered("l2");
  assert.deepEqual(rows.map(c => c.external_id), ["s:40", "s:41", "s:p1"]);
  assert.equal(rows[2].format, "gapfill");
  assert.deepEqual(JSON.parse(rows[2].data), PASSAGE);
  const again = await call("POST", "/api/integrations/knowledge/add-cards", body);
  assert.equal(again.body.exists, 1);
});

test("a passage item carries nothing else and needs 2 to 8 gaps", async function() {
  const r = await call("POST", "/api/integrations/knowledge/add-cards", { class_id: "k1", cards: [
    { external_id: "s:p9", gapfill: PASSAGE, cloze: "x {{c1::y}}", lesson_id: "l2" }] });
  assert.equal(r.status, 400);
  const bad = await events([
    { id: "b1", type: "updated", external_id: "s:p1", gapfill: { text: "only {{c1::one}} gap" } },
    { id: "b2", type: "split", external_id: "s:40", cards: [{ external_id: "s:40:p", gapfill: PASSAGE, term: "Momentum" }] }
  ]);
  assert.deepEqual(bad.body.results.map(x => x.status), ["invalid", "invalid"]);
});

test("updated replaces a passage whole, flags it, and leaves term cards alone", async function() {
  const next = { text: "Momentum sums past {{c1::gradients}}; Adam scales each {{c2::learning rate}}; RMSProp {{c3::decays}} them." };
  const r = await events([
    { id: "u1", type: "updated", external_id: "s:p1", gapfill: next },
    { id: "u2", type: "updated", external_id: "s:40", gapfill: next },
    { id: "u3", type: "updated", external_id: "s:p1", gapfill: next }
  ]);
  assert.deepEqual(r.body.results.map(x => x.status), ["applied", "noop", "noop"]);
  const row = db.prepare("SELECT data, upstream_change FROM cards WHERE external_id = 's:p1'").get();
  assert.deepEqual(JSON.parse(row.data), next, "the old wrong words and title went with the old text");
  assert.equal(row.upstream_change, "updated");

  const del = await events([
    { id: "d1", type: "deleted", external_id: "s:p1" },
    { id: "d2", type: "restored", external_id: "s:p1", gapfill: next }
  ]);
  assert.deepEqual(del.body.results.map(x => x.status), ["applied", "applied"]);
  assert.equal(db.prepare("SELECT upstream_change FROM cards WHERE external_id = 's:p1'").get().upstream_change, "updated");
});

test("the class listing returns a passage as gapfill; convert refuses it; layout moves it", async function() {
  const list = await call("GET", "/api/integrations/knowledge/classes/k1/cards");
  const p = list.body.cards.find(c => c.external_id === "s:p1");
  assert.equal(p.format, "gapfill");
  assert.match(p.gapfill.text, /\{\{c3::decays\}\}/);
  assert.equal(p.term, undefined);

  const id = db.prepare("SELECT id FROM cards WHERE external_id = 's:p1'").get().id;
  const conv = await call("POST", "/api/integrations/knowledge/convert-cards", { cards: [{ card_id: id, term: "x", def: "y" }] });
  assert.equal(conv.body.results[0].status, "invalid");

  const lay = await call("PUT", "/api/integrations/knowledge/classes/k1/layout", { lessons: [
    { title: "8. Optimization", external_ids: ["s:41", "s:40", "s:p1"] }
  ] });
  assert.equal(lay.status, 200, JSON.stringify(lay.body));
  assert.equal(lay.body.invalid, 0);
  assert.deepEqual(ordered("l2").map(c => c.external_id), ["s:41", "s:40", "s:p1"]);
});
