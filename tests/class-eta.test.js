"use strict";
// GET /api/stats/class-eta: the pace, the time to master and each class's readyAt behind the
// Study order sheet's dates.
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
server.use("/api/stats", require(path.join(root, "server/routes/stats.js")));

const now = Math.floor(Date.now() / 1000), D = 86400;
db.exec(`
  INSERT INTO users (id, email, name) VALUES ('u1', 'a@x', 'A'), ('u2', 'b@x', 'B');
  INSERT INTO classes (id, user_id, name, sort_order, archived) VALUES
    ('k1', 'u1', 'Learning', 0, 0), ('kL', 'u1', 'Lapsed', 4, 0), ('kM', 'u1', 'Mastered', 1, 0), ('kE', 'u1', 'Empty', 2, 0), ('kA', 'u1', 'Archived', 3, 1);
  INSERT INTO lessons (id, class_id, title, format, sort_order) VALUES
    ('l1', 'k1', 'L', 'term-def', 0), ('lL', 'kL', 'L', 'term-def', 0), ('lM', 'kM', 'L', 'term-def', 0), ('lA', 'kA', 'L', 'term-def', 0);
`);
const card = db.prepare("INSERT INTO cards (id, lesson_id, format, data, sort_order) VALUES (?, ?, 'term-def', '{\"term\":\"t\",\"def\":\"d\"}', 0)");
const state = db.prepare("INSERT INTO card_states (card_id, user_id, srs_due_at, fsrs_stability, fsrs_difficulty, fsrs_state, fsrs_reps, fsrs_lapses, fsrs_learning_steps, fsrs_last_review_at, known) VALUES (?, 'u1', ?, ?, 5, ?, 3, 0, 0, ?, ?)");
let seq = 0;
const answer = (cardId, at) => db.prepare("INSERT INTO attempts (id, card_id, user_id, correct, source, created_at) VALUES (?, ?, 'u1', 1, 'flashcard', ?)").run("a" + (++seq), cardId, at);

// 21 cards mastered 10 days after their first answer, 40 days ago, on a 30-day interval: the
// sample. The first of them was answered again yesterday -- not a new card in the window.
for (let i = 0; i < 21; i++) {
  card.run("m" + i, "lM");
  state.run("m" + i, now - 10 * D, 40, 2, now - 40 * D, 0);
  answer("m" + i, now - 50 * D);
}
answer("m0", now - D);
card.run("old", "l1");                              // mastered long ago: interval 90 d, out of the sample
state.run("old", now + 30 * D, 120, 2, now - 60 * D, 0);
answer("old", now - 45 * D + 7 * D);
card.run("fresh", "l1");                            // learned 3 days ago, due in 5
state.run("fresh", now + 5 * D, 4, 2, now - D, 0);
answer("fresh", now - 3 * D);
card.run("new", "l1");                              // never answered
card.run("knowit", "l1");                           // Know It toggled: no schedule
state.run("knowit", null, null, 0, null, 1);
card.run("arch", "lA");
card.run("lapsed", "lL");                           // first answered 100 days ago, back on a 2-day interval
state.run("lapsed", now + D, 1, 2, now - D, 0);
answer("lapsed", now - 100 * D);

let base, listener;
test.before(() => new Promise((ok) => { listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); }); }));
test.after(() => listener.close());
const eta = async (user) => (await fetch(base + "/api/stats/class-eta", { headers: { "x-user": user } })).json();

test("pace is cards first answered in the last 28 days, per calendar day", async () => {
  const r = await eta("u1");
  assert.equal(r.pacePerDay, Math.round(100 / 28) / 100);
});

test("masterDays is the median of just-mastered cards, from first answer to that review", async () => {
  const r = await eta("u1");
  assert.equal(r.masterDaysMeasured, true);
  assert.equal(r.masterDays, 10);
});

test("each live class: its cards, the unmastered ones, and when the learned ones can be mastered", async () => {
  const r = await eta("u1");
  const by = Object.fromEntries(r.classes.map(c => [c.id, c]));
  assert.deepEqual(Object.keys(by).sort(), ["k1", "kE", "kL", "kM"]);
  assert.deepEqual([by.k1.total, by.k1.unmastered], [4, 3]);
  // a 6-day interval is 15/21 short of mastered: 7.1 days, past the usual 10 days from 3 days ago
  // (7) and the due date (5)
  assert.ok(Math.abs(by.k1.readyAt - (now + 10 * D * 15 / 21)) <= 2, String((by.k1.readyAt - now) / D));
  // long past its usual time and due tomorrow: still most of masterDays away, not "today"
  assert.ok(Math.abs(by.kL.readyAt - (now + 10 * D * 19 / 21)) <= 2, String((by.kL.readyAt - now) / D));
  assert.deepEqual([by.kM.total, by.kM.unmastered, by.kM.readyAt], [21, 0, null]);
  assert.deepEqual([by.kE.total, by.kE.unmastered, by.kE.readyAt], [0, 0, null]);
});

test("a new account has no pace and a simulated time to master", async () => {
  const r = await eta("u2");
  assert.equal(r.pacePerDay, 0);
  assert.equal(r.masterDaysMeasured, false);
  assert.ok(r.masterDays > 3 && r.masterDays < 60, String(r.masterDays));
  assert.deepEqual(r.classes, []);
});
