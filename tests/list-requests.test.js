"use strict";
// Home and the class screen in a few requests: each class's lesson count comes with the
// class list and each lesson's card count with the lesson list, and every progress bar on
// a screen comes from one request. They were one request per class or per lesson (two on
// the class screen, one fetching every card just to count them).
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

const server = express();
server.use(express.json());
server.use("/api/classes", require(path.join(root, "server/routes/classes.js")));
server.use("/api", require(path.join(root, "server/routes/lessons.js")));
server.use("/api/stats", require(path.join(root, "server/routes/stats.js")));

db.exec(`
  INSERT INTO users (id, email, name) VALUES ('u1', 'a@x', 'A'), ('u2', 'b@x', 'B');
  INSERT INTO classes (id, user_id, name) VALUES ('k1', 'u1', 'Stats'), ('k2', 'u1', 'Empty'), ('k9', 'u2', 'Not yours');
  INSERT INTO lessons (id, class_id, title, format) VALUES ('l1', 'k1', 'One', 'term-def'), ('l2', 'k1', 'Two', 'term-def'), ('l9', 'k9', 'Theirs', 'term-def');
  INSERT INTO cards (id, lesson_id, format, data) VALUES
    ('c1', 'l1', 'term-def', '{"term":"a","def":"b"}'), ('c2', 'l1', 'term-def', '{"term":"c","def":"d"}'),
    ('c3', 'l2', 'term-def', '{"term":"e","def":"f"}'), ('c9', 'l9', 'term-def', '{"term":"g","def":"h"}');
  INSERT INTO card_states (card_id, user_id, known) VALUES ('c1', 'u1', 1);
`);

let base, listener;
test.before(() => new Promise((ok) => { listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); }); }));
test.after(() => listener.close());

async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-user": "u1" }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

test("the class list carries each class's lesson count", async function() {
  const r = await call("GET", "/api/classes");
  assert.deepEqual(r.body.map(c => [c.id, c.lesson_count]), [["k1", 2], ["k2", 0]]);
});

test("the lesson list carries each lesson's card count", async function() {
  const r = await call("GET", "/api/classes/k1/lessons");
  assert.deepEqual(r.body.map(l => [l.id, l.card_count]), [["l1", 2], ["l2", 1]]);
});

test("one request answers every class's progress, the same as one class at a time, and skips others' classes", async function() {
  const r = await call("POST", "/api/stats/progress/classes", { ids: ["k1", "k2", "k9", "nope"] });
  assert.deepEqual(Object.keys(r.body).sort(), ["k1", "k2"]);
  assert.deepEqual(r.body.k1, (await call("GET", "/api/stats/progress/class/k1")).body);
  assert.equal(r.body.k1.total, 3);
  assert.equal(r.body.k1.known, 1);
  assert.equal(r.body.k2.total, 0);
  assert.equal((await call("POST", "/api/stats/progress/classes", { ids: "k1" })).status, 400);
});

test("one request answers every lesson's progress, the same as one lesson at a time, and skips others' lessons", async function() {
  const r = await call("POST", "/api/stats/progress/lessons", { ids: ["l1", "l2", "l9"] });
  assert.deepEqual(Object.keys(r.body).sort(), ["l1", "l2"]);
  assert.deepEqual(r.body.l1, (await call("GET", "/api/stats/progress/lesson/l1")).body);
  assert.deepEqual([r.body.l1.total, r.body.l1.known, r.body.l2.total], [2, 1, 1]);
  assert.equal((await call("POST", "/api/stats/progress/lessons", { ids: [1] })).status, 400);
});
