"use strict";
// Cloze cards on the server: what a valid one is, and how KnowledgeApp adds and rewords them
// through the sync contract next to the term card they were made from.
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
  INSERT INTO classes (id, user_id, name) VALUES ('k1', 'u1', 'Deep Learning');
  INSERT INTO lessons (id, class_id, title, format) VALUES ('l1', 'k1', '7. Regularization', 'term-def');
  INSERT INTO cards (id, lesson_id, format, data, sort_order, external_id) VALUES
    ('c1', 'l1', 'term-def', '{"term":"Dropout","def":"Randomly disables units to prevent co-adaptation."}', 0, 's:17'),
    ('c2', 'l1', 'term-def', '{"term":"Early stopping","def":"Halts training when validation error stops falling."}', 1, 's:2357');
`);

let base, listener;
test.before(() => new Promise((ok) => { listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); }); }));
test.after(() => listener.close());

async function call(method, url, body, user = "u1") {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-user": user }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

const { validClozeText, clozePlain } = require(path.join(root, "server/lib/cloze.js"));
const GAP1 = "Dropout randomly disables units to prevent {{c1::co-adaptation}}.";
const lessonOrder = () => db.prepare("SELECT id, format, data, external_id FROM cards WHERE lesson_id = 'l1' ORDER BY sort_order").all();

test("a cloze card needs a non-empty c1 gap", function() {
  assert.equal(validClozeText(GAP1), true);
  assert.equal(validClozeText("An {{c1::affine::kind of}} set"), true);
  assert.equal(validClozeText("no gap here"), false);
  assert.equal(validClozeText("only {{c2::second}}"), false);
  assert.equal(validClozeText("empty {{c1::  }}"), false);
  assert.equal(validClozeText(42), false);
  assert.equal(clozePlain("An {{c1::affine::kind}} set holds the {{c2::line}}."), "An affine set holds the line.");
});

test("cards route: creates a valid cloze card and refuses one without a gap", async function() {
  const bad = await call("POST", "/api/lessons/l1/cards", { format: "cloze", data: { text: "no gap" } });
  assert.equal(bad.status, 400);
  const ok = await call("POST", "/api/lessons/l1/cards", { format: "cloze", data: { text: "Early stopping watches {{c1::validation}} error." } });
  assert.equal(ok.status, 201);
  const put = await call("PUT", "/api/cards/" + ok.body.id, { data: { text: "gap removed" } });
  assert.equal(put.status, 400);
  db.prepare("DELETE FROM cards WHERE id = ?").run(ok.body.id);
});

test("split adds cloze cards right after their term card, and a replay adds nothing", async function() {
  const ev = { id: "e1", type: "split", external_id: "s:17", cards: [
    { external_id: "s:17:cz1", cloze: GAP1 },
    { external_id: "s:17:cz2", cloze: "Dropout approximates {{c1::bagging}} over many subnetworks." }
  ] };
  const r = await call("POST", "/api/integrations/knowledge/events", { events: [ev] });
  assert.equal(r.body.results[0].status, "applied");
  const order = lessonOrder();
  assert.deepEqual(order.map(c => c.external_id), ["s:17", "s:17:cz1", "s:17:cz2", "s:2357"]);
  assert.equal(order[1].format, "cloze");
  assert.deepEqual(JSON.parse(order[1].data), { text: GAP1 });
  assert.equal(order[0].format, "term-def", "the term card stays as it was");

  const again = await call("POST", "/api/integrations/knowledge/events", { events: [{ ...ev, id: "e2" }] });
  assert.equal(again.body.results[0].status, "noop");
  assert.equal(lessonOrder().length, 4);
});

test("a cloze item must not carry term or def, and needs a gap", async function() {
  const r = await call("POST", "/api/integrations/knowledge/events", { events: [
    { id: "x1", type: "split", external_id: "s:17", cards: [{ external_id: "s:17:cz9", cloze: GAP1, term: "Dropout" }] },
    { id: "x2", type: "split", external_id: "s:17", cards: [{ external_id: "s:17:cz9", cloze: "no gap" }] },
    { id: "x3", type: "updated", external_id: "s:17:cz1", cloze: "still no gap" }
  ] });
  assert.deepEqual(r.body.results.map(x => x.status), ["invalid", "invalid", "invalid"]);
});

test("updated rewords a cloze card and only a cloze card", async function() {
  const text = "Dropout disables random units to stop {{c1::co-adaptation}} of features.";
  const r = await call("POST", "/api/integrations/knowledge/events", { events: [
    { id: "u1", type: "updated", external_id: "s:17:cz1", cloze: text },
    { id: "u2", type: "updated", external_id: "s:17", cloze: text }
  ] });
  assert.deepEqual(r.body.results.map(x => x.status), ["applied", "noop"]);
  const row = db.prepare("SELECT data, upstream_change FROM cards WHERE external_id = 's:17:cz1'").get();
  assert.equal(JSON.parse(row.data).text, text);
  assert.equal(row.upstream_change, "updated");
  assert.equal(JSON.parse(db.prepare("SELECT data FROM cards WHERE external_id = 's:17'").get().data).term, "Dropout");

  const del = await call("POST", "/api/integrations/knowledge/events", { events: [
    { id: "d1", type: "deleted", external_id: "s:17:cz2" },
    { id: "d2", type: "restored", external_id: "s:17:cz2", cloze: "Dropout approximates {{c1::bagging}} over many subnetworks." }
  ] });
  assert.deepEqual(del.body.results.map(x => x.status), ["applied", "applied"]);
  assert.equal(db.prepare("SELECT upstream_change FROM cards WHERE external_id = 's:17:cz2'").get().upstream_change, null);
});

test("add-cards takes cloze items after a card; the class listing returns them; convert refuses them", async function() {
  const r = await call("POST", "/api/integrations/knowledge/add-cards", { class_id: "k1", cards: [
    { external_id: "s:2357:cz1", cloze: "Early stopping halts training when {{c1::validation}} error stops falling.", after_card_id: "c2" }
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(lessonOrder().at(-1).external_id, "s:2357:cz1");

  const list = await call("GET", "/api/integrations/knowledge/classes/k1/cards");
  const cz = list.body.cards.find(c => c.external_id === "s:2357:cz1");
  assert.equal(cz.format, "cloze");
  assert.match(cz.cloze, /\{\{c1::validation\}\}/);
  assert.equal(cz.term, undefined);

  const id = db.prepare("SELECT id FROM cards WHERE external_id = 's:2357:cz1'").get().id;
  const conv = await call("POST", "/api/integrations/knowledge/convert-cards", { cards: [{ card_id: id, term: "x", def: "y" }] });
  assert.equal(conv.body.results[0].status, "invalid");
});

test("search finds a cloze card by its words", async function() {
  const search = express();
  search.use("/api/search", require(path.join(root, "server/routes/search.js")));
  const l = await new Promise(ok => { const s = search.listen(0, "127.0.0.1", () => ok(s)); });
  try {
    const r = await fetch("http://127.0.0.1:" + l.address().port + "/api/search?q=bagging", { headers: { "x-user": "u1" } });
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.ok(JSON.stringify(body).includes("bagging"));
  } finally { l.close(); }
});

test("layout moves a gap card with its term card into the new lesson", async function() {
  const r = await call("PUT", "/api/integrations/knowledge/classes/k1/layout", { lessons: [
    { title: "7. Regularization", external_ids: ["s:2357", "s:2357:cz1"] },
    { title: "7b. Dropout", external_ids: ["s:17", "s:17:cz1", "s:17:cz2"] }
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.invalid, 0);
  const rows = db.prepare(
    "SELECT ca.external_id, l.title FROM cards ca JOIN lessons l ON l.id = ca.lesson_id WHERE ca.external_id LIKE 's:17%' ORDER BY ca.sort_order"
  ).all();
  assert.deepEqual(rows.map(x => x.external_id), ["s:17", "s:17:cz1", "s:17:cz2"]);
  assert.ok(rows.every(x => x.title === "7b. Dropout"));
});

test("remove-cards deletes the listed cards of that class outright, with their reviews, and leaves no tombstone", async () => {
  db.exec(`
    INSERT INTO classes (id, user_id, name) VALUES ('k9', 'u1', 'Other');
    INSERT INTO lessons (id, class_id, title, format) VALUES ('l9', 'k9', 'Other', 'term-def');
    INSERT INTO cards (id, lesson_id, format, data, sort_order, external_id) VALUES
      ('g1', 'l1', 'cloze', '{"text":"{{c1::Dropout}} disables units."}', 2, 's:17:g1'),
      ('g9', 'l9', 'cloze', '{"text":"{{c1::x}} y."}', 0, 's:99:g1');
  `);
  const post = (body, user = "u1") => fetch(base + "/api/integrations/knowledge/remove-cards", {
    method: "POST", headers: { "Content-Type": "application/json", "x-user": user }, body: JSON.stringify(body) });
  assert.equal((await post({ class_id: "k1", external_ids: [] })).status, 400);
  assert.equal((await post({ class_id: "k1", external_ids: ["s:17:g1"] }, "u2")).status, 404);
  const tombs = db.prepare("SELECT count(*) AS n FROM external_card_deletions").get().n;
  // A card in another class is out of reach even when named.
  const r = await post({ class_id: "k1", external_ids: ["s:17:g1", "s:99:g1", "s:nope"] });
  assert.deepEqual(await r.json(), { removed: 1, not_found: 2 });
  assert.equal(db.prepare("SELECT count(*) AS n FROM cards WHERE id = 'g1'").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM cards WHERE id IN ('g9', 'c1')").get().n, 2);
  assert.equal(db.prepare("SELECT count(*) AS n FROM external_card_deletions").get().n, tombs);
});
