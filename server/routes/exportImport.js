"use strict";

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const { rateLimit, byUser } = require("../middleware/rateLimit");
// Two separate routers, not one mounted at both /api/export and /api/import — a
// single shared router responds to BOTH verbs at BOTH mount points (GET /api/import
// would silently run the export handler and consume exportLimiter's quota; POST
// /api/export would run the import handler under a URL that looks read-only). Kept
// in one file since both handlers share genId() and the same DB shape.
const exportRouter = express.Router();
const importRouter = express.Router();

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Each of these does several synchronous whole-table scans (export) or a
// transaction inserting every row of a full account dump (import) — the queries
// themselves are already properly scoped by user_id (no N+1/unbounded-aggregation
// bug to fix here, unlike share.js/cards.js), but neither had any throttling
// against being hit repeatedly in a loop. Keyed by userId, not IP — both sit behind
// requireAuth, and IP-keying would let unrelated accounts on the same office/campus
// NAT exhaust each other's quota.
const exportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: "Too many export requests. Try again later.", keyFn: byUser });
const importLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: "Too many import requests. Try again later.", keyFn: byUser });

// GET /api/export
exportRouter.get("/", requireAuth, exportLimiter, (req, res) => {
  const userId = req.session.userId;
  const classes = db.prepare("SELECT * FROM classes WHERE user_id = ?").all(userId);
  const lessons = db.prepare(
    "SELECT l.* FROM lessons l JOIN classes c ON l.class_id = c.id WHERE c.user_id = ?"
  ).all(userId);
  const cards = db.prepare(
    "SELECT cards.* FROM cards " +
    "JOIN lessons ON cards.lesson_id = lessons.id " +
    "JOIN classes ON lessons.class_id = classes.id " +
    "WHERE classes.user_id = ?"
  ).all(userId).map(c => ({ ...c, data: JSON.parse(c.data) }));
  const attempts = db.prepare("SELECT * FROM attempts WHERE user_id = ?").all(userId);
  const states   = db.prepare("SELECT * FROM card_states WHERE user_id = ?").all(userId);

  res.json({ classes, lessons, cards, attempts, states, exportedAt: Date.now() });
});

// POST /api/import
importRouter.post("/", requireAuth, importLimiter, (req, res) => {
  const userId = req.session.userId;
  const { classes = [], lessons = [], cards = [], attempts = [], states = [] } = req.body;

  const idMap = {}; // old id → new id

  db.transaction(() => {
    classes.forEach(cls => {
      const newId = genId();
      idMap[cls.id] = newId;
      db.prepare(
        "INSERT OR IGNORE INTO classes (id, user_id, name, color, icon, sort_order, level, archived, created_at, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(newId, userId, cls.name, cls.color || "#2563eb", cls.icon || "book", cls.sort_order || 0, cls.level ?? null, cls.archived ? 1 : 0, cls.created_at || Math.floor(Date.now()/1000), cls.tags || null);
    });

    lessons.forEach(les => {
      const newId = genId();
      idMap[les.id] = newId;
      const classId = idMap[les.class_id] || les.class_id;
      db.prepare(
        "INSERT OR IGNORE INTO lessons (id, class_id, title, format, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(newId, classId, les.title, les.format, les.sort_order || 0, les.created_at || Math.floor(Date.now()/1000));
    });

    cards.forEach(card => {
      const newId = genId();
      idMap[card.id] = newId;
      const lessonId = idMap[card.lesson_id] || card.lesson_id;
      db.prepare(
        "INSERT OR IGNORE INTO cards (id, lesson_id, format, data, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(newId, lessonId, card.format, JSON.stringify(card.data), card.sort_order || 0, card.created_at || Math.floor(Date.now()/1000));
    });

    attempts.forEach(att => {
      const cardId = idMap[att.card_id] || att.card_id;
      db.prepare(
        "INSERT OR IGNORE INTO attempts (id, card_id, user_id, correct, source, created_at, duration_ms, grade) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(genId(), cardId, userId, att.correct, att.source || "flashcard", att.created_at || Math.floor(Date.now()/1000),
            att.duration_ms ?? null, att.grade ?? null);
    });

    states.forEach(s => {
      const cardId = idMap[s.card_id] || s.card_id;
      db.prepare(
        "INSERT OR REPLACE INTO card_states (card_id, user_id, known, updated_at, last_seen_at, srs_step, srs_due_at, " +
        "fsrs_stability, fsrs_difficulty, fsrs_state, fsrs_reps, fsrs_lapses, fsrs_learning_steps, fsrs_last_review_at, last_correct_source) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(cardId, userId, s.known, s.updated_at || Math.floor(Date.now()/1000), s.last_seen_at ?? null,
            s.srs_step ?? 0, s.srs_due_at ?? null, s.fsrs_stability ?? null, s.fsrs_difficulty ?? null,
            s.fsrs_state ?? 0, s.fsrs_reps ?? 0, s.fsrs_lapses ?? 0, s.fsrs_learning_steps ?? 0,
            s.fsrs_last_review_at ?? null, s.last_correct_source ?? null);
    });
  })();

  res.json({ ok: true, imported: { classes: classes.length, lessons: lessons.length, cards: cards.length } });
});

module.exports = { exportRouter, importRouter };
