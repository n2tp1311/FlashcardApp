"use strict";

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const router  = express.Router();

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// GET /api/export
router.get("/", requireAuth, (req, res) => {
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
router.post("/", requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { classes = [], lessons = [], cards = [], attempts = [], states = [] } = req.body;

  const idMap = {}; // old id → new id

  db.transaction(() => {
    classes.forEach(cls => {
      const newId = genId();
      idMap[cls.id] = newId;
      db.prepare(
        "INSERT OR IGNORE INTO classes (id, user_id, name, color, icon, sort_order, level, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(newId, userId, cls.name, cls.color || "#2563eb", cls.icon || "📚", cls.sort_order || 0, cls.level ?? null, cls.archived ? 1 : 0, cls.created_at || Math.floor(Date.now()/1000));
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
        "INSERT OR IGNORE INTO attempts (id, card_id, user_id, correct, source, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(genId(), cardId, userId, att.correct, att.source || "flashcard", att.created_at || Math.floor(Date.now()/1000));
    });

    states.forEach(s => {
      const cardId = idMap[s.card_id] || s.card_id;
      db.prepare(
        "INSERT OR REPLACE INTO card_states (card_id, user_id, known, updated_at) VALUES (?, ?, ?, ?)"
      ).run(cardId, userId, s.known, s.updated_at || Math.floor(Date.now()/1000));
    });
  })();

  res.json({ ok: true, imported: { classes: classes.length, lessons: lessons.length, cards: cards.length } });
});

module.exports = router;
