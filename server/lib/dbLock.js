"use strict";

// Who holds flashcards.db. node-sqlite3-wasm locks a database by creating the directory
// <file>.lock and removing it on unlock; with locking_mode=EXCLUSIVE (server/db.js) the
// server holds it for its whole life. A process that dies without closing -- a crash, a
// SIGKILL, a redeploy -- leaves the directory behind, and the next start would fail with
// "database is locked". db.js used to delete it unconditionally on start, which also
// deleted a live process's lock: a second `npm start`, or a script requiring db.js, then
// wrote the same file as the server, and two writers corrupt a SQLite file.
//
// So the holder writes owner.json into the lock directory -- pid, host, start time -- and
// touches it every HEARTBEAT_MS. A start clears the lock only if its holder is gone:
//   - same host: the pid is not running (or is our own pid, reused in a fresh container);
//   - another host, where a pid means nothing: the heartbeat is older than STALE_MS. The
//     start waits up to that long for it to age, and refuses if it keeps beating.
// A lock with no owner.json was left by code from before this file, or by a process that
// died between taking the lock and writing it; it is cleared as before.
//
// The cost: after an unclean stop on another host (Railway kills the old container on a
// redeploy, often before SIGTERM is handled) the next start can wait up to STALE_MS.
// STALE_MS is kept short for that reason; a holder that blocks its event loop longer than
// STALE_MS - HEARTBEAT_MS misses a beat, which only matters if another host shares the volume.

const fs = require("fs");
const os = require("os");
const path = require("path");

const HEARTBEAT_MS = 3000;
const STALE_MS = 10000;

function lockDir(dbFile) { return dbFile + ".lock"; }
function ownerFile(dbFile) { return path.join(lockDir(dbFile), "owner.json"); }

function readOwner(file) {
  try {
    return { owner: JSON.parse(fs.readFileSync(file, "utf8")), beat: fs.statSync(file).mtimeMs };
  } catch (_) {
    return null;
  }
}

function running(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// Before opening: clear a lock whose holder is gone, or throw if it is alive.
function claim(dbFile, opts) {
  const o = Object.assign({ host: os.hostname(), pid: process.pid, now: Date.now, wait: sleep, log: console.log }, opts);
  const dir = lockDir(dbFile);
  const deadline = o.now() + STALE_MS;
  for (;;) {
    if (!fs.existsSync(dir)) return "free";
    const held = readOwner(ownerFile(dbFile));
    let reason = null;
    if (!held) reason = "no owner recorded";
    else if (held.owner.host === o.host) {
      if (held.owner.pid === o.pid) reason = "pid " + o.pid + " is this process";
      else if (!running(held.owner.pid)) reason = "pid " + held.owner.pid + " is not running";
      else throw new Error("[db] " + dbFile + " is in use by pid " + held.owner.pid + " on this machine; stop it first");
    } else if (o.now() - held.beat > STALE_MS) {
      reason = "host " + held.owner.host + " last beat " + Math.round((o.now() - held.beat) / 1000) + " s ago";
    } else if (o.now() >= deadline) {
      throw new Error("[db] " + dbFile + " is in use by host " + held.owner.host + ", whose heartbeat is still advancing");
    }
    if (reason) {
      fs.rmSync(dir, { recursive: true, force: true });
      o.log("[db] cleared a stale lock: " + reason);
      return "cleared";
    }
    o.wait(HEARTBEAT_MS);
  }
}

// After the exclusive lock is taken: record ourselves and keep the heartbeat going.
// onLost runs if owner.json stops being ours -- another process cleared the lock and
// may be writing the file -- and the server must stop writing at once.
function hold(dbFile, opts) {
  const o = Object.assign({ host: os.hostname(), pid: process.pid, onLost: null }, opts);
  const file = ownerFile(dbFile);
  const me = { pid: o.pid, host: o.host, started: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(me));
  const timer = setInterval(function() {
    const held = readOwner(file);
    if (!held || held.owner.pid !== me.pid || held.owner.started !== me.started || held.owner.host !== me.host) {
      clearInterval(timer);
      if (o.onLost) o.onLost();
      return;
    }
    const t = new Date();
    try { fs.utimesSync(file, t, t); } catch (_) {}
  }, HEARTBEAT_MS);
  timer.unref();
  // SQLite removes the lock directory with rmdir on close, which fails while owner.json
  // is in it, so this runs before db.close().
  return function release() {
    clearInterval(timer);
    try { fs.unlinkSync(file); } catch (_) {}
  };
}

module.exports = { claim, hold, HEARTBEAT_MS, STALE_MS };
