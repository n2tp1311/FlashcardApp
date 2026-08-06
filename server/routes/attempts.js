"use strict";

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const { scheduler, ratingFor, cardFromState } = require("../fsrs");
const router  = express.Router();

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const MAX_DURATION_MS = 5 * 60 * 1000;

// A backgrounded/idle tab can leave a card "shown" for hours — clamp instead of trusting
// the raw client timestamp delta, so a single outlier can't blow up a "time studied" total.
function clampDuration(durationMs) {
  if (typeof durationMs !== "number" || !isFinite(durationMs)) return null;
  return Math.min(Math.max(0, durationMs), MAX_DURATION_MS);
}

// POST /api/attempts
router.post("/", requireAuth, (req, res) => {
  const { cardId, correct, source, grade, durationMs } = req.body;
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
    "INSERT INTO attempts (id, card_id, user_id, correct, source, duration_ms, grade) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(genId(), cardId, userId, correct ? 1 : 0, source, clampDuration(durationMs), grade || null);

  const stateRow = db.prepare(
    "SELECT srs_due_at, fsrs_stability, fsrs_difficulty, fsrs_state, fsrs_reps, fsrs_lapses, " +
    "fsrs_learning_steps, fsrs_last_review_at, last_correct_source FROM card_states WHERE card_id = ? AND user_id = ?"
  ).get(cardId, userId);
  const now = Math.floor(Date.now() / 1000);
  const nowDate = new Date(now * 1000);

  // Card not yet due: record the attempt for analytics but leave the SRS schedule unchanged
  if (stateRow && stateRow.srs_due_at && stateRow.srs_due_at > now) {
    return res.status(201).json({ ok: true, srs_due_at: stateRow.srs_due_at, capped: false, notDue: true });
  }

  const rating = ratingFor(correct, grade, source);
  const fsrsCard = cardFromState(stateRow, nowDate);
  const nextCard = scheduler.next(fsrsCard, nowDate, rating).card;
  const dueAt = Math.floor(nextCard.due.getTime() / 1000);

  // Quiz recognition can't earn as long an interval as an equivalent flashcard/recall
  // answer, by construction of the Hard-vs-Good rating mapping in ../fsrs.js — surfaced to
  // the client under the old field name so no client-side changes are needed for this signal.
  const capped = source === "quiz" && !!correct;

  const lastCorrectSource = correct ? source : ((stateRow && stateRow.last_correct_source) || null);

  db.prepare(
    "INSERT INTO card_states (card_id, user_id, srs_due_at, fsrs_stability, fsrs_difficulty, " +
    "fsrs_state, fsrs_reps, fsrs_lapses, fsrs_learning_steps, fsrs_last_review_at, last_correct_source) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(card_id, user_id) DO UPDATE SET srs_due_at = excluded.srs_due_at, " +
    "fsrs_stability = excluded.fsrs_stability, fsrs_difficulty = excluded.fsrs_difficulty, " +
    "fsrs_state = excluded.fsrs_state, fsrs_reps = excluded.fsrs_reps, fsrs_lapses = excluded.fsrs_lapses, " +
    "fsrs_learning_steps = excluded.fsrs_learning_steps, fsrs_last_review_at = excluded.fsrs_last_review_at, " +
    "last_correct_source = excluded.last_correct_source"
  ).run(cardId, userId, dueAt, nextCard.stability, nextCard.difficulty, nextCard.state,
        nextCard.reps, nextCard.lapses, nextCard.learning_steps, now, lastCorrectSource);

  res.status(201).json({ ok: true, srs_due_at: dueAt, capped: capped, notDue: false });
});

module.exports = router;
