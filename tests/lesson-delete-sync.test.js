"use strict";
// Deleting a lesson records its linked cards for KnowledgeApp, marked kind 'lesson', so a
// later Sync does not add them back. The statements are read from the route and run against
// an in-memory database, so the test checks the SQL that ships.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { Database } = require("node-sqlite3-wasm");

const root = path.join(__dirname, "..");
const lessons = fs.readFileSync(path.join(root, "server/routes/lessons.js"), "utf8");
const route = lessons.slice(lessons.indexOf('router.delete("/lessons/:id"'));
const handler = route.slice(0, route.indexOf("\n});") + 4);

function sqlOf(src) {
  return [...src.matchAll(/db\.prepare\(\s*((?:"[^"]*"\s*\+?\s*)+)\)/g)]
    .map((m) => m[1].split(/"\s*\+\s*"/).join("").replace(/^"|"\s*$/g, ""));
}

test("a lesson delete records each linked card, in the same transaction, before the delete", () => {
  assert.match(handler, /db\.transaction\(/);
  const sql = sqlOf(handler);
  assert.strictEqual(sql.length, 2);
  assert.match(sql[0], /INSERT INTO external_card_deletions/);
  assert.match(sql[1], /DELETE FROM lessons/);

  const db = new Database();
  db.exec(`CREATE TABLE lessons (id TEXT PRIMARY KEY);
    CREATE TABLE cards (id TEXT PRIMARY KEY, lesson_id TEXT, external_id TEXT);
    CREATE TABLE external_card_deletions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT,
      external_id TEXT NOT NULL, card_id TEXT NOT NULL, deleted_at INTEGER DEFAULT 0,
      kind TEXT NOT NULL DEFAULT 'card');
    INSERT INTO lessons VALUES ('L1'), ('L2');
    INSERT INTO cards VALUES ('c1','L1','store:1'), ('c2','L1',NULL), ('c3','L2','store:3');`);
  db.prepare(sql[0]).run(["u1", "L1"]);
  const rows = db.all("SELECT user_id, external_id, card_id, kind FROM external_card_deletions");
  assert.deepStrictEqual(rows, [{ user_id: "u1", external_id: "store:1", card_id: "c1", kind: "lesson" }]);
  db.close();
});

test("the deletions feed returns kind, and the column defaults single-card deletes to 'card'", () => {
  const integrations = fs.readFileSync(path.join(root, "server/routes/integrations.js"), "utf8");
  assert.match(integrations, /SELECT id, external_id, card_id, kind, deleted_at FROM external_card_deletions/);
  const schema = fs.readFileSync(path.join(root, "server/db.js"), "utf8");
  assert.match(schema, /ALTER TABLE external_card_deletions ADD COLUMN kind TEXT NOT NULL DEFAULT 'card'/);
});
