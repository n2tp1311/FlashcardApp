"use strict";

// Target recall and the personal FSRS model (lib/memory.js). The target itself is saved
// with the other preferences; this route reports what it costs and trains, applies or
// resets the model.

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const { State } = require("../fsrs");
const mem = require("../lib/memory");
const router = express.Router();

// One fit at a time per user: a second press while one runs would only race it.
const training = new Set();

function summary(m) {
  return m && { trainedAt: m.trainedAt, reviews: m.reviews,
                errorDefault: m.errorDefault, errorPersonal: m.errorPersonal };
}

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
  const reviews = mem.reviewCount(db, userId);
  const s = stabilities(userId);
  const newSince = u.model ? Math.max(0, reviews - (u.model.reviews || 0)) : null;
  res.json({
    targetRecall: u.recall, minRecall: mem.MIN_RECALL, maxRecall: mem.MAX_RECALL,
    minReviews: mem.MIN_REVIEWS, reviews,
    model: summary(u.model), candidate: summary(u.candidate),
    newSince,
    retrainSuggested: !!u.model && newSince >= Math.min(mem.RETRAIN_AFTER, u.model.reviews || 0),
    reviewCards: s.length,
    load: mem.loadByTarget(s, u.model && u.model.w),
    // What a candidate would make of the same cards, so its row can say what applying it costs.
    candidateLoad: u.candidate ? mem.loadByTarget(s, u.candidate.w) : null
  });
});

// POST /api/memory/train  { tz }
router.post("/train", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const reviews = mem.reviewCount(db, userId);
  if (reviews < mem.MIN_REVIEWS)
    return res.status(409).json({ error: "Not enough reviews to personalize yet", code: "notEnoughReviews",
                                  reviews, minReviews: mem.MIN_REVIEWS });
  if (training.has(userId))
    return res.status(409).json({ error: "Already training", code: "trainingBusy" });
  training.add(userId);
  try {
    const items = mem.trainingItems(mem.histories(db, userId, mem.normalizeTz(req.body && req.body.tz)));
    let fit;
    try {
      fit = await mem.train(items);
    } catch (e) {
      if (e instanceof mem.TrainingError && e.code === "notEnoughData")
        return res.status(422).json({ error: "These reviews are not enough to fit a model on yet", code: e.code });
      if (e instanceof mem.TrainingError) {
        console.error("[memory] training failed:", e.message);
        return res.status(500).json({ error: "Training failed. Try again later.", code: e.code });
      }
      // Anything else is the native optimizer failing to load on this platform.
      console.error("[memory] optimizer unavailable:", e && e.message);
      return res.status(503).json({ error: "The optimizer is not available on this server", code: "optimizerUnavailable" });
    }
    const candidate = { w: fit.w, trainedAt: Math.floor(Date.now() / 1000), reviews,
                        errorDefault: fit.errorDefault, errorPersonal: fit.errorPersonal };
    db.prepare("UPDATE users SET fsrs_candidate = ? WHERE id = ?").run(JSON.stringify(candidate), userId);
    res.json({ candidate: summary(candidate) });
  } finally {
    training.delete(userId);
  }
});

// POST /api/memory/apply — make the trained candidate the user's model.
router.post("/apply", requireAuth, (req, res) => {
  const userId = req.session.userId;
  const u = mem.readUser(db, userId);
  if (!u.candidate) return res.status(409).json({ error: "Nothing to apply; train first", code: "noCandidate" });
  db.prepare("UPDATE users SET fsrs_model = ?, fsrs_candidate = NULL WHERE id = ?")
    .run(JSON.stringify(u.candidate), userId);
  res.json({ model: summary(u.candidate) });
});

// DELETE /api/memory/candidate — keep the current model.
router.delete("/candidate", requireAuth, (req, res) => {
  db.prepare("UPDATE users SET fsrs_candidate = NULL WHERE id = ?").run(req.session.userId);
  res.json({ ok: true });
});

// DELETE /api/memory/model — back to FSRS's default parameters.
router.delete("/model", requireAuth, (req, res) => {
  db.prepare("UPDATE users SET fsrs_model = NULL, fsrs_candidate = NULL WHERE id = ?").run(req.session.userId);
  res.json({ ok: true });
});

module.exports = router;
