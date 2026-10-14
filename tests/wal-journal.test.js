"use strict";
// server/db.js runs the database in WAL with synchronous=NORMAL. This build of SQLite has no
// shared memory, which shapes how: these tests pin the facts the code depends on, on a
// throwaway file, and that db.js still does it in that order.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Database } = require("node-sqlite3-wasm");

const source = fs.readFileSync(path.join(__dirname, "../server/db.js"), "utf8");

function tmpdb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-wal-"));
  const file = path.join(dir, "t.db");
  const db = new Database(file);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  db.close();
  return file;
}

test("WAL turns on only with locking_mode=EXCLUSIVE; without it SQLite quietly keeps the rollback journal", function() {
  const file = tmpdb();
  let db = new Database(file);
  assert.equal(db.get("PRAGMA journal_mode = WAL").journal_mode, "delete");
  db.close();
  db = new Database(file);
  db.exec("PRAGMA locking_mode = EXCLUSIVE");
  assert.equal(db.get("PRAGMA journal_mode = WAL").journal_mode, "wal");
  db.close();
});

test("a WAL file opens again only with EXCLUSIVE, and DB_JOURNAL_MODE=delete's conversion undoes that", function() {
  const file = tmpdb();
  let db = new Database(file);
  db.exec("PRAGMA locking_mode = EXCLUSIVE");
  db.get("PRAGMA journal_mode = WAL");
  db.run("INSERT INTO t (v) VALUES ('kept')");
  db.close();

  db = new Database(file);
  assert.throws(() => db.get("SELECT v FROM t"), /unable to open database file/);
  db.close();

  db = new Database(file);
  db.exec("PRAGMA locking_mode = EXCLUSIVE");
  db.get("PRAGMA journal_mode = DELETE");
  db.exec("PRAGMA locking_mode = NORMAL");
  db.close();
  db = new Database(file);
  assert.equal(db.get("SELECT v FROM t").v, "kept");
  assert.equal(db.get("PRAGMA journal_mode").journal_mode, "delete");
  db.close();
});

test("db.js takes the exclusive lock before asking for WAL, then relaxes syncing", function() {
  const excl = source.indexOf('db.exec("PRAGMA locking_mode = EXCLUSIVE");');
  const wal = source.indexOf('db.get("PRAGMA journal_mode = WAL")');
  const sync = source.indexOf('db.exec("PRAGMA synchronous = NORMAL");');
  const firstTable = source.indexOf("CREATE TABLE IF NOT EXISTS users");
  assert.ok(excl > 0 && excl < wal && wal < sync && sync < firstTable, JSON.stringify({ excl, wal, sync, firstTable }));
  assert.match(source, /if \(process\.env\.DB_JOURNAL_MODE === "delete"\) \{\n  db\.get\("PRAGMA journal_mode = DELETE"\);/);
});
