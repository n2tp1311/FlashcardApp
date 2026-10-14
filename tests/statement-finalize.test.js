"use strict";
// node-sqlite3-wasm frees a prepared statement only when it is finalized, and the routes
// prepare on every request through server/db.js's db.prepare shim. Loads the real db.js on
// an in-memory database whose prepare counts statements left open, then runs migrations,
// the shim (including a call that throws) and real stats requests, and expects none.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const express = require("express");

const root = path.join(__dirname, "..");
const dbFile = path.join(root, "server", "db.js");

let open = 0;
const realLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent && parent.filename === dbFile) {
    if (request === "node-sqlite3-wasm") {
      const lib = realLoad.call(this, request, parent, isMain);
      class Counting extends lib.Database {
        constructor() { super(); }
        prepare(sql) {
          const stmt = super.prepare(sql);
          open++;
          const finalize = stmt.finalize.bind(stmt);
          stmt.finalize = function() { open--; return finalize(); };
          return stmt;
        }
      }
      return Object.assign({}, lib, { Database: Counting });
    }
    if (request === "fs") return { ...fs, rmSync() {}, mkdirSync() {}, existsSync: () => true };
    if (request === "./lib/dbLock") return { claim() {}, hold() { return function() {}; } };
  }
  return realLoad.call(this, request, parent, isMain);
};
const db = require(dbFile);
Module._load = realLoad;

const authFile = require.resolve(path.join(root, "server/middleware/auth.js"));
require.cache[authFile] = { id: authFile, filename: authFile, loaded: true, exports: {
  requireAuth(req, res, next) { req.session = { userId: "u1" }; next(); }
} };

test("the migrations leave no statement open", function() {
  assert.equal(open, 0);
});

test("the shim finalizes after run, get and all, and when the call throws", function() {
  db.prepare("INSERT INTO users (id, email, name) VALUES (?, ?, ?)").run("u1", "a@x", "A");
  assert.equal(db.prepare("SELECT name FROM users WHERE id = ?").get("u1").name, "A");
  assert.equal(db.prepare("SELECT id FROM users").all().length, 1);
  assert.throws(() => db.prepare("INSERT INTO users (id, email, name) VALUES (?, ?, ?)").run("u1", "a@x", "A"), /UNIQUE/);
  assert.throws(() => db.prepare("SELECT nope FROM users").get());
  assert.equal(open, 0);
});

test("a statement kept in a variable and run many times still leaves none open", function() {
  const insert = db.prepare("INSERT INTO reminder_log (user_id, kind, day) VALUES (?, ?, ?)");
  for (let i = 0; i < 20; i++) insert.run("u1", "daily", "2026-01-" + (10 + i));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reminder_log").get().n, 20);
  assert.equal(open, 0);
});

test("the dashboard and analytics requests leave none open", async function() {
  const app = express();
  app.use("/api/stats", require(path.join(root, "server/routes/stats.js")));
  const server = app.listen(0);
  try {
    const base = "http://127.0.0.1:" + server.address().port + "/api/stats/";
    for (const route of ["dashboard", "analytics"]) {
      const res = await fetch(base + route);
      assert.equal(res.status, 200, route);
    }
  } finally {
    server.close();
  }
  assert.equal(open, 0);
});
