"use strict";
// server/lib/dbLock.js: a start clears a lock only when its holder is gone. Run against
// node-sqlite3-wasm's own lock directory on a throwaway file, plus a real second server
// process for the case the old unconditional delete got wrong.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { Database } = require("node-sqlite3-wasm");
const dbLock = require("../server/lib/dbLock");

const root = path.join(__dirname, "..");
const quiet = { log: function() {} };

function tmpfile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fc-lock-")), "t.db");
}
// A database held the way server/db.js holds it.
function open(file) {
  const db = new Database(file);
  db.exec("PRAGMA locking_mode = EXCLUSIVE");
  db.get("PRAGMA journal_mode = WAL");
  return db;
}
function plant(file, owner, ageMs) {
  fs.mkdirSync(file + ".lock", { recursive: true });
  const f = path.join(file + ".lock", "owner.json");
  fs.writeFileSync(f, JSON.stringify(owner));
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(f, t, t);
}
function deadPid() {
  const r = spawnSync(process.execPath, ["-e", ""]);
  return r.pid;
}

test("no lock: nothing to do", function() {
  assert.equal(dbLock.claim(tmpfile(), quiet), "free");
});

test("a live holder on this machine stops the start, and its lock is left alone", function() {
  const file = tmpfile();
  const db = open(file);
  const release = dbLock.hold(file, { pid: process.ppid });
  assert.throws(() => dbLock.claim(file, quiet), /in use by pid/);
  assert.ok(fs.existsSync(file + ".lock"));
  release();
  db.close();
  assert.ok(!fs.existsSync(file + ".lock"), "release before close lets SQLite remove its lock");
});

test("a holder that died on this machine is cleared, and the file opens", function() {
  const file = tmpfile();
  open(file).get("SELECT 1");
  plant(file, { pid: deadPid(), host: os.hostname(), started: "x" }, 0);
  assert.equal(dbLock.claim(file, quiet), "cleared");
  open(file).close();
});

test("our own pid in the owner file means a fresh container reused it", function() {
  const file = tmpfile();
  plant(file, { pid: process.pid, host: os.hostname(), started: "x" }, 0);
  assert.equal(dbLock.claim(file, quiet), "cleared");
});

test("a lock with no owner recorded is cleared, as before", function() {
  const file = tmpfile();
  fs.mkdirSync(file + ".lock");
  assert.equal(dbLock.claim(file, quiet), "cleared");
});

test("another host: cleared once its heartbeat is older than STALE_MS", function() {
  const file = tmpfile();
  plant(file, { pid: 1, host: "elsewhere", started: "x" }, dbLock.STALE_MS + 1000);
  assert.equal(dbLock.claim(file, quiet), "cleared");
});

test("another host with a recent beat: the start waits for it to age", function() {
  const file = tmpfile();
  plant(file, { pid: 1, host: "elsewhere", started: "x" }, 2000);
  let clock = Date.now(), waited = 0;
  const r = dbLock.claim(file, Object.assign({ now: () => clock, wait: (ms) => { waited += ms; clock += ms; } }, quiet));
  assert.equal(r, "cleared");
  assert.ok(waited > 0 && waited <= dbLock.STALE_MS, String(waited));
});

test("another host still beating: refused after STALE_MS", function() {
  const file = tmpfile();
  plant(file, { pid: 1, host: "elsewhere", started: "x" }, 0);
  const f = path.join(file + ".lock", "owner.json");
  let clock = Date.now();
  const beat = (ms) => { clock += ms; const t = new Date(clock); fs.utimesSync(f, t, t); };
  assert.throws(() => dbLock.claim(file, Object.assign({ now: () => clock, wait: beat }, quiet)), /heartbeat is still advancing/);
  assert.ok(fs.existsSync(f));
});

test("a holder whose owner file is taken over is told to stop", async function() {
  const file = tmpfile();
  const db = open(file);
  let lost = false;
  dbLock.hold(file, { onLost: () => { lost = true; } });
  fs.writeFileSync(path.join(file + ".lock", "owner.json"), JSON.stringify({ pid: 1, host: "other", started: "y" }));
  await new Promise((r) => setTimeout(r, dbLock.HEARTBEAT_MS + 300));
  assert.ok(lost);
  db.close();
});

test("a second server on the same data refuses to start; the first stops cleanly on SIGTERM", async function() {
  // A copy of the server tree pointed at a scratch data directory, so the real database
  // is never touched.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-lock-srv-"));
  fs.cpSync(path.join(root, "server"), path.join(dir, "server"), { recursive: true });
  fs.symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"));
  const boot = 'require("./server/db"); setInterval(function() {}, 1000); process.stdout.write("up\\n");';
  const first = spawn(process.execPath, ["-e", boot], { cwd: dir, env: Object.assign({}, process.env, { DB_JOURNAL_MODE: "" }) });
  await new Promise((resolve, reject) => {
    let out = "";
    first.stdout.on("data", (d) => { out += d; if (out.includes("up")) resolve(); });
    first.stderr.on("data", (d) => { out += d; });
    first.on("exit", () => reject(new Error(out)));
  });
  const lock = path.join(dir, "data", "flashcards.db.lock");
  assert.equal(JSON.parse(fs.readFileSync(path.join(lock, "owner.json"))).pid, first.pid);

  const second = spawnSync(process.execPath, ["-e", boot], { cwd: dir, encoding: "utf8", timeout: 20000 });
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, new RegExp("in use by pid " + first.pid));
  assert.ok(fs.existsSync(path.join(lock, "owner.json")), "the live lock survives the second start");

  const code = await new Promise((r) => { first.on("exit", (c) => r(c)); first.kill("SIGTERM"); });
  assert.equal(code, 0);
  assert.ok(!fs.existsSync(lock), "a clean stop removes the lock");
});
