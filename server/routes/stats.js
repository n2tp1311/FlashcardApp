"use strict";

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const router  = express.Router();

function computeStats(attempts) {
  if (!attempts.length) return { total: 0, correct: 0, blended: 0, level: "new" };
  const total   = attempts.length;
  const correct = attempts.filter(a => a.correct === 1).length;
  const lifetimeErr = (total - correct) / total;
  const recent  = attempts.slice(-5);
  const recentErr = (recent.length - recent.filter(a => a.correct === 1).length) / recent.length;
  const blended = 0.4 * lifetimeErr + 0.6 * recentErr;
  const level   = blended < 0.3 ? "easy" : blended < 0.6 ? "medium" : "hard";
  return { total, correct, blended, level };
}

function getCardsWithStats(cardIds, userId) {
  if (!cardIds.length) return [];
  const placeholders = cardIds.map(() => "?").join(",");
  const attempts = db.prepare(
    `SELECT card_id, correct FROM attempts WHERE card_id IN (${placeholders}) AND user_id = ? ORDER BY created_at`
  ).all(...cardIds, userId);

  const byCard = {};
  attempts.forEach(a => {
    if (!byCard[a.card_id]) byCard[a.card_id] = [];
    byCard[a.card_id].push(a);
  });

  return cardIds.map(id => ({ cardId: id, stats: computeStats(byCard[id] || []) }));
}

// GET /api/stats/lesson/:id
router.get("/lesson/:id", requireAuth, (req, res) => {
  const lesson = db.prepare(
    "SELECT l.id FROM lessons l JOIN classes c ON l.class_id = c.id WHERE l.id = ? AND c.user_id = ?"
  ).get(req.params.id, req.session.userId);
  if (!lesson) return res.status(404).json({ error: "Not found" });

  const cards = db.prepare("SELECT * FROM cards WHERE lesson_id = ?").all(req.params.id);
  const statsMap = Object.fromEntries(
    getCardsWithStats(cards.map(c => c.id), req.session.userId)
      .map(({ cardId, stats }) => [cardId, stats])
  );
  res.json({ cards: cards.map(c => ({ ...c, data: JSON.parse(c.data) })), statsMap });
});

// GET /api/stats/class/:id
router.get("/class/:id", requireAuth, (req, res) => {
  const cls = db.prepare("SELECT id FROM classes WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.session.userId);
  if (!cls) return res.status(404).json({ error: "Not found" });

  const cards = db.prepare(
    "SELECT cards.* FROM cards JOIN lessons ON cards.lesson_id = lessons.id WHERE lessons.class_id = ?"
  ).all(req.params.id);
  const statsMap = Object.fromEntries(
    getCardsWithStats(cards.map(c => c.id), req.session.userId)
      .map(({ cardId, stats }) => [cardId, stats])
  );
  res.json({ cards: cards.map(c => ({ ...c, data: JSON.parse(c.data) })), statsMap });
});

// GET /api/stats/hardest?scope=lesson|class|global&id=...&limit=30
router.get("/hardest", requireAuth, (req, res) => {
  const { scope, id, limit = 30 } = req.query;
  let cards;

  if (scope === "lesson") {
    const lesson = db.prepare(
      "SELECT l.id FROM lessons l JOIN classes c ON l.class_id = c.id WHERE l.id = ? AND c.user_id = ?"
    ).get(id, req.session.userId);
    if (!lesson) return res.status(404).json({ error: "Not found" });
    cards = db.prepare("SELECT * FROM cards WHERE lesson_id = ?").all(id);
  } else if (scope === "class") {
    const cls = db.prepare("SELECT id FROM classes WHERE id = ? AND user_id = ?")
      .get(id, req.session.userId);
    if (!cls) return res.status(404).json({ error: "Not found" });
    cards = db.prepare(
      "SELECT cards.* FROM cards JOIN lessons ON cards.lesson_id = lessons.id WHERE lessons.class_id = ?"
    ).all(id);
  } else {
    cards = db.prepare(
      "SELECT cards.* FROM cards " +
      "JOIN lessons ON cards.lesson_id = lessons.id " +
      "JOIN classes ON lessons.class_id = classes.id " +
      "WHERE classes.user_id = ?"
    ).all(req.session.userId);
  }

  const withStats = getCardsWithStats(cards.map(c => c.id), req.session.userId)
    .filter(x => x.stats.total > 0)
    .sort((a, b) => b.stats.blended - a.stats.blended)
    .slice(0, parseInt(limit));

  const cardMap = Object.fromEntries(cards.map(c => [c.id, c]));
  res.json(withStats.map(({ cardId, stats }) => ({
    card: { ...cardMap[cardId], data: JSON.parse(cardMap[cardId].data) },
    stats
  })));
});

// GET /api/stats/progress/lesson/:id
router.get("/progress/lesson/:id", requireAuth, (req, res) => {
  const lesson = db.prepare(
    "SELECT l.id FROM lessons l JOIN classes c ON l.class_id = c.id WHERE l.id = ? AND c.user_id = ?"
  ).get(req.params.id, req.session.userId);
  if (!lesson) return res.status(404).json({ error: "Not found" });

  const total = db.prepare("SELECT COUNT(*) as n FROM cards WHERE lesson_id = ?")
    .get(req.params.id).n;
  const known = db.prepare(
    "SELECT COUNT(*) as n FROM card_states cs " +
    "JOIN cards ON cs.card_id = cards.id " +
    "WHERE cards.lesson_id = ? AND cs.user_id = ? AND cs.known = 1"
  ).get(req.params.id, req.session.userId).n;

  res.json({ total, known });
});

// GET /api/stats/progress/class/:id
router.get("/progress/class/:id", requireAuth, (req, res) => {
  const cls = db.prepare("SELECT id FROM classes WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.session.userId);
  if (!cls) return res.status(404).json({ error: "Not found" });

  const total = db.prepare(
    "SELECT COUNT(*) as n FROM cards c JOIN lessons l ON c.lesson_id = l.id WHERE l.class_id = ?"
  ).get(req.params.id).n;
  const known = db.prepare(
    "SELECT COUNT(*) as n FROM card_states cs " +
    "JOIN cards ON cs.card_id = cards.id " +
    "JOIN lessons ON cards.lesson_id = lessons.id " +
    "WHERE lessons.class_id = ? AND cs.user_id = ? AND cs.known = 1"
  ).get(req.params.id, req.session.userId).n;

  res.json({ total, known });
});

module.exports = router;
