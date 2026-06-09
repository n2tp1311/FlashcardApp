"use strict";

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const router  = express.Router();

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function ownLesson(lessonId, userId) {
  return db.prepare(
    "SELECT l.id, l.format FROM lessons l JOIN classes c ON l.class_id = c.id WHERE l.id = ? AND c.user_id = ?"
  ).get(lessonId, userId);
}

function ownCard(cardId, userId) {
  return db.prepare(
    "SELECT cards.id, cards.lesson_id FROM cards " +
    "JOIN lessons ON cards.lesson_id = lessons.id " +
    "JOIN classes ON lessons.class_id = classes.id " +
    "WHERE cards.id = ? AND classes.user_id = ?"
  ).get(cardId, userId);
}

// GET /api/lessons/:lessonId/cards
router.get("/lessons/:lessonId/cards", requireAuth, (req, res) => {
  if (!ownLesson(req.params.lessonId, req.session.userId))
    return res.status(404).json({ error: "Not found" });
  const rows = db.prepare(
    "SELECT * FROM cards WHERE lesson_id = ? ORDER BY sort_order, created_at"
  ).all(req.params.lessonId);
  // Parse data JSON
  res.json(rows.map(r => ({ ...r, data: JSON.parse(r.data) })));
});

// POST /api/lessons/:lessonId/cards
router.post("/lessons/:lessonId/cards", requireAuth, (req, res) => {
  const lesson = ownLesson(req.params.lessonId, req.session.userId);
  if (!lesson) return res.status(404).json({ error: "Not found" });
  const { format, data } = req.body;
  if (!format || !data) return res.status(400).json({ error: "format and data required" });
  const count = db.prepare("SELECT COUNT(*) as n FROM cards WHERE lesson_id = ?")
    .get(req.params.lessonId).n;
  const id = genId();
  db.prepare(
    "INSERT INTO cards (id, lesson_id, format, data, sort_order) VALUES (?, ?, ?, ?, ?)"
  ).run(id, req.params.lessonId, format, JSON.stringify(data), count);
  const card = db.prepare("SELECT * FROM cards WHERE id = ?").get(id);
  res.status(201).json({ ...card, data: JSON.parse(card.data) });
});

// POST /api/lessons/:lessonId/cards/bulk
router.post("/lessons/:lessonId/cards/bulk", requireAuth, (req, res) => {
  const lesson = ownLesson(req.params.lessonId, req.session.userId);
  if (!lesson) return res.status(404).json({ error: "Not found" });
  const { cards } = req.body;
  if (!Array.isArray(cards) || cards.length === 0)
    return res.status(400).json({ error: "cards array required" });

  const startOrder = db.prepare("SELECT COUNT(*) as n FROM cards WHERE lesson_id = ?")
    .get(req.params.lessonId).n;

  const insert = db.prepare(
    "INSERT INTO cards (id, lesson_id, format, data, sort_order) VALUES (?, ?, ?, ?, ?)"
  );
  const insertMany = db.transaction((items) => {
    return items.map((c, i) => {
      const id = genId();
      insert.run(id, req.params.lessonId, c.format, JSON.stringify(c.data), startOrder + i);
      return id;
    });
  });

  const ids = insertMany(cards);
  const created = db.prepare(
    `SELECT * FROM cards WHERE id IN (${ids.map(() => "?").join(",")})`
  ).all(...ids);
  res.status(201).json(created.map(r => ({ ...r, data: JSON.parse(r.data) })));
});

// PUT /api/cards/:id  (router mounted at /api, so prefix needed)
router.put("/cards/:id", requireAuth, (req, res) => {
  const card = ownCard(req.params.id, req.session.userId);
  if (!card) return res.status(404).json({ error: "Not found" });
  const existing = db.prepare("SELECT * FROM cards WHERE id = ?").get(req.params.id);
  const { data, sort_order } = req.body;
  db.prepare("UPDATE cards SET data = ?, sort_order = ? WHERE id = ?")
    .run(
      data       ? JSON.stringify(data) : existing.data,
      sort_order ?? existing.sort_order,
      req.params.id
    );
  const updated = db.prepare("SELECT * FROM cards WHERE id = ?").get(req.params.id);
  res.json({ ...updated, data: JSON.parse(updated.data) });
});

// DELETE /api/cards/:id
router.delete("/cards/:id", requireAuth, (req, res) => {
  if (!ownCard(req.params.id, req.session.userId))
    return res.status(404).json({ error: "Not found" });
  db.prepare("DELETE FROM cards WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

// PUT /api/cards/states/:cardId
router.put("/cards/states/:cardId", requireAuth, (req, res) => {
  if (!ownCard(req.params.cardId, req.session.userId))
    return res.status(404).json({ error: "Not found" });
  const { known } = req.body;
  db.prepare(
    "INSERT INTO card_states (card_id, user_id, known, updated_at) VALUES (?, ?, ?, unixepoch()) " +
    "ON CONFLICT(card_id, user_id) DO UPDATE SET known = excluded.known, updated_at = unixepoch()"
  ).run(req.params.cardId, req.session.userId, known ? 1 : 0);
  res.json({ ok: true });
});

// GET /api/lessons/:lessonId/states  (already correct — no prefix change needed)
router.get("/lessons/:lessonId/states", requireAuth, (req, res) => {
  if (!ownLesson(req.params.lessonId, req.session.userId))
    return res.status(404).json({ error: "Not found" });
  const rows = db.prepare(
    "SELECT cs.card_id, cs.known FROM card_states cs " +
    "JOIN cards ON cs.card_id = cards.id " +
    "WHERE cards.lesson_id = ? AND cs.user_id = ?"
  ).all(req.params.lessonId, req.session.userId);
  const map = {};
  rows.forEach(r => { map[r.card_id] = r.known === 1; });
  res.json(map);
});

module.exports = router;
