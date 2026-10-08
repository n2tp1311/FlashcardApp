"use strict";
// A users table made before Google sign-in got its columns from a migration; without it every
// Google sign-in on production failed with "no such column: google_id".
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");

test("an old users table gains google_id and avatar_url, and google_id stays unique", function() {
  const dbFile = path.join(__dirname, "..", "server", "db.js");
  const realLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (parent && parent.filename === dbFile) {
      if (request === "node-sqlite3-wasm") {
        const { Database } = realLoad.call(this, request, parent, isMain);
        return { Database: class extends Database {
          constructor() {
            super();
            this.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()))");
            this.exec("INSERT INTO users (id, email, name, password_hash) VALUES ('u1', 'a@x', 'A', 'h')");
          }
        } };
      }
      if (request === "fs") return { ...fs, rmSync() {}, mkdirSync() {}, existsSync: () => true };
    }
    return realLoad.call(this, request, parent, isMain);
  };
  delete require.cache[dbFile];
  let db;
  try { db = require(dbFile); } finally { Module._load = realLoad; delete require.cache[dbFile]; }
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  assert.ok(cols.includes("google_id") && cols.includes("avatar_url"), cols.join(","));
  db.prepare("UPDATE users SET google_id = ?, avatar_url = ? WHERE id = ?").run("g1", "pic", "u1");
  assert.equal(db.prepare("SELECT * FROM users WHERE google_id = ?").get("g1").id, "u1");
  db.prepare("INSERT INTO users (id, email, name) VALUES ('u2', 'b@x', 'B')").run();
  assert.throws(() => db.prepare("UPDATE users SET google_id = 'g1' WHERE id = 'u2'").run(), /UNIQUE/);
});
