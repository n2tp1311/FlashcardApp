"use strict";
// Nightly backups: server/lib/backup.js makes the copy, server/routes/backup.js serves it
// to BACKUP_TOKEN only, scripts/pull-backup.sh saves and checks it on the owner's machine.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execFile } = require("child_process");
const express = require("express");
const { Database } = require("node-sqlite3-wasm");
const backup = require("../server/lib/backup");
const backupRouter = require("../server/routes/backup");

const root = path.join(__dirname, "..");
const DAY = 86400000;
const at = (iso) => Date.parse(iso);

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), "fc-backup-")); }
// A database held as server/db.js holds it, with writes still in the WAL.
function live(dir) {
  const db = new Database(path.join(dir, "flashcards.db"));
  db.exec("PRAGMA locking_mode = EXCLUSIVE");
  db.get("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  for (let i = 0; i < 50; i++) db.run("INSERT INTO t (v) VALUES (?)", ["row " + i]);
  return db;
}
function rows(file) {
  const db = new Database(file);
  try { return db.get("SELECT COUNT(*) AS n, MAX(v) AS v FROM t"); } finally { db.close(); }
}

test("a snapshot copies the live database, writes still in the WAL included", function() {
  const dir = tmpdir();
  const db = live(dir);
  const file = backup.snapshot(db, path.join(dir, "b"), at("2026-10-15T18:05:00Z"));
  assert.equal(path.basename(file), "flashcards-2026-10-15.db");
  assert.deepEqual(rows(file), { n: 50, v: "row 9" });
  assert.equal(backup.snapshot(db, path.join(dir, "b"), at("2026-10-15T23:00:00Z")), null, "one copy a day");
  db.close();
});

test("a copy cut short is never served, and only the newest KEEP are kept", function() {
  const dir = tmpdir();
  const db = live(dir);
  const b = path.join(dir, "b");
  fs.mkdirSync(b);
  fs.writeFileSync(path.join(b, "flashcards-2026-12-31.db.part"), "half");
  const start = at("2026-10-01T18:00:00Z");
  for (let i = 0; i < backup.KEEP + 3; i++) backup.snapshot(db, b, start + i * DAY);
  assert.equal(backup.list(b).length, backup.KEEP);
  assert.equal(backup.latest(b).day, "2026-10-10");
  assert.equal(backup.list(b)[0], "flashcards-2026-10-04.db");
  db.close();
});

test("due: once the hour is reached, and only if today has no copy", function() {
  const b = tmpdir();
  assert.equal(backup.due(b, at("2026-10-15T17:59:00Z"), 18), false);
  assert.equal(backup.due(b, at("2026-10-15T18:00:00Z"), 18), true);
  fs.writeFileSync(path.join(b, "flashcards-2026-10-15.db"), "");
  assert.equal(backup.due(b, at("2026-10-15T22:00:00Z"), 18), false);
  assert.equal(backup.due(b, at("2026-10-16T18:30:00Z"), 18), true);
});

function serve(dir) {
  const app = express();
  app.use("/api/backup", backupRouter(dir));
  const server = app.listen(0);
  return { server, base: "http://127.0.0.1:" + server.address().port };
}

test("the route: absent without BACKUP_TOKEN, 401 for a wrong token, the gzipped copy for the right one", async function() {
  const dir = tmpdir();
  const db = live(dir);
  const b = path.join(dir, "b");
  const file = backup.snapshot(db, b, Date.now());
  db.close();
  const { server, base } = serve(b);
  const saved = process.env.BACKUP_TOKEN;
  try {
    delete process.env.BACKUP_TOKEN;
    assert.equal((await fetch(base + "/api/backup/latest", { headers: { authorization: "Bearer x" } })).status, 404);
    process.env.BACKUP_TOKEN = "s3cret-token";
    assert.equal((await fetch(base + "/api/backup/latest")).status, 401);
    assert.equal((await fetch(base + "/api/backup/latest", { headers: { authorization: "Bearer s3cret-tokeN" } })).status, 401);
    assert.equal((await fetch(base + "/api/backup/latest?token=s3cret-token")).status, 401, "never from the URL");
    const res = await fetch(base + "/api/backup/latest", { headers: { authorization: "Bearer s3cret-token" } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-backup-day"), new Date().toISOString().slice(0, 10));
    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(zlib.gunzipSync(body).equals(fs.readFileSync(file)));
  } finally {
    if (saved === undefined) delete process.env.BACKUP_TOKEN; else process.env.BACKUP_TOKEN = saved;
    server.close();
  }
});

function pull(env) {
  return new Promise((resolve) => {
    execFile("bash", [path.join(root, "scripts/pull-backup.sh")], { env }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, out: stdout + stderr });
    });
  });
}

test("pull-backup.sh saves a checked copy, and fails loudly on a wrong token", async function() {
  const dir = tmpdir();
  const db = live(dir);
  const b = path.join(dir, "b");
  backup.snapshot(db, b, Date.now());
  db.close();
  const { server, base } = serve(b);
  // A stand-in for osascript, so a failing run records its notification instead of showing it.
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "osascript"), '#!/bin/sh\necho "$@" >> "' + path.join(dir, "notified") + '"\n', { mode: 0o755 });
  const tokenFile = path.join(dir, "token");
  fs.writeFileSync(tokenFile, "s3cret-token\n", { mode: 0o600 });
  const dest = path.join(dir, "pulled");
  const env = Object.assign({}, process.env, {
    PATH: bin + ":" + process.env.PATH, FLASHCARD_URL: base, BACKUP_TOKEN_FILE: tokenFile, BACKUP_DEST: dest
  });
  const saved = process.env.BACKUP_TOKEN;
  process.env.BACKUP_TOKEN = "s3cret-token";
  try {
    const ok = await pull(env);
    assert.equal(ok.code, 0, ok.out);
    const day = new Date().toISOString().slice(0, 10);
    assert.deepEqual(rows(path.join(dest, "flashcards-" + day + ".db")), { n: 50, v: "row 9" });
    assert.deepEqual(fs.readdirSync(dest).filter(n => !n.startsWith(".")), ["flashcards-" + day + ".db"]);
    assert.ok(!fs.existsSync(path.join(dir, "notified")));

    fs.writeFileSync(tokenFile, "wrong\n");
    const bad = await pull(env);
    assert.equal(bad.code, 1);
    assert.match(bad.out, /HTTP 401/);
    assert.match(fs.readFileSync(path.join(dir, "notified"), "utf8"), /backup failed/);
  } finally {
    if (saved === undefined) delete process.env.BACKUP_TOKEN; else process.env.BACKUP_TOKEN = saved;
    server.close();
  }
});

test("index.js mounts the route before the session middleware, so a download never makes a session", function() {
  const src = fs.readFileSync(path.join(root, "server/index.js"), "utf8");
  const route = src.indexOf('app.use("/api/backup"');
  assert.ok(route > 0 && route < src.indexOf("app.use(session("));
});
