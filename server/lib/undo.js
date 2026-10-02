"use strict";

// Undoing a flashcard grade puts the card's schedule back exactly as it was before that
// answer. Re-deriving it is not possible: FSRS state is not invertible, so the attempt row
// stores a snapshot of the fields it is about to overwrite.

const STATE_FIELDS = [
  "srs_due_at", "fsrs_stability", "fsrs_difficulty", "fsrs_state", "fsrs_reps", "fsrs_lapses",
  "fsrs_learning_steps", "fsrs_last_review_at", "last_correct_source"
];

// What a card that was never scheduled has: the column defaults in server/db.js.
const NEVER_SCHEDULED = {
  srs_due_at: null, fsrs_stability: null, fsrs_difficulty: null, fsrs_state: 0, fsrs_reps: 0,
  fsrs_lapses: 0, fsrs_learning_steps: 0, fsrs_last_review_at: null, last_correct_source: null
};

// Long enough to notice a misclick after the next card is up, short enough that an undo
// cannot rewrite a schedule other answers have since been built on.
const UNDO_WINDOW_SEC = 10 * 60;

// The snapshot stored in attempts.prev_state. A not-yet-due answer leaves the schedule alone,
// so there is nothing to restore; that is recorded explicitly so it is never confused with a
// row written before this column existed (NULL), which cannot be undone.
function snapshotState(row, notDue) {
  if (notDue) return JSON.stringify({ notDue: true });
  if (!row) return JSON.stringify({ row: null });
  const kept = {};
  STATE_FIELDS.forEach(f => { kept[f] = row[f] === undefined ? null : row[f]; });
  return JSON.stringify({ row: kept });
}

// The card_states values to write back, or null when the schedule should be left as it is.
function restoredState(prevState) {
  const snap = JSON.parse(prevState);
  if (snap.notDue) return null;
  return Object.assign({}, NEVER_SCHEDULED, snap.row || {});
}

// Why an undo is refused, or null when it may go ahead. Only the card's latest answer can be
// undone: restoring an older snapshot would erase the later answers' effect on the schedule.
function undoRefusal(attempt, nowSec, hasLaterAttempt) {
  if (!attempt) return "not_found";
  if (attempt.prev_state == null) return "not_undoable";
  if (nowSec - attempt.created_at > UNDO_WINDOW_SEC) return "too_old";
  if (hasLaterAttempt) return "not_latest";
  return null;
}

module.exports = { STATE_FIELDS, NEVER_SCHEDULED, UNDO_WINDOW_SEC, snapshotState, restoredState, undoRefusal };
