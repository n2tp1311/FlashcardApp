"use strict";

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const { computeAchievements } = require("../lib/achievements");
const { MASTERED_INTERVAL_SEC, MASTERED_SQL } = require("../lib/mastery");
const router  = express.Router();

// Events the client reports. due_zero is written by the server only (routes/attempts.js).
const CLIENT_EVENTS = new Set(["second_look", "card_fix"]);
const DEFAULT_DAILY_GOAL = 20; // the client's default when the preference was never set

function gatherFacts(uid) {
  const vocabCards = new Set(db.prepare(
    "SELECT card_id FROM vocabulary_requests WHERE user_id = ? AND status = 'completed' AND card_id IS NOT NULL"
  ).all(uid).map(r => r.card_id));

  // Attempts outlive their card (the attempts table has no card foreign key), so the joins
  // are LEFT: a deleted card's answers still count as days, minutes and sessions.
  const attempts = db.prepare(
    "SELECT a.created_at AS t, a.duration_ms AS ms, a.source, a.correct, a.grade, a.typed, a.card_id AS card, " +
    "l.class_id AS cls, ca.external_id AS ext " +
    "FROM attempts a LEFT JOIN cards ca ON ca.id = a.card_id LEFT JOIN lessons l ON l.id = ca.lesson_id " +
    "WHERE a.user_id = ? ORDER BY a.created_at, a.rowid"
  ).all(uid).map(a => Object.assign(a, { vocab: vocabCards.has(a.card) }));

  const cards = db.prepare(
    "SELECT ca.id, ca.lesson_id AS lesson, l.class_id AS cls, c.archived, ca.external_id AS ext, " +
    "cs.fsrs_state AS state, cs.fsrs_lapses AS lapses, cs.srs_due_at AS due, cs.last_correct_source AS lastCorrectSource, " +
    "CASE WHEN " + MASTERED_SQL + " THEN 1 ELSE 0 END AS mastered " +
    "FROM cards ca JOIN lessons l ON l.id = ca.lesson_id JOIN classes c ON c.id = l.class_id " +
    "LEFT JOIN card_states cs ON cs.card_id = ca.id AND cs.user_id = ? WHERE c.user_id = ?"
  ).all(MASTERED_INTERVAL_SEC, uid, uid).map(c => Object.assign(c, { vocab: vocabCards.has(c.id) }));

  const events = {};
  db.prepare("SELECT kind, ref FROM study_events WHERE user_id = ?").all(uid).forEach(e => {
    (events[e.kind] = events[e.kind] || []).push(e.ref);
  });

  let dailyGoal = DEFAULT_DAILY_GOAL;
  const prefsRow = db.prepare("SELECT preferences FROM users WHERE id = ?").get(uid);
  try {
    const prefs = JSON.parse((prefsRow && prefsRow.preferences) || "{}");
    if (typeof prefs.dailyGoal === "number") dailyGoal = prefs.dailyGoal;
  } catch (_) {}

  return {
    now: Math.floor(Date.now() / 1000),
    attempts,
    cards,
    dailyGoal,
    dueZeroDays: events.due_zero || [],
    secondLooks: (events.second_look || []).length,
    cardFixes: (events.card_fix || []).length,
    vocabRequests: db.prepare("SELECT COUNT(*) AS n FROM vocabulary_requests WHERE user_id = ?").get(uid).n
  };
}

// GET /api/achievements — where every achievement stands. A tier reached for the first time is
// recorded here, the first time anyone asks after it happened, so earned_at is when it was
// noticed: at the latest the end of the session that earned it, which asks.
router.get("/", requireAuth, (req, res) => {
  const uid = req.session.userId;
  const facts = gatherFacts(uid);
  const items = computeAchievements(facts, new Date().toISOString().slice(0, 10));
  const recorded = new Map(db.prepare("SELECT key, tier, earned_at FROM user_achievements WHERE user_id = ?")
    .all(uid).map(r => [r.key, r]));
  const upsert = db.prepare(
    "INSERT INTO user_achievements (user_id, key, tier, earned_at) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(user_id, key) DO UPDATE SET tier = excluded.tier, earned_at = excluded.earned_at"
  );
  db.transaction(() => {
    items.forEach(it => {
      const rec = recorded.get(it.key);
      if (it.tier > (rec ? rec.tier : 0)) {
        upsert.run(uid, it.key, it.tier, facts.now);
        recorded.set(it.key, { tier: it.tier, earned_at: facts.now });
      }
    });
  })();
  res.json({
    now: facts.now,
    items: items.map(it => {
      const rec = recorded.get(it.key);
      const best = rec ? rec.tier : 0;
      // A lossable achievement shows what is true now, and says it was once earned.
      const tier = it.lossable ? it.tier : Math.max(it.tier, best);
      return Object.assign(it, {
        tier,
        next: tier < it.tiers.length ? it.tiers[tier] : null,
        progress: tier >= it.tiers.length ? 1 : it.progress,
        earnedAt: rec ? rec.earned_at : null,
        lost: it.lossable && best > it.tier
      });
    })
  });
});

// POST /api/achievements/events { kind, ref } — something only the client sees.
router.post("/events", requireAuth, (req, res) => {
  const { kind, ref } = req.body || {};
  if (!CLIENT_EVENTS.has(kind) || typeof ref !== "string" || !ref || ref.length > 64)
    return res.status(400).json({ error: "kind must be second_look or card_fix, ref a string of up to 64 characters" });
  db.prepare("INSERT OR IGNORE INTO study_events (user_id, kind, ref) VALUES (?, ?, ?)").run(req.session.userId, kind, ref);
  res.status(201).json({ ok: true });
});

module.exports = router;
