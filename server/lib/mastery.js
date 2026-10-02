"use strict";

// Mastered means a Review card scheduled 21 days or more out, Anki's "mature" line and a
// bucket edge of the dashboard's Memory Interval chart, so the two agree. Shared by the
// lesson mastery bar and the achievements, which must call the same cards mastered.
const MASTERED_INTERVAL_SEC = 21 * 86400;

// SQL condition over a card_states row aliased `cs`; binds MASTERED_INTERVAL_SEC once.
const MASTERED_SQL =
  "(cs.fsrs_stability IS NOT NULL AND cs.fsrs_state = 2 AND " +
  "cs.srs_due_at - COALESCE(cs.fsrs_last_review_at, cs.updated_at) >= ?)";

module.exports = { MASTERED_INTERVAL_SEC, MASTERED_SQL };
