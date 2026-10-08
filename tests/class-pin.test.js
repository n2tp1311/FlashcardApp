"use strict";
// Pinned classes: the PUT route stores when a class was pinned, Home puts pinned classes
// first in that order whatever the sort, and local mode keeps the same field.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const express = require("express");
const { Database } = require("node-sqlite3-wasm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");

function extract(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}

const raw = new Database();
const _prepare = raw.prepare.bind(raw);
const db = {
  exec: (sql) => raw.exec(sql),
  prepare(sql) {
    const stmt = _prepare(sql);
    const arg = (a) => (a.length === 0 ? [] : a.length === 1 ? a[0] : a);
    return { run: (...a) => stmt.run(arg(a)), get: (...a) => stmt.get(arg(a)), all: (...a) => stmt.all(arg(a)) };
  }
};
const schema = fs.readFileSync(path.join(root, "server/db.js"), "utf8");
raw.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('u1'), ('u2')");
raw.exec(schema.match(/CREATE TABLE IF NOT EXISTS classes \([\s\S]*?\n  \);/)[0]);
for (const m of schema.matchAll(/db\.exec\("(ALTER TABLE classes ADD COLUMN [^"]+)"\)/g)) raw.exec(m[1]);
raw.exec("INSERT INTO classes (id, user_id, name) VALUES ('k1', 'u1', 'Stats'), ('k2', 'u2', 'Other')");

function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub("server/db.js", db);
stub("server/middleware/auth.js", {
  requireAuth(req, res, next) {
    req.session = { userId: req.get("x-user") };
    next();
  }
});
stub("server/services/classifier.js", {});
const server = express();
server.use(express.json());
server.use("/api/classes", require(path.join(root, "server/routes/classes.js")));

let base, listener;
test.before(() => new Promise((ok) => { listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); }); }));
test.after(() => listener.close());

async function put(id, body, user = "u1") {
  const r = await fetch(base + "/api/classes/" + id, { method: "PUT", headers: { "content-type": "application/json", "x-user": user }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

test("PUT pinned stamps the time once, keeps it on a repeat or an unrelated edit, and clears it on unpin", async function() {
  const pinned = await put("k1", { pinned: true });
  assert.equal(pinned.status, 200);
  assert.ok(pinned.body.pinned_at > 0);
  assert.equal((await put("k1", { pinned: true })).body.pinned_at, pinned.body.pinned_at);
  assert.equal((await put("k1", { name: "Statistics" })).body.pinned_at, pinned.body.pinned_at);
  assert.equal((await put("k1", { pinned: false })).body.pinned_at, null);
});

test("another user's class cannot be pinned", async function() {
  assert.equal((await put("k2", { pinned: true })).status, 404);
  assert.equal(raw.prepare("SELECT pinned_at FROM classes WHERE id = 'k2'").get().pinned_at, null);
});

function sorter() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(extract("sortClasses") + extract("sortUnpinnedClasses"), ctx);
  return ctx.sortClasses;
}

const classes = [
  { id: "a", name: "Alpha", created_at: 1 },
  { id: "z", name: "Zeta", created_at: 2, pinned_at: 200 },
  { id: "m", name: "Mu", created_at: 3 },
  { id: "b", name: "Beta", created_at: 4, pinned_at: 100 }
];

test("pinned classes come first, in pin order, whatever the sort and direction", function() {
  const sort = sorter();
  const ids = (key, dir) => sort(classes, key, dir).map(c => c.id).join("");
  assert.equal(ids("name", "asc"), "bzam");
  assert.equal(ids("name", "desc"), "bzma");
  assert.equal(ids("date_added", "desc"), "bzma");
  assert.equal(ids("date_added", "asc"), "bzam");
});

test("local mode turns pinned into pinned_at the same way the server does", async function() {
  const start = app.indexOf("    updateClass: function(id, fields) {");
  const body = app.slice(start + "    updateClass: ".length, app.indexOf("\n    },\n", start) + 6);
  let list = [{ id: "k1", name: "Stats" }];
  const ctx = { KEY_CLASSES: "classes", normalizeTagsArray: (x) => x, save: (k, v) => { list = v; } };
  vm.createContext(ctx);
  const update = vm.runInContext("(" + body + ")", ctx).bind({ getClasses: () => Promise.resolve(list) });
  const first = (await update("k1", { pinned: true })).pinned_at;
  assert.ok(first > 0);
  assert.equal("pinned" in list[0], false);
  assert.equal((await update("k1", { pinned: true })).pinned_at, first);
  assert.equal((await update("k1", { pinned: false })).pinned_at, null);
});

test("the pin control is on both Home layouts and in the class menu", function() {
  assert.equal(app.split("classPinButtonHtml(cls) +").length - 1, 2);
  assert.equal(app.split("classPinHtml(cls) + escHtml(cls.name)").length - 1, 2);
  assert.match(fs.readFileSync(path.join(root, "client", "index.html"), "utf8"), /id="btn-pin-class"/);
  for (const k of ["common.pin", "common.unpin", "class.pinned", "class.pinClass", "class.unpinClass", "toast.pinned", "toast.unpinned"]) {
    assert.equal(app.split('"' + k + '":').length - 1, 2, k);
  }
});
