"use strict";
// Gap-fill passages on the server: what a valid one is, and that the cards route and search
// take them. KnowledgeApp sending them through the sync contract comes with that contract.
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

const server = express();
server.use(express.json());
server.use("/api", require(path.join(root, "server/routes/cards.js")));

db.exec(`
  INSERT INTO users (id, email, name) VALUES ('u1', 'a@x', 'A');
  INSERT INTO classes (id, user_id, name) VALUES ('k1', 'u1', 'Deep Learning');
  INSERT INTO lessons (id, class_id, title, format) VALUES ('l1', 'k1', '7. Regularization', 'term-def');
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
