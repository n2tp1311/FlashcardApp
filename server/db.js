"use strict";

const path = require("path");
const fs   = require("fs");
const { Database } = require("node-sqlite3-wasm");

const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Remove stale lock left by a crashed process
const lockPath = path.join(DATA_DIR, "flashcards.db.lock");
try { fs.rmSync(lockPath, { recursive: true, force: true }); } catch (_) {}

const db = new Database(path.join(DATA_DIR, "flashcards.db"));

db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    password_hash TEXT,
    google_id     TEXT UNIQUE,
    avatar_url    TEXT,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS classes (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#2563eb',
    icon       TEXT NOT NULL DEFAULT '📚',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS lessons (
    id         TEXT PRIMARY KEY,
    class_id   TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    format     TEXT NOT NULL CHECK (format IN ('term-def','mcq')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS cards (
    id         TEXT PRIMARY KEY,
    lesson_id  TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    format     TEXT NOT NULL CHECK (format IN ('term-def','mcq')),
    data       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS attempts (
    id         TEXT PRIMARY KEY,
    card_id    TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    correct    INTEGER NOT NULL CHECK (correct IN (0,1)),
    source     TEXT NOT NULL CHECK (source IN ('quiz','flashcard','recall')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS card_states (
    card_id    TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    known      INTEGER,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (card_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS class_share_links (
    class_id   TEXT PRIMARY KEY REFERENCES classes(id) ON DELETE CASCADE,
    token      TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS class_invites (
    id         TEXT PRIMARY KEY,
    class_id   TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (class_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS quiz_sessions (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_ids     TEXT NOT NULL,
    score          INTEGER NOT NULL,
    total          INTEGER NOT NULL,
    taken_at       INTEGER NOT NULL DEFAULT (unixepoch()),
    next_review_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT PRIMARY KEY,
    sess    TEXT NOT NULL,
    expired INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);

  CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user ON quiz_sessions(user_id);

  CREATE INDEX IF NOT EXISTS idx_classes_user   ON classes(user_id);
  CREATE INDEX IF NOT EXISTS idx_lessons_class  ON lessons(class_id);
  CREATE INDEX IF NOT EXISTS idx_cards_lesson   ON cards(lesson_id);
  CREATE INDEX IF NOT EXISTS idx_attempts_card  ON attempts(card_id);
  CREATE INDEX IF NOT EXISTS idx_attempts_user  ON attempts(user_id);
  CREATE INDEX IF NOT EXISTS idx_attempts_cu    ON attempts(card_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_states_user    ON card_states(user_id);
  CREATE INDEX IF NOT EXISTS idx_invites_user   ON class_invites(user_id);
  CREATE INDEX IF NOT EXISTS idx_invites_class  ON class_invites(class_id);
`);

// Schema migration tracking — each migration runs exactly once
try { db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)"); } catch (_) {}

function runMigration(name, fn) {
  try {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(name)) return;
    fn();
    db.prepare("INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)").run(name);
  } catch (_) {
    try { db.exec("PRAGMA foreign_keys = ON"); } catch (__) {}
  }
}

// Migration: allow 'recall' as a source value in attempts table
runMigration("attempts_recall_source", function() {
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(`
    CREATE TABLE IF NOT EXISTS attempts_v2 (
      id         TEXT PRIMARY KEY,
      card_id    TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      correct    INTEGER NOT NULL CHECK (correct IN (0,1)),
      source     TEXT NOT NULL CHECK (source IN ('quiz','flashcard','recall')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    INSERT OR IGNORE INTO attempts_v2 SELECT * FROM attempts;
    DROP TABLE attempts;
    ALTER TABLE attempts_v2 RENAME TO attempts;
  `);
  db.exec("PRAGMA foreign_keys = ON");
});

// Migration: remove CHECK constraint on lessons.format to support image-def
runMigration("lessons_remove_format_check", function() {
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(`
    CREATE TABLE IF NOT EXISTS lessons_v2 (
      id         TEXT PRIMARY KEY,
      class_id   TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      format     TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    INSERT OR IGNORE INTO lessons_v2 SELECT * FROM lessons;
    DROP TABLE lessons;
    ALTER TABLE lessons_v2 RENAME TO lessons;
  `);
  db.exec("PRAGMA foreign_keys = ON");
});

// Migration: remove CHECK constraint on cards.format to support image-def
runMigration("cards_remove_format_check", function() {
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards_v2 (
      id         TEXT PRIMARY KEY,
      lesson_id  TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      format     TEXT NOT NULL,
      data       TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    INSERT OR IGNORE INTO cards_v2 SELECT * FROM cards;
    DROP TABLE cards;
    ALTER TABLE cards_v2 RENAME TO cards;
  `);
  db.exec("PRAGMA foreign_keys = ON");
});

try { db.exec("CREATE INDEX IF NOT EXISTS idx_lessons_class ON lessons(class_id)"); } catch (_) {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_cards_lesson ON cards(lesson_id)"); } catch (_) {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_states_user_due ON card_states(user_id, srs_due_at)"); } catch (_) {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_attempts_cu_created ON attempts(card_id, user_id, created_at)"); } catch (_) {}
// GET /api/stats/analytics runs several windowed queries (heatmap, weekly trend, accuracy
// by source, total duration, struggling lessons) all filtered by user_id + created_at range
// with no card_id predicate — the existing (card_id, user_id, created_at) index can't help there.
try { db.exec("CREATE INDEX IF NOT EXISTS idx_attempts_user_created ON attempts(user_id, created_at)"); } catch (_) {}

// Migration: add preferences JSON column to users
try { db.exec("ALTER TABLE users ADD COLUMN preferences TEXT"); } catch (_) {}

// Migration: add level column to classes for manual course ordering
try { db.exec("ALTER TABLE classes ADD COLUMN level INTEGER"); } catch (_) {}

// Migration: add archived flag to classes — archived classes are excluded from due/review aggregation
try { db.exec("ALTER TABLE classes ADD COLUMN archived INTEGER NOT NULL DEFAULT 0"); } catch (_) {}

// Migration: add last_seen_at to card_states for per-card visit tracking
try { db.exec("ALTER TABLE card_states ADD COLUMN last_seen_at INTEGER"); } catch (_) {}

// Migration: per-card SRS intervals
try { db.exec("ALTER TABLE card_states ADD COLUMN srs_step INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE card_states ADD COLUMN srs_due_at INTEGER"); } catch (_) {}

// Migration: track time spent per attempt (client-measured, clamped server-side)
try { db.exec("ALTER TABLE attempts ADD COLUMN duration_ms INTEGER"); } catch (_) {}

// Migration: persist the client-submitted self-grade (easy/hard) on each attempt —
// previously received in the request body and used to compute srs_step, then discarded
try { db.exec("ALTER TABLE attempts ADD COLUMN grade TEXT"); } catch (_) {}

// Migration: free-text tags on classes, stored as a JSON array string
try { db.exec("ALTER TABLE classes ADD COLUMN tags TEXT"); } catch (_) {}

// Migration: FSRS scheduler state, replacing the fixed srs_step ladder. srs_due_at is
// reused as-is (still "when this card is next due", just computed differently now), so
// this only adds genuinely new columns. srs_step is left in place, inert, rather than
// dropped — nothing writes it anymore after this, and dropping columns is unnecessary
// risk on a table that's had a real corruption incident before.
try { db.exec("ALTER TABLE card_states ADD COLUMN fsrs_stability REAL"); } catch (_) {}
try { db.exec("ALTER TABLE card_states ADD COLUMN fsrs_difficulty REAL"); } catch (_) {}
try { db.exec("ALTER TABLE card_states ADD COLUMN fsrs_state INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE card_states ADD COLUMN fsrs_reps INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE card_states ADD COLUMN fsrs_lapses INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE card_states ADD COLUMN fsrs_learning_steps INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE card_states ADD COLUMN fsrs_last_review_at INTEGER"); } catch (_) {}
try { db.exec("ALTER TABLE card_states ADD COLUMN last_correct_source TEXT"); } catch (_) {}

// Shim: node-sqlite3-wasm requires array binding for multiple params.
// Wrap db.prepare so statements accept spread args like better-sqlite3.
const _prepare = db.prepare.bind(db);
db.prepare = function(sql) {
  const stmt = _prepare(sql);
  function toArg(args) {
    if (args.length === 0) return [];
    if (args.length === 1) return args[0];  // single value/array/object → passthrough
    return args;                             // multiple spread args → wrap as array
  }
  return {
    run: (...args) => stmt.run(toArg(args)),
    get: (...args) => stmt.get(toArg(args)),
    all: (...args) => stmt.all(toArg(args)),
  };
};

// node-sqlite3-wasm has no .transaction() — implement with BEGIN/COMMIT/ROLLBACK.
db.transaction = function(fn) {
  return function(...args) {
    db.exec("BEGIN");
    try {
      const result = fn(...args);
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
};

// One-time backfill: estimate initial FSRS stability/difficulty for cards that already
// had SRS progress under the old fixed-step ladder, so existing users don't get bumped
// back to "brand new" on migration day. srs_due_at is deliberately left untouched — this
// only fills in the new fsrs_* columns, it never reschedules anything. Must run after the
// db.prepare shim above (this uses multi-param .run() calls, which need array binding).
runMigration("fsrs_backfill_from_srs_step", function() {
  // Frozen snapshot of the old ladder's interval table. Copied here rather than imported
  // from attempts.js, since that file's ladder is removed once FSRS lands — this migration
  // must stay correct and reproducible independent of that file's later contents.
  var OLD_SRS_INTERVALS = [600, 3600, 14400, 86400, 259200, 604800, 1814400];
  var OLD_SRS_MAX_INTERVAL = 365 * 86400;
  function oldGetInterval(step) {
    if (step < OLD_SRS_INTERVALS.length) return OLD_SRS_INTERVALS[step];
    var extra = step - (OLD_SRS_INTERVALS.length - 1);
    return Math.min(OLD_SRS_INTERVALS[OLD_SRS_INTERVALS.length - 1] * Math.pow(2, extra), OLD_SRS_MAX_INTERVAL);
  }
  var DEFAULT_DIFFICULTY = 5.0; // neutral midpoint of FSRS's 1-10 scale — no per-card
                                 // difficulty signal exists in the old data to do better

  var rows = db.prepare(
    "SELECT card_id, user_id, srs_step, srs_due_at FROM card_states WHERE srs_due_at IS NOT NULL"
  ).all();
  rows.forEach(function(r) {
    var stabilityDays = oldGetInterval(r.srs_step || 0) / 86400;
    var state = (r.srs_step || 0) === 0 ? 1 /* Learning */ : 2 /* Review */;
    db.prepare(
      "UPDATE card_states SET fsrs_stability = ?, fsrs_difficulty = ?, fsrs_state = ?, " +
      "fsrs_reps = 1, fsrs_lapses = 0 WHERE card_id = ? AND user_id = ?"
    ).run(stabilityDays, DEFAULT_DIFFICULTY, state, r.card_id, r.user_id);
  });

  // Backfill last_correct_source from real attempt history, powering the redesigned
  // Needs Recall filter (which used to infer this from srs_step position).
  db.exec(
    "UPDATE card_states SET last_correct_source = (" +
    "  SELECT a.source FROM attempts a" +
    "  WHERE a.card_id = card_states.card_id AND a.user_id = card_states.user_id AND a.correct = 1" +
    "  ORDER BY a.created_at DESC LIMIT 1" +
    ") WHERE last_correct_source IS NULL"
  );
});

module.exports = db;
