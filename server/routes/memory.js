"use strict";

// How much to remember and adapting to the learner (lib/memory.js). Both settings are
// saved with the other preferences and adapting runs after answers, so this route only
// reports: reviews a day at each choice, and the status line under the switch.

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const { State } = require("../fsrs");
const mem = require("../lib/memory");
const router = express.Router();

function stabilities(userId) {
  return db.prepare(
    "SELECT cs.fsrs_stability AS s FROM card_states cs JOIN cards ca ON ca.id = cs.card_id " +
    "JOIN lessons l ON l.id = ca.lesson_id JOIN classes c ON c.id = l.class_id " +
    "WHERE cs.user_id = ? AND c.user_id = ? AND c.archived = 0 AND cs.fsrs_state = ? AND cs.fsrs_stability > 0"
  ).all(userId, userId, State.Review).map(r => r.s);
}

// GET /api/memory
router.get("/", requireAuth, (req, res) => {
  const userId = req.session.userId;
  const u = mem.readUser(db, userId);
  const s = stabilities(userId);
  res.json({
    choice: u.recall, adapt: u.adapt,
    reviews: mem.reviewCount(db, userId), minReviews: mem.MIN_REVIEWS, nextFitAt: mem.nextFitAt(u.lastFit),
    model: u.model && { trainedAt: u.model.trainedAt, reviews: u.model.reviews },
    lastFit: u.lastFit && { at: u.lastFit.at, reviews: u.lastFit.reviews, result: u.lastFit.result },
    reviewCards: s.length,
    load: mem.loadByTarget(s, mem.activeWeights(u))
  });
});

module.exports = router;
