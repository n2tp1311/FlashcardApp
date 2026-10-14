"use strict";

// Nightly copies of the database, kept on the volume and pulled off it by the owner's
// machine (scripts/pull-backup.sh). Two copies guard against different losses: the ones
// on the volume against a bad migration or a mistaken delete, the pulled ones against
// losing the volume itself, which the volume's copies share.
//
// VACUUM INTO writes a consistent, compacted copy from inside this connection, so it
// works under locking_mode=EXCLUSIVE, where nothing else may open the file, and needs no
// checkpoint first. It blocks the event loop while it runs: measured 0.39 s for a 51 MB
// database, 0.53 s with the check below, which is why it runs once a night rather than
// on demand.

const fs = require("fs");
const path = require("path");

const KEEP = 7;
const NAME = /^flashcards-(\d{4}-\d{2}-\d{2})\.db$/;

function day(nowMs) { return new Date(nowMs).toISOString().slice(0, 10); }

function list(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) {}
  return names.filter(n => NAME.test(n)).sort();
}

function latest(dir) {
  const names = list(dir);
  if (!names.length) return null;
  const name = names[names.length - 1];
  return { file: path.join(dir, name), day: name.match(NAME)[1] };
}

// One copy per UTC day. Written under a temporary name and renamed, so a copy cut short
// by a crash is never taken for a finished one, and checked before the rename, so a
// damaged database is not passed off as a good backup. quick_check here (0.14 s on the
// 51 MB copy, against 1.2 s for integrity_check, all of it on the event loop); the pull
// runs the full integrity_check on the owner's machine, where it costs the server nothing.
function snapshot(db, dir, nowMs) {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, "flashcards-" + day(nowMs) + ".db");
  if (fs.existsSync(target)) return null;
  const tmp = target + ".part";
  fs.rmSync(tmp, { force: true });
  db.run("VACUUM INTO ?", [tmp]);
  const { Database } = require("node-sqlite3-wasm");
  const copy = new Database(tmp);
  let ok;
  try { ok = copy.get("PRAGMA quick_check").quick_check; } finally { copy.close(); }
  if (ok !== "ok") {
    fs.rmSync(tmp, { force: true });
    throw new Error("backup copy failed quick_check: " + ok);
  }
  fs.renameSync(tmp, target);
  for (const old of list(dir).slice(0, -KEEP)) fs.rmSync(path.join(dir, old), { force: true });
  return target;
}

// Called every few minutes: makes today's copy once the UTC hour reaches `hour`. The
// default, 18 UTC, is 01:00 in Vietnam: nobody studies then, and it is clear of
// KnowledgeApp's nightly guide sync at 02:00. A server that was down at that hour makes
// it on its next check that day.
function due(dir, nowMs, hour) {
  if (new Date(nowMs).getUTCHours() < hour) return false;
  const last = latest(dir);
  return !last || last.day !== day(nowMs);
}

module.exports = { snapshot, latest, due, list, KEEP };
