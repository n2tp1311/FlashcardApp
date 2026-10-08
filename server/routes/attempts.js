"use strict";

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const { ratingFor, cardFromState, MAX_INTERVAL, State } = require("../fsrs");
const { balanceDue, normalizeTz, settingsFrom } = require("../lib/workload");
const { snapshotState, restoredState, undoRefusal, STATE_FIELDS } = require("../lib/undo");
const { LEECH_LAPSES } = require("../lib/leech");
const { userScheduler, maybeAdapt } = require("../lib/memory");
const router  = express.Router();

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const MAX_DURATION_MS = 5 * 60 * 1000;

// "Due zero" needs to know that a day ended with nothing due, which no table remembers, so the
// answer that empties the due list writes it down. Today is the UTC day every stat uses.
function recordDueZero(userId) {
  const due = db.prepare(
    "SELECT 1 FROM card_states cs JOIN cards ca ON ca.id = cs.card_id JOIN lessons l ON l.id = ca.lesson_id " +
    "JOIN classes c ON c.id = l.class_id WHERE cs.user_id = ? AND c.user_id = ? AND c.archived = 0 " +
    "AND cs.srs_due_at IS NOT NULL AND cs.srs_due_at <= strftime('%s','now') LIMIT 1"
  ).get(userId, userId);
  if (!due) db.prepare("INSERT OR IGNORE INTO study_events (user_id, kind, ref) VALUES (?, 'due_zero', date('now'))").run(userId);
}

// A backgrounded/idle tab can leave a card "shown" for hours — clamp instead of trusting
// the raw client timestamp delta, so a single outlier can't blow up a "time studied" total.
function clampDuration(durationMs) {
  if (typeof durationMs !== "number" || !isFinite(durationMs)) return null;
  return Math.min(Math.max(0, durationMs), MAX_DURATION_MS);
}

// Only review intervals are balanced: learning steps are minutes, and moving one by a day
// would undo what the step is for.
function balancedDue(userId, cardId, now, dueAt, tz) {
  const row = db.prepare("SELECT preferences FROM users WHERE id = ?").get(userId);
  let prefs = {};
  try { prefs = JSON.parse((row && row.preferences) || "{}"); } catch (_) {}
  const settings = settingsFrom(prefs);
  if (!settings.enabled) return dueAt;
  // Wide enough for any fuzz range around this interval; the range itself is at most ±21 days.
  const span = dueAt - now + 30 * 86400;
  const dueTimes = db.prepare(
    "SELECT cs.srs_due_at FROM card_states cs JOIN cards ca ON ca.id = cs.card_id " +
    "JOIN lessons l ON l.id = ca.lesson_id JOIN classes c ON c.id = l.class_id " +
    "WHERE cs.user_id = ? AND c.user_id = ? AND c.archived = 0 AND cs.card_id != ? " +
    "AND cs.srs_due_at > ? AND cs.srs_due_at <= ?"
  ).all(userId, userId, cardId, now, now + span).map(r => r.srs_due_at);
  return balanceDue({ now, dueAt, maxInterval: MAX_INTERVAL, tzOffset: normalizeTz(tz), settings, dueTimes });
}

