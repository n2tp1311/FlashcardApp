"use strict";
// Review screen: "Delete removed cards" deletes, in one request, the cards KnowledgeApp removed.
// Only cards still flagged 'deleted' and owned by the caller go; each leaves a deletion record
// so KnowledgeApp learns the learner dropped it.
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
    if (request === "./lib/dbLock") return { claim() {}, hold() { return function() {}; } };
  }
  return realLoad.call(this, request, parent, isMain);
};
const db = require(dbFile);
Module._load = realLoad;

const auth = require.resolve(path.join(root, "server/middleware/auth.js"));
require.cache[auth] = { id: auth, filename: auth, loaded: true,
  exports: { requireAuth(req, res, next) { req.session = { userId: req.get("x-user") }; next(); } } };

const server = express();
server.use(express.json());
server.use("/api", require(path.join(root, "server/routes/cards.js")));

db.exec(`
  INSERT INTO users (id, email, name) VALUES ('dr1', 'dr1@x', 'A'), ('dr2', 'dr2@x', 'B');
  INSERT INTO classes (id, user_id, name) VALUES ('drk1', 'dr1', 'ESL'), ('drk2', 'dr2', 'Other');
  INSERT INTO lessons (id, class_id, title, format) VALUES ('drl1', 'drk1', 'L', 'term-def'), ('drl2', 'drk2', 'L', 'term-def');
  INSERT INTO cards (id, lesson_id, format, data, sort_order, external_id, upstream_change) VALUES
    ('gone1', 'drl1', 'term-def', '{"term":"a","def":"a"}', 0, 's:1', 'deleted'),
    ('gone2', 'drl1', 'term-def', '{"term":"b","def":"b"}', 1, 's:2', 'deleted'),
    ('upd', 'drl1', 'term-def', '{"term":"c","def":"c"}', 2, 's:3', 'updated'),
    ('other', 'drl2', 'term-def', '{"term":"d","def":"d"}', 0, 's:4', 'deleted');
`);

let base, listener;
test.before(() => new Promise((ok) => { listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); }); }));
test.after(() => listener.close());

const post = (body, user = "dr1") => fetch(base + "/api/cards/delete-removed",
  { method: "POST", headers: { "content-type": "application/json", "x-user": user }, body: JSON.stringify(body) });

test("deletes only the caller's cards flagged removed, and records each for KnowledgeApp", async () => {
  const r = await post({ cardIds: ["gone1", "gone2", "upd", "other"] });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, deleted: 2, skipped: 2 });
  const left = db.prepare("SELECT id FROM cards WHERE id IN ('gone1','gone2','upd','other') ORDER BY id").all().map((x) => x.id);
  assert.deepEqual(left, ["other", "upd"]);
  const logged = db.prepare("SELECT external_id FROM external_card_deletions WHERE user_id = 'dr1' ORDER BY external_id").all();
  assert.deepEqual(logged.map((x) => x.external_id), ["s:1", "s:2"]);
});

test("rejects a malformed list", async () => {
  assert.equal((await post({ cardIds: [] })).status, 400);
  assert.equal((await post({ cardIds: [1] })).status, 400);
});

test("the button shows only when a removed card is in view, and asks first", () => {
  const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
  assert.match(app, /btn-upstream-delete-removed"\)\.classList\.toggle\("hidden",\s*!cards\.some\(function\(c\) \{ return c\.upstream_change === "deleted"; \}\)\)/);
  assert.match(app, /confirmDelete\(t\("upstream\.confirmDeleteRemoved"/);
  assert.match(fs.readFileSync(path.join(root, "client", "index.html"), "utf8"), /id="btn-upstream-delete-removed"/);
});
