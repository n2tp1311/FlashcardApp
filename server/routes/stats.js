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
    `SELECT card_id, correct, created_at FROM attempts WHERE card_id IN (${placeholders}) AND user_id = ? ORDER BY created_at`
  ).all(...cardIds, userId);

  const byCard = {};
  attempts.forEach(a => {
    if (!byCard[a.card_id]) byCard[a.card_id] = [];
    byCard[a.card_id].push(a);
  });

  return cardIds.map(id => {
    const cardAttempts = byCard[id] || [];
    const lastAttemptAt = cardAttempts.length ? cardAttempts[cardAttempts.length - 1].created_at : 0;
    return { cardId: id, stats: computeStats(cardAttempts), lastAttemptAt };
  });
}

// GET /api/stats/lesson/:id
router.get("/lesson/:id", requireAuth, (req, res) => {
  const lesson = db.prepare(
    "SELECT l.id FROM lessons l JOIN classes c ON l.class_id = c.id WHERE l.id = ? AND c.user_id = ?"
  ).get(req.params.id, req.session.userId);
  if (!lesson) return res.status(404).json({ error: "Not found" });

  const userId = req.session.userId;
  const cards = db.prepare(
    "SELECT cards.*, cs.known, cs.last_seen_at, cs.srs_step, cs.srs_due_at, la.last_studied_at " +
    "FROM cards " +
    "LEFT JOIN card_states cs ON cs.card_id = cards.id AND cs.user_id = ? " +
    "LEFT JOIN (SELECT card_id, MAX(created_at) AS last_studied_at FROM attempts WHERE user_id = ? GROUP BY card_id) la ON la.card_id = cards.id " +
    "WHERE cards.lesson_id = ? " +
    "ORDER BY cards.sort_order, cards.created_at"
  ).all(userId, userId, req.params.id);
  const statsMap = Object.fromEntries(
    getCardsWithStats(cards.map(c => c.id), userId)
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

// GET /api/stats/hardest?scope=lesson|class|global&id=...&limit=30&sort=difficulty|recent
router.get("/hardest", requireAuth, (req, res) => {
  const { scope, id, limit = 30, sort = "difficulty" } = req.query;
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
    .sort((a, b) => sort === "recent" ? b.lastAttemptAt - a.lastAttemptAt : b.stats.blended - a.stats.blended)
    .slice(0, parseInt(limit));

  const cardMap = Object.fromEntries(cards.map(c => [c.id, c]));
  res.json(withStats.map(({ cardId, stats }) => ({
    card: { ...cardMap[cardId], data: JSON.parse(cardMap[cardId].data) },
    stats
  })));
});

// GET /api/stats/trend?scope=lesson|class&id=... — weekly accuracy for the last 8 weeks,
// scoped to one lesson/class (the Dashboard's Weekly Trend is volume-only and unscoped).
router.get("/trend", requireAuth, (req, res) => {
  const { scope, id } = req.query;
  const uid = req.session.userId;
  let cardIdRows;

  if (scope === "lesson") {
    const lesson = db.prepare(
      "SELECT l.id FROM lessons l JOIN classes c ON l.class_id = c.id WHERE l.id = ? AND c.user_id = ?"
    ).get(id, uid);
    if (!lesson) return res.status(404).json({ error: "Not found" });
    cardIdRows = db.prepare("SELECT id FROM cards WHERE lesson_id = ?").all(id);
  } else if (scope === "class") {
    const cls = db.prepare("SELECT id FROM classes WHERE id = ? AND user_id = ?").get(id, uid);
    if (!cls) return res.status(404).json({ error: "Not found" });
    cardIdRows = db.prepare(
      "SELECT cards.id FROM cards JOIN lessons ON cards.lesson_id = lessons.id WHERE lessons.class_id = ?"
    ).all(id);
  } else {
    return res.status(400).json({ error: "scope must be lesson or class" });
  }

  const cardIds = cardIdRows.map(r => r.id);
  if (!cardIds.length) return res.json([]);

  const placeholders = cardIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT CAST((strftime('%s','now') - created_at) / 604800 AS INTEGER) AS weeks_ago, ` +
    `COUNT(*) AS total, SUM(CASE WHEN correct=1 THEN 1 ELSE 0 END) AS correct ` +
    `FROM attempts WHERE card_id IN (${placeholders}) AND user_id = ? ` +
    `AND created_at >= strftime('%s','now') - ? GROUP BY weeks_ago`
  ).all(...cardIds, uid, 8 * 604800);

  res.json(rows);
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

  // Summary counts — archived classes are excluded from all dashboard aggregation
  const totalClasses  = db.prepare("SELECT COUNT(*) AS n FROM classes WHERE user_id = ? AND archived = 0").get(uid).n;
  const totalLessons  = db.prepare(
    "SELECT COUNT(*) AS n FROM lessons l JOIN classes c ON l.class_id = c.id WHERE c.user_id = ? AND c.archived = 0"
  ).get(uid).n;
  const totalCards    = db.prepare(
    "SELECT COUNT(*) AS n FROM cards ca JOIN lessons l ON ca.lesson_id = l.id JOIN classes c ON l.class_id = c.id WHERE c.user_id = ? AND c.archived = 0"
  ).get(uid).n;
  const totalSessions = db.prepare("SELECT COUNT(*) AS n FROM quiz_sessions WHERE user_id = ?").get(uid).n;
  const attRow        = db.prepare("SELECT COUNT(*) AS total, SUM(correct) AS correct_count FROM attempts WHERE user_id = ?").get(uid);

  // Difficulty breakdown — compute via existing helper on all user cards
  const allCardIds = db.prepare(
    "SELECT ca.id FROM cards ca JOIN lessons l ON ca.lesson_id = l.id JOIN classes c ON l.class_id = c.id WHERE c.user_id = ? AND c.archived = 0"
  ).all(uid).map(r => r.id);

  const withStats = getCardsWithStats(allCardIds, uid);
  const diffBreakdown = { new: 0, easy: 0, medium: 0, hard: 0 };
  withStats.forEach(({ stats }) => { diffBreakdown[stats.level] = (diffBreakdown[stats.level] || 0) + 1; });

  // Due for review — lessons with at least 1 card whose srs_due_at has passed
  const allLessons = db.prepare(
    "SELECT l.id, l.title, l.class_id, c.name AS class_name FROM lessons l JOIN classes c ON l.class_id = c.id WHERE c.user_id = ? AND c.archived = 0"
  ).all(uid);

  const nowSec = Math.floor(Date.now() / 1000);
  const dueRows = db.prepare(
    "SELECT ca.lesson_id, COUNT(*) AS due_count " +
    "FROM cards ca " +
    "JOIN card_states cs ON cs.card_id = ca.id AND cs.user_id = ? " +
    "JOIN lessons l ON ca.lesson_id = l.id " +
    "JOIN classes c ON l.class_id = c.id " +
    "WHERE c.user_id = ? AND c.archived = 0 AND cs.srs_due_at IS NOT NULL AND cs.srs_due_at <= ? " +
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

  // Study streak — consecutive days with at least one graded attempt. Was based on
  // quiz_sessions (only written when a Quiz session reaches the results screen), so
  // Flashcard-only study, or a Quiz session started but not finished, was invisible to
  // the streak — a user could study daily and still see it reset. attempts is written
  // immediately by both modes (per Flashcard grade, per Quiz answer), so it reflects
  // "did you study" rather than "did you finish a quiz."
  const days = db.prepare(
    "SELECT DISTINCT date(created_at, 'unixepoch') AS day FROM attempts WHERE user_id = ? ORDER BY day DESC"
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
    streak
  });
});

router.get("/analytics", requireAuth, function(req, res) {
  var uid = req.session.userId;
  var parsedDays = parseInt(req.query.days, 10);
  var days = Math.min(90, Math.max(7, isNaN(parsedDays) ? 60 : parsedDays));
  var secs = days * 86400;

  var heatmapRows = db.prepare(
    "SELECT date(created_at,'unixepoch') AS day, COUNT(*) AS cnt " +
    "FROM attempts " +
    "WHERE user_id=? AND created_at >= strftime('%s','now') - ? " +
    "GROUP BY day"
  ).all(uid, secs);

  var weeklyRows = db.prepare(
    "SELECT CAST((strftime('%s','now') - created_at) / 604800 AS INTEGER) AS weeks_ago, " +
    "COUNT(*) AS cnt, SUM(CASE WHEN correct=1 THEN 1 ELSE 0 END) AS correct " +
    "FROM attempts " +
    "WHERE user_id=? AND created_at >= strftime('%s','now') - ? " +
    "GROUP BY weeks_ago"
  ).all(uid, secs);

  var lessonRows = db.prepare(
    "SELECT l.id, l.title, cl.name AS class_name, " +
    "COUNT(a.id) AS total_attempts, " +
    "SUM(CASE WHEN a.correct=1 THEN 1 ELSE 0 END) AS correct_attempts " +
    "FROM lessons l " +
    "JOIN classes cl ON cl.id=l.class_id AND cl.user_id=? AND cl.archived=0 " +
    "LEFT JOIN cards c ON c.lesson_id=l.id " +
    "LEFT JOIN attempts a ON a.card_id=c.id AND a.user_id=? " +
    "GROUP BY l.id " +
    "HAVING total_attempts > 0 " +
    "ORDER BY (correct_attempts * 1.0 / total_attempts) ASC"
  ).all(uid, uid);

  // Accuracy split by study mode — windowed (unlike the dashboard's lifetime Overall
  // Accuracy) since the point of this diagnostic is "how am I doing lately," not lifetime.
  var accuracyBySourceRows = db.prepare(
    "SELECT source, COUNT(*) AS total, SUM(CASE WHEN correct=1 THEN 1 ELSE 0 END) AS correct " +
    "FROM attempts WHERE user_id=? AND created_at >= strftime('%s','now') - ? GROUP BY source"
  ).all(uid, secs);
  var accuracyBySource = {};
  accuracyBySourceRows.forEach(function(r) { accuracyBySource[r.source] = { total: r.total, correct: r.correct || 0 }; });

  var totalDurationMs = db.prepare(
    "SELECT SUM(duration_ms) AS ms FROM attempts WHERE user_id=? AND created_at >= strftime('%s','now') - ?"
  ).get(uid, secs).ms || 0;

  // Struggling lessons — windowed (was lifetime on /dashboard; a lesson shouldn't stay
  // flagged long after the user actually fixed it) and requires >=3 attempted cards so
  // one bad card early on doesn't flag an otherwise-fine lesson.
  var attemptRows = db.prepare(
    "SELECT a.card_id, a.correct, l.id AS lesson_id, l.title, c.name AS class_name " +
    "FROM attempts a " +
    "JOIN cards ca ON a.card_id = ca.id " +
    "JOIN lessons l ON ca.lesson_id = l.id " +
    "JOIN classes c ON l.class_id = c.id " +
    "WHERE c.user_id=? AND a.user_id=? AND c.archived=0 AND a.created_at >= strftime('%s','now') - ? " +
    "ORDER BY l.id, ca.id, a.created_at"
  ).all(uid, uid, secs);

  var lessonCardAttempts = {};
  var lessonMeta = {};
  attemptRows.forEach(function(r) {
    if (!lessonCardAttempts[r.lesson_id]) lessonCardAttempts[r.lesson_id] = {};
    if (!lessonCardAttempts[r.lesson_id][r.card_id]) lessonCardAttempts[r.lesson_id][r.card_id] = [];
    lessonCardAttempts[r.lesson_id][r.card_id].push({ correct: r.correct });
    lessonMeta[r.lesson_id] = { id: r.lesson_id, title: r.title, class_name: r.class_name };
  });

  var MIN_STRUGGLING_SAMPLE = 3;
  var strugglingLessons = [];
  Object.keys(lessonCardAttempts).forEach(function(lid) {
    var cardsAttempted = Object.values(lessonCardAttempts[lid]);
    if (cardsAttempted.length < MIN_STRUGGLING_SAMPLE) return;
    var hardCount = cardsAttempted.filter(function(atts) { return computeStats(atts).level === "hard"; }).length;
    var hardRatio = hardCount / cardsAttempted.length;
    if (hardRatio > 0.4) strugglingLessons.push(Object.assign({}, lessonMeta[lid], { hardRatio: hardRatio }));
  });
  strugglingLessons.sort(function(a, b) { return b.hardRatio - a.hardRatio; });

  res.json({
    heatmap: heatmapRows,
    weeklyTrend: weeklyRows,
    lessonBreakdown: lessonRows,
    accuracyBySource: accuracyBySource,
    totalDurationMs: totalDurationMs,
    strugglingLessons: strugglingLessons,
    days: days
  });
});

router.get("/accuracy/classes", requireAuth, function(req, res) {
  var uid = req.session.userId;
  var rows = db.prepare(
    "SELECT l.class_id, COUNT(a.id) AS total, " +
    "SUM(CASE WHEN a.correct = 1 THEN 1 ELSE 0 END) AS correct " +
    "FROM attempts a " +
    "JOIN cards c ON a.card_id = c.id " +
    "JOIN lessons l ON c.lesson_id = l.id " +
    "JOIN classes cl ON l.class_id = cl.id " +
    "WHERE a.user_id = ? AND cl.user_id = ? " +
    "GROUP BY l.class_id"
  ).all(uid, uid);
  var map = {};
  rows.forEach(function(r) { map[r.class_id] = { correct: r.correct || 0, total: r.total || 0 }; });
  res.json(map);
});

router.get("/accuracy/lessons", requireAuth, function(req, res) {
  var uid = req.session.userId;
  var classId = req.query.classId;
  if (!classId) return res.status(400).json({ error: "classId required" });
  var cls = db.prepare("SELECT id FROM classes WHERE id = ? AND user_id = ?").get(classId, uid);
  if (!cls) return res.status(404).json({ error: "Not found" });
  var rows = db.prepare(
    "SELECT c.lesson_id, COUNT(a.id) AS total, " +
    "SUM(CASE WHEN a.correct = 1 THEN 1 ELSE 0 END) AS correct " +
    "FROM attempts a JOIN cards c ON a.card_id = c.id " +
    "JOIN lessons l ON c.lesson_id = l.id " +
    "WHERE l.class_id = ? AND a.user_id = ? GROUP BY c.lesson_id"
  ).all(classId, uid);
  var map = {};
  rows.forEach(function(r) {
    var pct = r.total > 0 ? Math.round((r.correct || 0) / r.total * 100) : 0;
    map[r.lesson_id] = { correct: r.correct || 0, total: r.total || 0, pct: pct };
  });
  res.json(map);
});

router.get("/analytics/export", requireAuth, function(req, res) {
  var uid = req.session.userId;

  var rows = db.prepare(
    "SELECT date(a.created_at,'unixepoch') AS date, strftime('%H',a.created_at,'unixepoch') AS hour, " +
    "cl.name AS class_name, l.title AS lesson, " +
    "c.data AS card_data, c.format AS card_format, a.source AS mode, a.correct AS result, a.duration_ms AS duration_ms " +
    "FROM attempts a " +
    "JOIN cards c ON a.card_id=c.id " +
    "JOIN lessons l ON c.lesson_id=l.id " +
    "JOIN classes cl ON l.class_id=cl.id " +
    "WHERE a.user_id=? AND cl.user_id=? " +
    "AND a.created_at >= strftime('%s','now','-90 days') " +
    "ORDER BY a.created_at"
  ).all(uid, uid);

  function csvField(v) {
    v = String(v).replace(/"/g, '""');
    return /[,"\n]/.test(v) ? '"' + v + '"' : v;
  }

  var lines = ["date,hour,class,lesson,card_front,mode,result,duration_sec"];
  rows.forEach(function(row) {
    var data;
    try { data = JSON.parse(row.card_data); } catch(_) { data = {}; }
    var front = row.card_format === "image-def" ? "[image]" : (data.term || data.question || data.statement || "");
    var durationSec = row.duration_ms != null ? Math.round(row.duration_ms / 1000) : "";
    lines.push([csvField(row.date), csvField(row.hour), csvField(row.class_name), csvField(row.lesson), csvField(front),
      csvField(row.mode), row.result === 1 ? "correct" : "incorrect", durationSec].join(","));
  });

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="study-export.csv"');
  res.send(lines.join("\n"));
});

// GET /api/stats/srs-distribution
router.get("/srs-distribution", requireAuth, (req, res) => {
  const rows = db.prepare(
    "SELECT srs_step, COUNT(*) AS cnt FROM card_states WHERE user_id = ? AND srs_due_at IS NOT NULL GROUP BY srs_step ORDER BY srs_step"
  ).all(req.session.userId);
  res.json(rows);
});

module.exports = router;
