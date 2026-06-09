"use strict";

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const router  = express.Router();

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// POST /api/attempts
router.post("/", requireAuth, (req, res) => {
  const { cardId, correct, source } = req.body;
  if (!cardId || correct === undefined || !source)
    return res.status(400).json({ error: "cardId, correct, source required" });

  // Verify the card belongs to this user
  const card = db.prepare(
    "SELECT cards.id FROM cards " +
    "JOIN lessons ON cards.lesson_id = lessons.id " +
    "JOIN classes ON lessons.class_id = classes.id " +
    "WHERE cards.id = ? AND classes.user_id = ?"
  ).get(cardId, req.session.userId);
  if (!card) return res.status(404).json({ error: "Card not found" });

  db.prepare(
    "INSERT INTO attempts (id, card_id, user_id, correct, source) VALUES (?, ?, ?, ?, ?)"
  ).run(genId(), cardId, req.session.userId, correct ? 1 : 0, source);

  res.status(201).json({ ok: true });
});

module.exports = router;
