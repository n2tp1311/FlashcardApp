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

// POST /api/stats/difficulty-map  { cardIds: [...] }
router.post("/difficulty-map", requireAuth, (req, res) => {
  const { cardIds } = req.body;
  if (!Array.isArray(cardIds) || !cardIds.length) return res.json({});

  const placeholders = cardIds.map(() => "?").join(",");
  const attempts = db.prepare(
    `SELECT card_id, correct FROM attempts WHERE card_id IN (${placeholders}) AND user_id = ? ORDER BY created_at`
  ).all(...cardIds, req.session.userId);

  const byCard = {};
  attempts.forEach(a => {
    if (!byCard[a.card_id]) byCard[a.card_id] = [];
    byCard[a.card_id].push(a);
  });

  const map = {};
  cardIds.forEach(id => { map[id] = computeStats(byCard[id] || []); });
  res.json(map);
});

// GET /api/stats/dashboard
router.get("/dashboard", requireAuth, (req, res) => {
  const uid = req.session.userId;

  // Summary counts
  const totalClasses  = db.prepare("SELECT COUNT(*) AS n FROM classes WHERE user_id = ?").get(uid).n;
  const totalLessons  = db.prepare(
    "SELECT COUNT(*) AS n FROM lessons l JOIN classes c ON l.class_id = c.id WHERE c.user_id = ?"
  ).get(uid).n;
  const totalCards    = db.prepare(
    "SELECT COUNT(*) AS n FROM cards ca JOIN lessons l ON ca.lesson_id = l.id JOIN classes c ON l.class_id = c.id WHERE c.user_id = ?"
  ).get(uid).n;
  const totalSessions = db.prepare("SELECT COUNT(*) AS n FROM quiz_sessions WHERE user_id = ?").get(uid).n;
  const attRow        = db.prepare("SELECT COUNT(*) AS total, SUM(correct) AS correct_count FROM attempts WHERE user_id = ?").get(uid);

  // Difficulty breakdown — compute via existing helper on all user cards
  const allCardIds = db.prepare(
    "SELECT ca.id FROM cards ca JOIN lessons l ON ca.lesson_id = l.id JOIN classes c ON l.class_id = c.id WHERE c.user_id = ?"
  ).all(uid).map(r => r.id);

  const withStats = getCardsWithStats(allCardIds, uid);
  const diffBreakdown = { new: 0, easy: 0, medium: 0, hard: 0 };
  withStats.forEach(({ stats }) => { diffBreakdown[stats.level] = (diffBreakdown[stats.level] || 0) + 1; });

  // Due for review — lessons with at least 1 card whose srs_due_at has passed
  const allLessons = db.prepare(
    "SELECT l.id, l.title, l.class_id, c.name AS class_name FROM lessons l JOIN classes c ON l.class_id = c.id WHERE c.user_id = ?"
  ).all(uid);

  const nowSec = Math.floor(Date.now() / 1000);
  const dueRows = db.prepare(
    "SELECT ca.lesson_id, COUNT(*) AS due_count " +
    "FROM cards ca " +
    "JOIN card_states cs ON cs.card_id = ca.id AND cs.user_id = ? " +
    "JOIN lessons l ON ca.lesson_id = l.id " +
    "JOIN classes c ON l.class_id = c.id " +
    "WHERE c.user_id = ? AND cs.srs_due_at IS NOT NULL AND cs.srs_due_at <= ? " +
    "GROUP BY ca.lesson_id"
  ).all(uid, uid, nowSec);

  const dueLessonIds = new Set(dueRows.map(r => r.lesson_id));
  const dueCountMap  = {};
  dueRows.forEach(r => { dueCountMap[r.lesson_id] = r.due_count; });
  const dueForReview = allLessons
    .filter(l => dueLessonIds.has(l.id))
    .map(l => ({ ...l, dueCount: dueCountMap[l.id] || 0 }));

  // Class-level due aggregation — derived from dueCountMap, no extra DB query
  const dueByClass = {};
  allLessons.forEach(l => {
    if (dueCountMap[l.id]) dueByClass[l.class_id] = (dueByClass[l.class_id] || 0) + dueCountMap[l.id];
  });

  // Struggling lessons — lessons with >40% of attempted cards rated "hard"
  const attemptRows = db.prepare(
    "SELECT a.card_id, a.correct, l.id AS lesson_id, l.title, c.name AS class_name " +
    "FROM attempts a " +
    "JOIN cards ca ON a.card_id = ca.id " +
    "JOIN lessons l ON ca.lesson_id = l.id " +
    "JOIN classes c ON l.class_id = c.id " +
    "WHERE c.user_id = ? AND a.user_id = ? " +
    "ORDER BY l.id, ca.id, a.created_at"
  ).all(uid, uid);

  const lessonCardAttempts = {};
  const lessonMeta = {};
  attemptRows.forEach(r => {
    if (!lessonCardAttempts[r.lesson_id]) lessonCardAttempts[r.lesson_id] = {};
    if (!lessonCardAttempts[r.lesson_id][r.card_id]) lessonCardAttempts[r.lesson_id][r.card_id] = [];
    lessonCardAttempts[r.lesson_id][r.card_id].push({ correct: r.correct });
    lessonMeta[r.lesson_id] = { id: r.lesson_id, title: r.title, class_name: r.class_name };
  });

  const strugglingLessons = [];
  Object.keys(lessonCardAttempts).forEach(lid => {
    const cards = Object.values(lessonCardAttempts[lid]);
    const hardCount = cards.filter(atts => computeStats(atts).level === "hard").length;
    const hardRatio = hardCount / cards.length;
    if (hardRatio > 0.4) {
      strugglingLessons.push({ ...lessonMeta[lid], hardRatio });
    }
  });
  strugglingLessons.sort((a, b) => b.hardRatio - a.hardRatio);

  // Study streak — consecutive days with at least one session
  const days = db.prepare(
    "SELECT DISTINCT date(taken_at, 'unixepoch') AS day FROM quiz_sessions WHERE user_id = ? ORDER BY day DESC"
  ).all(uid).map(r => r.day);

  let streak = 0;
  if (days.length) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const msPerDay = 86400000;
    // startDay=0 if studied today, 1 if last study was yesterday (still counts as active streak)
    const startDay = (days[0] === todayStr) ? 0 : 1;
    for (let i = 0; i < days.length; i++) {
      const expectedDate = new Date(Date.now() - (i + startDay) * msPerDay)
        .toISOString().slice(0, 10);
      if (days[i] === expectedDate) streak++;
      else break;
    }
  }

  res.json({
    summary: {
      classes:      totalClasses,
      lessons:      totalLessons,
      cards:        totalCards,
      quizSessions: totalSessions,
      attempts:     attRow.total
    },
    accuracy:          { correct: attRow.correct_count || 0, total: attRow.total || 0 },
    diffBreakdown,
    dueForReview,
    dueByClass,
    strugglingLessons,
    streak
  });
});

module.exports = router;
