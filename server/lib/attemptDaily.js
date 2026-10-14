"use strict";

// attempt_daily: attempts summed per user, UTC day, source, grade and correct. The heatmap,
// weekly trends, grade mix and study time read ~3k rows from here instead of rescanning the
// whole attempts history: on a 120k-attempt account /analytics took 1.08 s and its heatmap
// query alone 182 ms, against 1 ms from this table. node-sqlite3-wasm is synchronous, so
// that second was a second in which the server answered nobody.
//
// Kept by triggers, not by the routes, so every writer -- grading, undo, import, an
// account's cascade delete -- updates it inside its own transaction, and no code path can
// forget. attempts stays the source of truth; rebuild() recomputes this table from it.
// grade is '' rather than NULL: a NULL in the key never conflicts, so the upsert would add
// a row each time. ms counts only attempts with a measured duration, samples how many
// those are, so a day with no timing still reads as NULL, as SUM(duration_ms) did.

const KEY = "user_id = OLD.user_id AND day = date(OLD.created_at, 'unixepoch') " +
  "AND source = OLD.source AND grade = COALESCE(OLD.grade, '') AND correct = OLD.correct";
const ADD =
  "INSERT INTO attempt_daily (user_id, day, source, grade, correct, cnt, ms, samples) " +
  "VALUES (NEW.user_id, date(NEW.created_at, 'unixepoch'), NEW.source, COALESCE(NEW.grade, ''), NEW.correct, " +
  "1, COALESCE(NEW.duration_ms, 0), NEW.duration_ms IS NOT NULL) " +
  "ON CONFLICT (user_id, day, source, grade, correct) DO UPDATE SET " +
  "cnt = cnt + 1, ms = ms + excluded.ms, samples = samples + excluded.samples;";
const REMOVE =
  "UPDATE attempt_daily SET cnt = cnt - 1, ms = ms - COALESCE(OLD.duration_ms, 0), " +
  "samples = samples - (OLD.duration_ms IS NOT NULL) WHERE " + KEY + "; " +
  "DELETE FROM attempt_daily WHERE " + KEY + " AND cnt <= 0;";

function rebuild(db) {
  db.exec("DELETE FROM attempt_daily");
  db.exec(
    "INSERT INTO attempt_daily (user_id, day, source, grade, correct, cnt, ms, samples) " +
    "SELECT user_id, date(created_at, 'unixepoch'), source, COALESCE(grade, ''), correct, " +
    "COUNT(*), COALESCE(SUM(duration_ms), 0), COUNT(duration_ms) FROM attempts " +
    "GROUP BY 1, 2, 3, 4, 5"
  );
}

// The table, its triggers and the backfill. The caller owns the transaction.
function install(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS attempt_daily (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day     TEXT NOT NULL,
      source  TEXT NOT NULL,
      grade   TEXT NOT NULL,
      correct INTEGER NOT NULL,
      cnt     INTEGER NOT NULL,
      ms      INTEGER NOT NULL,
      samples INTEGER NOT NULL,
      PRIMARY KEY (user_id, day, source, grade, correct)
    ) WITHOUT ROWID;
    DROP TRIGGER IF EXISTS attempt_daily_insert;
    DROP TRIGGER IF EXISTS attempt_daily_delete;
    DROP TRIGGER IF EXISTS attempt_daily_update;
    CREATE TRIGGER attempt_daily_insert AFTER INSERT ON attempts BEGIN ${ADD} END;
    CREATE TRIGGER attempt_daily_delete AFTER DELETE ON attempts BEGIN ${REMOVE} END;
    CREATE TRIGGER attempt_daily_update
      AFTER UPDATE OF user_id, created_at, source, grade, correct, duration_ms ON attempts
      BEGIN ${REMOVE} ${ADD} END;
  `);
  rebuild(db);
}

module.exports = { install, rebuild };
