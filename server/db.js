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

// Migration: allow 'recall' as a source value in attempts table
try {
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
} catch (_) {
  db.exec("PRAGMA foreign_keys = ON");
}

// Migration: add last_seen_at to card_states for per-card visit tracking
try { db.exec("ALTER TABLE card_states ADD COLUMN last_seen_at INTEGER"); } catch (_) {}

// Migration: per-card SRS intervals
try { db.exec("ALTER TABLE card_states ADD COLUMN srs_step INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE card_states ADD COLUMN srs_due_at INTEGER"); } catch (_) {}

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

module.exports = db;