// POST /api/attempts
router.post("/", requireAuth, (req, res) => {
  const { cardId, correct, source, grade, durationMs, clientId, typed, tz } = req.body;
  if (!cardId || correct === undefined || !source)
    return res.status(400).json({ error: "cardId, correct, source required" });
  if (clientId !== undefined && (typeof clientId !== "string" || !/^c[a-z0-9]{20}$/.test(clientId)))
    return res.status(400).json({ error: "clientId must be 'c' followed by 20 lowercase letters or digits" });

  const userId = req.session.userId;

  // Verify the card belongs to this user
  const card = db.prepare(
    "SELECT cards.id FROM cards " +
    "JOIN lessons ON cards.lesson_id = lessons.id " +
    "JOIN classes ON lessons.class_id = classes.id " +
    "WHERE cards.id = ? AND classes.user_id = ?"
  ).get(cardId, userId);
  if (!card) return res.status(404).json({ error: "Card not found" });

  // The client resends an answer it couldn't confirm (offline, dropped response) under the same
  // clientId; one the server already recorded must not be scheduled a second time.
  if (clientId && db.prepare("SELECT 1 FROM attempts WHERE id = ? AND user_id = ?").get(clientId, userId))
    return res.status(200).json({ ok: true, duplicate: true });

  // One transaction, so a failure part-way can't leave an attempt row whose schedule update
  // never happened — a resend would then be skipped as a duplicate.
  const result = db.transaction(() => {
    // Answering an upstream-updated card is reviewing it. Only 'updated' — a "removed from
    // source" notice needs an explicit acknowledgement, not just another answer.
    db.prepare(
      "UPDATE cards SET upstream_change = NULL, upstream_changed_at = NULL, upstream_prev_data = NULL " +
      "WHERE id = ? AND upstream_change = 'updated'"
    ).run(cardId);

    const stateRow = db.prepare(
      "SELECT " + STATE_FIELDS.join(", ") + " FROM card_states WHERE card_id = ? AND user_id = ?"
    ).get(cardId, userId);
    const now = Math.floor(Date.now() / 1000);
    const nowDate = new Date(now * 1000);
    const notDue = !!(stateRow && stateRow.srs_due_at && stateRow.srs_due_at > now);

    db.prepare(
      "INSERT INTO attempts (id, card_id, user_id, correct, source, duration_ms, grade, prev_state, typed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(clientId || genId(), cardId, userId, correct ? 1 : 0, source, clampDuration(durationMs), grade || null,
          snapshotState(stateRow, notDue), typed === true ? 1 : null);

    // Card not yet due: record the attempt for analytics but leave the SRS schedule unchanged
    if (notDue) {
      return { ok: true, srs_due_at: stateRow.srs_due_at, capped: false, notDue: true };
    }

    const rating = ratingFor(correct, grade, source);
    const fsrsCard = cardFromState(stateRow, nowDate);
    const nextCard = userScheduler(db, userId).next(fsrsCard, nowDate, rating).card;
    let dueAt = Math.floor(nextCard.due.getTime() / 1000);
    if (nextCard.state === State.Review) dueAt = balancedDue(userId, cardId, now, dueAt, tz);

    // Quiz recognition can't earn as long an interval as an equivalent flashcard/recall
    // answer, by construction of the Hard-vs-Good rating mapping in ../fsrs.js — surfaced to
    // the client under the old field name so no client-side changes are needed for this signal.
    // A graded quiz answer comes from the "quiz answers count as Know It" preference, so it
    // isn't capped and is recorded as a flashcard-strength answer to keep it out of Needs Recall.
    const capped = source === "quiz" && !!correct && !grade;

    const correctSource = source === "quiz" && grade ? "flashcard" : source;
    const lastCorrectSource = correct ? correctSource : ((stateRow && stateRow.last_correct_source) || null);

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

    // became_leech only on the answer that crosses the threshold, so the study screen asks once.
    const base = (db.prepare("SELECT leech_base FROM card_states WHERE card_id = ? AND user_id = ?").get(cardId, userId) || {}).leech_base || 0;
    const prevLapses = (stateRow && stateRow.fsrs_lapses) || 0;
    const becameLeech = nextCard.lapses > prevLapses && nextCard.lapses - base === LEECH_LAPSES;

    return { ok: true, srs_due_at: dueAt, capped: capped, notDue: false,
             lapses: Math.max(0, nextCard.lapses - base), became_leech: becameLeech };
  })();

  recordDueZero(userId);
  res.status(201).json(result);
  // After the response: a fit takes a second or more and must not hold up the next card.
  if (!result.notDue) setImmediate(() => { maybeAdapt(db, userId, tz).catch(() => {}); });
});

// DELETE /api/attempts/:id — undo the card's latest answer: the attempt is removed and the
// schedule put back from the snapshot taken when it was recorded. Removing the row, rather
// than marking it, keeps every stat (streak, daily goal, accuracy) as if it was never given.
// The upstream "updated" flag the answer cleared stays cleared: it was seen either way.
router.delete("/:id", requireAuth, (req, res) => {
  const userId = req.session.userId;
  const result = db.transaction(() => {
    const attempt = db.prepare(
      "SELECT rowid, card_id, created_at, prev_state FROM attempts WHERE id = ? AND user_id = ?"
    ).get(req.params.id, userId);
    // rowid, not created_at: two answers in the same second must still be ordered.
    const later = attempt && db.prepare(
      "SELECT 1 FROM attempts WHERE card_id = ? AND user_id = ? AND rowid > ?"
    ).get(attempt.card_id, userId, attempt.rowid);
    const refusal = undoRefusal(attempt, Math.floor(Date.now() / 1000), !!later);
    if (refusal) return { refusal };

    const restored = restoredState(attempt.prev_state);
    if (restored) {
      db.prepare(
        "UPDATE card_states SET " + STATE_FIELDS.map(f => f + " = ?").join(", ") +
        " WHERE card_id = ? AND user_id = ?"
      ).run(...STATE_FIELDS.map(f => restored[f]), attempt.card_id, userId);
    }
    db.prepare("DELETE FROM attempts WHERE rowid = ?").run(attempt.rowid);
    return { ok: true, srs_due_at: restored ? restored.srs_due_at : undefined };
  })();

  if (result.refusal) {
    return res.status(result.refusal === "not_found" ? 404 : 409)
      .json({ error: "This answer can no longer be undone (" + result.refusal + ")", code: "undoExpired" });
  }
  res.json(result);
});

module.exports = router;
