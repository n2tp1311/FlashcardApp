"use strict";

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const router  = express.Router();

// 10min, 1h, 4h, 1d, 3d, 7d, 21d — then doubles each step, capped at 1 year
const SRS_INTERVALS = [600, 3600, 14400, 86400, 259200, 604800, 1814400];
const SRS_MAX_INTERVAL = 365 * 86400;

function getInterval(step) {
  if (step < SRS_INTERVALS.length) return SRS_INTERVALS[step];
  const extra = step - (SRS_INTERVALS.length - 1);
  return Math.min(SRS_INTERVALS[SRS_INTERVALS.length - 1] * Math.pow(2, extra), SRS_MAX_INTERVAL);
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// POST /api/attempts
router.post("/", requireAuth, (req, res) => {
  const { cardId, correct, source, grade } = req.body;
  if (!cardId || correct === undefined || !source)
    return res.status(400).json({ error: "cardId, correct, source required" });

  const userId = req.session.userId;

  // Verify the card belongs to this user
  const card = db.prepare(
    "SELECT cards.id FROM cards " +
    "JOIN lessons ON cards.lesson_id = lessons.id " +
    "JOIN classes ON lessons.class_id = classes.id " +
    "WHERE cards.id = ? AND classes.user_id = ?"
  ).get(cardId, userId);
  if (!card) return res.status(404).json({ error: "Card not found" });

  db.prepare(
    "INSERT INTO attempts (id, card_id, user_id, correct, source) VALUES (?, ?, ?, ?, ?)"
  ).run(genId(), cardId, userId, correct ? 1 : 0, source);

  // Update per-card SRS: correct → advance step, wrong → reset to 0
  const stateRow = db.prepare(
    "SELECT srs_step, srs_due_at FROM card_states WHERE card_id = ? AND user_id = ?"
  ).get(cardId, userId);
  const curStep = stateRow ? (stateRow.srs_step || 0) : 0;
  const now = Math.floor(Date.now() / 1000);

  // Card not yet due: record the attempt for analytics but leave the SRS schedule unchanged
  if (stateRow && stateRow.srs_due_at && stateRow.srs_due_at > now) {
    return res.status(201).json({ ok: true, srs_step: curStep, srs_due_at: stateRow.srs_due_at });
  }

  let newStep;
  if (grade === "easy")        newStep = curStep + 2;
  else if (grade === "medium") newStep = curStep + 1;
  else if (grade === "hard")   newStep = 0;
  else                         newStep = correct ? curStep + 1 : 0;
  const dueAt = now + getInterval(newStep);
  db.prepare(
    "INSERT INTO card_states (card_id, user_id, srs_step, srs_due_at) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(card_id, user_id) DO UPDATE SET srs_step = excluded.srs_step, srs_due_at = excluded.srs_due_at"
  ).run(cardId, userId, newStep, dueAt);

  res.status(201).json({ ok: true, srs_step: newStep, srs_due_at: dueAt });
});

module.exports = router;
