"use strict";
// attempt_daily (server/lib/attemptDaily.js) is derived data: whatever writes attempts, the
// table must equal a rebuild from attempts, and the rollup must give the numbers the raw
// attempts queries gave. Run on an in-memory database with the attempts table exactly as
// server/db.js creates it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { Database } = require("node-sqlite3-wasm");
const attemptDaily = require("../server/lib/attemptDaily");

const root = path.join(__dirname, "..");
const schema = fs.readFileSync(path.join(root, "server/db.js"), "utf8");
const attemptsTable = schema.match(/CREATE TABLE attempts_v3 \([\s\S]*?\n      \);/)[0]
  .replace("attempts_v3", "attempts");

function fresh() {
  const db = new Database();
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY)");
  db.exec(attemptsTable);
  db.exec("INSERT INTO users VALUES ('u1'), ('u2')");
  return db;
}

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);
let seq = 0;
function add(db, o) {
  const a = Object.assign({ id: "a" + (seq++), user: "u1", correct: 1, source: "flashcard", ago: 0, ms: 4000, grade: "good" }, o);
  db.run("INSERT INTO attempts (id, card_id, user_id, correct, source, created_at, duration_ms, grade) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [a.id, "c" + (seq % 7), a.user, a.correct, a.source, now - a.ago, a.ms, a.grade]);
  return a.id;
}
function snapshot(db) {
  return db.all("SELECT * FROM attempt_daily ORDER BY user_id, day, source, grade, correct");
}
function rebuilt(db) {
  db.exec("SAVEPOINT r");
  attemptDaily.rebuild(db);
  const rows = snapshot(db);
  db.exec("ROLLBACK TO r");
  db.exec("RELEASE r");
  return rows;
}

// A small random history: days back, both users, every source, missing grades and durations.
function history(db, n) {
  let r = 7;
  const rand = (k) => { r = (r * 1103515245 + 12345) % 2147483648; return r % k; };
  const ids = [];
  for (let i = 0; i < n; i++) {
    ids.push(add(db, {
      user: rand(3) ? "u1" : "u2", correct: rand(5) ? 1 : 0, source: ["flashcard", "quiz", "recall"][rand(3)],
      ago: rand(100 * DAY), ms: rand(4) ? 1000 + rand(20000) : null, grade: rand(5) ? ["again", "hard", "good", "easy"][rand(4)] : null
    }));
  }
  return ids;
}

test("the backfill sums the history already there", function() {
  const db = fresh();
  history(db, 300);
  attemptDaily.install(db);
  assert.ok(snapshot(db).length > 50);
  assert.deepEqual(snapshot(db), rebuilt(db));
});

test("grading, undo, edits, a duplicate import and an account delete all keep it equal to a rebuild", function() {
  const db = fresh();
  attemptDaily.install(db);
  const ids = history(db, 400);
  assert.deepEqual(snapshot(db), rebuilt(db), "inserts");

  ids.slice(0, 60).forEach(id => db.run("DELETE FROM attempts WHERE id = ?", [id]));
  assert.deepEqual(snapshot(db), rebuilt(db), "undo deletes");

  db.run("UPDATE attempts SET grade = NULL, duration_ms = NULL WHERE rowid % 9 = 0");
  db.run("UPDATE attempts SET created_at = created_at - 3 * ? WHERE rowid % 11 = 0", [DAY]);
  db.run("UPDATE attempts SET correct = 1 - correct, source = 'quiz' WHERE rowid % 13 = 0");
  assert.deepEqual(snapshot(db), rebuilt(db), "updates");

  // The full-account import re-sends rows that already exist; only new ones may count.
  const before = db.get("SELECT SUM(cnt) AS n FROM attempt_daily").n;
  db.run("INSERT OR IGNORE INTO attempts (id, card_id, user_id, correct, source, created_at) VALUES (?, 'c1', 'u1', 1, 'quiz', ?)", [ids[100], now]);
  assert.equal(db.get("SELECT SUM(cnt) AS n FROM attempt_daily").n, before);

  db.run("DELETE FROM users WHERE id = 'u2'");
  assert.equal(db.get("SELECT COUNT(*) AS n FROM attempt_daily WHERE user_id = 'u2'").n, 0);
  assert.deepEqual(snapshot(db), rebuilt(db), "cascade delete");
});

test("emptying a bucket removes its row", function() {
  const db = fresh();
  attemptDaily.install(db);
  const id = add(db, {});
  db.run("DELETE FROM attempts WHERE id = ?", [id]);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM attempt_daily").n, 0);
});

test("the dashboard and analytics read the numbers the raw attempts queries gave", function() {
  const db = fresh();
  attemptDaily.install(db);
  history(db, 500);
  const stats = fs.readFileSync(path.join(root, "server/routes/stats.js"), "utf8");
  for (const u of ["u1", "u2"]) {
    // All-time totals and per-day study time (null for a day with no measured duration).
    assert.deepEqual(
      db.get("SELECT SUM(cnt) AS total, SUM(CASE WHEN correct = 1 THEN cnt ELSE 0 END) AS correct_count FROM attempt_daily WHERE user_id = ?", [u]),
      db.get("SELECT COUNT(*) AS total, SUM(correct) AS correct_count FROM attempts WHERE user_id = ?", [u]));
    assert.deepEqual(
      db.all("SELECT day, CASE WHEN SUM(samples) > 0 THEN SUM(ms) END AS ms FROM attempt_daily WHERE user_id = ? GROUP BY day", [u]),
      db.all("SELECT date(created_at, 'unixepoch') AS day, SUM(duration_ms) AS ms FROM attempts WHERE user_id = ? GROUP BY day", [u]));
    assert.deepEqual(
      db.get("SELECT AVG(ms) AS avg, MIN(ms) AS min, MAX(ms) AS max, COUNT(*) AS n FROM (SELECT SUM(ms) AS ms FROM attempt_daily WHERE user_id = ? AND day >= date('now', '-30 days') GROUP BY day HAVING SUM(samples) > 0)", [u]),
      db.get("SELECT AVG(ms) AS avg, MIN(ms) AS min, MAX(ms) AS max, COUNT(*) AS n FROM (SELECT SUM(duration_ms) AS ms FROM attempts WHERE user_id = ? AND date(created_at, 'unixepoch') >= date('now', '-30 days') GROUP BY date(created_at, 'unixepoch') HAVING ms IS NOT NULL)", [u]));
    // Grade mix over the window, NULL grades back as NULL.
    assert.deepEqual(
      db.all("SELECT source, NULLIF(grade, '') AS grade, correct, SUM(cnt) AS cnt FROM attempt_daily WHERE user_id = ? AND day >= date('now', '-60 days') GROUP BY source, grade, correct ORDER BY source, grade, correct", [u]),
      db.all("SELECT source, grade, correct, COUNT(*) AS cnt FROM attempts WHERE user_id = ? AND date(created_at, 'unixepoch') >= date('now', '-60 days') GROUP BY source, grade, correct ORDER BY source, grade, correct", [u]));
  }
  // The routes read the rollup, not attempts, for these.
  const analytics = stats.slice(stats.indexOf('router.get("/analytics"'), stats.indexOf('router.get("/card-history'));
  assert.equal((analytics.match(/FROM attempt_daily/g) || []).length, 4);
  const dashboard = stats.slice(stats.indexOf('router.get("/dashboard"'), stats.indexOf('router.get("/analytics"'));
  assert.equal((dashboard.match(/FROM attempts/g) || []).length, 0);
});

test("db.js installs the rollup in its own transaction", function() {
  assert.match(schema, /runMigration\("attempt_daily_rollup", function\(\) \{\n  try \{\n    db\.exec\("BEGIN"\);\n    attemptDaily\.install\(db\);\n    db\.exec\("COMMIT"\);/);
});
