"use strict";

// Mastered means a Review card scheduled 21 days or more out, Anki's "mature" line and a
// bucket edge of the dashboard's Memory Interval chart, so the two agree. Shared by the
// lesson mastery bar and the achievements, which must call the same cards mastered.
const MASTERED_INTERVAL_SEC = 21 * 86400;

// SQL condition over a card_states row aliased `cs`; binds MASTERED_INTERVAL_SEC once.
const MASTERED_SQL =
  "(cs.fsrs_stability IS NOT NULL AND cs.fsrs_state = 2 AND " +
  "cs.srs_due_at - COALESCE(cs.fsrs_last_review_at, cs.updated_at) >= ?)";

// Study now's new card: one with no due date. Not "no card_states row": showing a card without
// grading it (last_seen_at) or toggling Know It writes a row with no schedule, and a card counted
// by the row alone was neither new nor due, so Study now never offered it while the mastery bar
// still showed it as New. srs_due_at, not fsrs_stability, so a card can never be both due and new.
const UNSCHEDULED_SQL = "(cs.card_id IS NULL OR cs.srs_due_at IS NULL)";

module.exports = { MASTERED_INTERVAL_SEC, MASTERED_SQL, UNSCHEDULED_SQL };
