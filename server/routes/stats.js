"use strict";

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const { computeStreak, weekRow, addDays } = require("../lib/streak");
const { summarizeToday } = require("../lib/today");
const { aboveAverageRun } = require("../lib/aboveAvg");
const { MASTERED_INTERVAL_SEC, MASTERED_SQL } = require("../lib/mastery");
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
    "SELECT cards.*, cs.known, cs.last_seen_at, cs.srs_due_at, cs.last_correct_source " +
    "FROM cards " +
    "LEFT JOIN card_states cs ON cs.card_id = cards.id AND cs.user_id = ? " +
    "WHERE cards.lesson_id = ? " +
    "ORDER BY cards.sort_order, cards.created_at"
  ).all(userId, req.params.id);

  // getCardsWithStats already does a single indexed `card_id IN (...) AND user_id = ?`
  // pass over attempts (idx_attempts_cu) and computes lastAttemptAt per card along the
  // way — reuse it instead of a second query. The old last_studied_at column came from a
  // LEFT JOIN against a per-user GROUP BY subquery (aggregating every attempt the user
  // has ever made, across every lesson, before joining down to this lesson's cards) and
  // measured ~24s cold on a real account.
  const statsMap = {};
  const lastStudiedMap = {};
  getCardsWithStats(cards.map(c => c.id), userId).forEach(({ cardId, stats, lastAttemptAt }) => {
    statsMap[cardId] = stats;
    lastStudiedMap[cardId] = lastAttemptAt || null;
  });

  res.json({
    cards: cards.map(c => ({ ...c, data: JSON.parse(c.data), last_studied_at: lastStudiedMap[c.id] })),
    statsMap
  });
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

// Memory state of each card in a lesson or class, for the mastery bar (mastered: see
// lib/mastery.js). A card without FSRS state has never been scheduled and counts as new, as
// cardFromState() treats it. `scope` is a fixed condition on `c`, never user input.

function masteryCounts(scope, id, userId) {
  const rows = db.prepare(
    "SELECT bucket, COUNT(*) AS n FROM (" +
    "  SELECT CASE" +
    "    WHEN cs.card_id IS NULL OR cs.fsrs_stability IS NULL THEN 'new'" +
    "    WHEN cs.fsrs_state IN (1,3) THEN 'learning'" +
    "    WHEN " + MASTERED_SQL + " THEN 'mastered'" +
    "    ELSE 'known' END AS bucket" +
    "  FROM cards c LEFT JOIN card_states cs ON cs.card_id = c.id AND cs.user_id = ?" +
    "  WHERE " + scope +
    ") GROUP BY bucket"
  ).all(MASTERED_INTERVAL_SEC, userId, id);
  const mastery = { new: 0, learning: 0, known: 0, mastered: 0 };
  rows.forEach(r => { mastery[r.bucket] = r.n; });
  return mastery;
}

const lessonMastery = (lessonId, userId) => masteryCounts("c.lesson_id = ?", lessonId, userId);
const classMastery = (classId, userId) =>
  masteryCounts("c.lesson_id IN (SELECT id FROM lessons WHERE class_id = ?)", classId, userId);

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

  res.json({ total, known, mastery: lessonMastery(req.params.id, req.session.userId) });
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

  res.json({ total, known, mastery: classMastery(req.params.id, req.session.userId) });
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

  // Every lesson with its card count and mastered count, for the Dashboard's lesson table.
  // Mastered is the lesson mastery bar's definition (lib/mastery.js).
  const masteryMap = {};
  db.prepare(
    "SELECT ca.lesson_id, COUNT(*) AS cards, SUM(CASE WHEN " + MASTERED_SQL + " THEN 1 ELSE 0 END) AS mastered " +
    "FROM cards ca JOIN lessons l ON ca.lesson_id = l.id JOIN classes c ON l.class_id = c.id " +
    "LEFT JOIN card_states cs ON cs.card_id = ca.id AND cs.user_id = ? " +
    "WHERE c.user_id = ? AND c.archived = 0 GROUP BY ca.lesson_id"
  ).all(MASTERED_INTERVAL_SEC, uid, uid).forEach(r => { masteryMap[r.lesson_id] = r; });
  const lessons = allLessons.map(l => ({
    ...l, cards: masteryMap[l.id] ? masteryMap[l.id].cards : 0, mastered: masteryMap[l.id] ? masteryMap[l.id].mastered || 0 : 0
  }));

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
  // "did you study" rather than "did you finish a quiz." One missed day a week is a rest
  // day (see ../lib/streak.js).
  const today = todayStats(uid);
  const streak = today.streak;

  // Study Time (total + Avg/Min/Max per study day) — windowed if ?days= is given (clamped
  // 7-90, same range as /analytics), else all-time (the original, backward-compatible
  // default). Grouped by day so a day with attempts but no tracked duration (made before
  // duration_ms shipped) is excluded rather than counted as a 0-minute day, which would
  // skew avg/min down and always win "min."
  //
  // Cutoff is calendar-day-aligned (date(...) >= date('now', '-N days')), not a raw
  // now-minus-N*86400-seconds instant. A seconds-based cutoff can fall mid-day, so the
  // oldest included day would only get the attempts after that instant summed — a
  // truncated fraction of what the all-time query computes for that same day. That
  // fake, artificially-small "day total" could then undercut the true minimum, making
  // Min(window) appear lower than Min(all-time), which is otherwise impossible since a
  // window is a subset of complete days. Aligning to full calendar days means every
  // counted day is either wholly in or wholly out — never a partial sum.
  const parsedWindowDays = parseInt(req.query.days, 10);
  const windowDays = (!isNaN(parsedWindowDays) && parsedWindowDays > 0)
    ? Math.min(90, Math.max(7, parsedWindowDays))
    : null;
  const windowClause = windowDays ? "AND date(created_at, 'unixepoch') >= date('now', ?)" : "";
  const windowParams = windowDays ? [uid, "-" + windowDays + " days"] : [uid];

  const totalMsRow = db.prepare(
    `SELECT SUM(duration_ms) AS total FROM attempts WHERE user_id = ? ${windowClause}`
  ).get(...windowParams);

  const studyTimeStatsRow = db.prepare(`
    SELECT AVG(ms) AS avg, MIN(ms) AS min, MAX(ms) AS max, COUNT(*) AS trackedDays
    FROM (
      SELECT SUM(duration_ms) AS ms
      FROM attempts
      WHERE user_id = ? ${windowClause}
      GROUP BY date(created_at, 'unixepoch')
      HAVING ms IS NOT NULL
    )
  `).get(...windowParams);

  // Study minutes per calendar day for the hero card's sparkline, every day of the window
  // (the last 30 for all-time) with unstudied days as 0, oldest first, today last. Each day
  // carries the rolling 30-day mean it was measured against, from the whole history, so a
  // 7-day window still draws a 30-day average.
  const sparkDays = windowDays || 30;
  const dayRows = db.prepare(
    "SELECT date(created_at, 'unixepoch') AS day, SUM(duration_ms) AS ms FROM attempts " +
    "WHERE user_id = ? GROUP BY day"
  ).all(uid);
  const dayMs = new Map(dayRows.map(r => [r.day, r.ms || 0]));
  const todayStr = new Date().toISOString().slice(0, 10);
  const run = aboveAverageRun(dayRows, todayStr);
  const daily = [];
  for (let i = sparkDays - 1; i >= 0; i--) {
    const day = addDays(todayStr, -i);
    daily.push({ day, ms: dayMs.get(day) || 0, avgMs: run.avgByDay.get(day) || 0 });
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
    dueForReview,
    dueByClass,
    lessons,
    streak,
    today,
    studyTime: {
      totalMs:     totalMsRow.total || 0,
      avgDailyMs:  Math.round(studyTimeStatsRow.avg || 0),
      minDailyMs:  studyTimeStatsRow.min || 0,
      maxDailyMs:  studyTimeStatsRow.max || 0,
      trackedDays: studyTimeStatsRow.trackedDays || 0,
      windowDays:  windowDays,
      daily,
      aboveAvg: { current: run.current, best: run.best, todayAbove: run.todayAbove, todayMs: run.todayMs, todayAvgMs: run.todayAvgMs }
    }
  });
});

router.get("/analytics", requireAuth, function(req, res) {
  var uid = req.session.userId;
  var parsedDays = parseInt(req.query.days, 10);
  var days = Math.min(90, Math.max(7, isNaN(parsedDays) ? 60 : parsedDays));
  var secs = days * 86400;

  var heatmapRows = db.prepare(
    "SELECT date(created_at,'unixepoch') AS day, COUNT(*) AS cnt, SUM(duration_ms) AS ms " +
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

  // New-card introduction pace over time: each card's first-ever attempt (across all of the
  // user's history, not just this window) is the day it was "new" to them. Same underlying
  // signal as /new-card-estimate's historical-pace query, just bucketed by week instead of
  // reduced to a single average — lets the trend chart show whether pace is rising or falling.
  var newCardsWeeklyRows = db.prepare(`
    SELECT CAST((strftime('%s','now') - first_seen) / 604800 AS INTEGER) AS weeks_ago, COUNT(*) AS cnt
    FROM (
      SELECT card_id, MIN(created_at) AS first_seen
      FROM attempts
      WHERE user_id = ?
      GROUP BY card_id
    )
    WHERE first_seen >= strftime('%s','now') - ?
    GROUP BY weeks_ago
  `).all(uid, secs);

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


  // Retention is represented as observed weekly accuracy, not predicted FSRS recall.
  // The client zero-fills missing weeks using the same window as the study-volume trend.
  var retentionTrend = weeklyRows.map(function(r) {
    return { weeks_ago: r.weeks_ago, total: r.cnt, correct: r.correct || 0 };
  });
  var gradeDistribution = db.prepare(
    "SELECT source, grade, correct, COUNT(*) AS cnt FROM attempts " +
    "WHERE user_id=? AND created_at >= strftime('%s','now') - ? " +
    "GROUP BY source, grade, correct ORDER BY source, grade"
  ).all(uid, secs);

  // Only attempts with measured duration contribute. Older attempts and quiz sessions
  // without timing data are excluded rather than treated as zero-second reviews.
  var reviewTimeWeeklyRows = db.prepare(
    "SELECT CAST((strftime('%s','now') - created_at) / 604800 AS INTEGER) AS weeks_ago, " +
    "COUNT(duration_ms) AS samples, AVG(duration_ms) AS avg_ms " +
    "FROM attempts WHERE user_id=? AND created_at >= strftime('%s','now') - ? " +
    "AND duration_ms IS NOT NULL GROUP BY weeks_ago"
  ).all(uid, secs);

  // Card history is fetched on demand by /card-history/:cardId; avoid shipping every
  // attempt row with each dashboard request.

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
    retentionTrend: retentionTrend,
    gradeDistribution: gradeDistribution,
    reviewTimeTrend: reviewTimeWeeklyRows,
    newCardsWeeklyTrend: newCardsWeeklyRows,
    lessonBreakdown: lessonRows,
    strugglingLessons: strugglingLessons,
    days: days
  });
});

router.get("/card-history/:cardId", requireAuth, function(req, res) {
  var uid = req.session.userId;
  var card = db.prepare(
    "SELECT c.id, c.format, c.data FROM cards c " +
    "JOIN lessons l ON l.id=c.lesson_id " +
    "JOIN classes cl ON cl.id=l.class_id " +
    "WHERE c.id=? AND cl.user_id=?"
  ).get(req.params.cardId, uid);
  if (!card) return res.status(404).json({ error: "Not found" });

  var attemptLimit = 500;
  var attempts = db.prepare(
    "SELECT created_at, correct, source, grade, duration_ms FROM attempts " +
    "WHERE card_id=? AND user_id=? ORDER BY created_at DESC, id DESC LIMIT ?"
  ).all(card.id, uid, attemptLimit + 1);
  var hasMore = attempts.length > attemptLimit;
  if (hasMore) attempts.pop();
  attempts.reverse();
  res.json({ card: card, attempts: attempts, hasMore: hasMore });
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

// GET /api/stats/srs-distribution — buckets by the FSRS interval a card is currently
// scheduled at (srs_due_at minus its last review), using the same perceptual boundaries the
// old fixed-step ladder used (10m/1h/4h/1d/3d/7d/21d/...), so the chart's shape stays
// familiar even though the underlying scheduler is now continuous, not step-indexed. Cards
// still in FSRS's Learning/Relearning state get their own bucket since they're qualitatively
// different from "a Review card with a short interval."
//
// Optional ?days= scopes to cards last reviewed within that window (calendar-day-aligned,
// same pattern as the Study Time fix — never a raw-seconds cutoff, which would let a
// straddled day corrupt the bucket a card falls into). Matches this chart's home inside the
// period-pill-gated "Study Charts" section, where every sibling chart already respects the
// selected window — this one silently didn't, showing an always-all-time snapshot regardless
// of the pill selected.
router.get("/srs-distribution", requireAuth, (req, res) => {
  const parsedWindowDays = parseInt(req.query.days, 10);
  const windowDays = (!isNaN(parsedWindowDays) && parsedWindowDays > 0)
    ? Math.min(90, Math.max(7, parsedWindowDays))
    : null;
  const windowClause = windowDays
    ? "AND date(COALESCE(fsrs_last_review_at, updated_at), 'unixepoch') >= date('now', ?)"
    : "";
  const params = windowDays
    ? [req.session.userId, "-" + windowDays + " days"]
    : [req.session.userId];

  const rows = db.prepare(
    "SELECT bucket, COUNT(*) AS cnt FROM (" +
    "  SELECT" +
    "    CASE" +
    "      WHEN fsrs_state IN (1,3) THEN 'learning'" +
    "      WHEN iv <    3600 THEN 'b_10m'  WHEN iv <   14400 THEN 'b_1h'" +
    "      WHEN iv <   86400 THEN 'b_4h'   WHEN iv <  259200 THEN 'b_1d'" +
    "      WHEN iv <  604800 THEN 'b_3d'   WHEN iv < 1814400 THEN 'b_7d'" +
    "      WHEN iv < 3628800 THEN 'b_21d'  WHEN iv < 7257600 THEN 'b_42d'" +
    "      WHEN iv <14515200 THEN 'b_84d'  WHEN iv <29030400 THEN 'b_168d'" +
    "      WHEN iv <31536000 THEN 'b_336d' ELSE 'b_1yr'" +
    "    END AS bucket" +
    "  FROM (" +
    "    SELECT fsrs_state, srs_due_at - COALESCE(fsrs_last_review_at, updated_at) AS iv" +
    "    FROM card_states WHERE user_id = ? AND srs_due_at IS NOT NULL " + windowClause +
    "  )" +
    ") GROUP BY bucket"
  ).all(...params);
  res.json(rows);
});

// GET /api/stats/future-due — how many cards are due over the next FUTURE_DUE_WINDOW_DAYS days.
// Cards already due or overdue count toward today, and archived classes are left out, so the
// Today bar agrees with the "Due for Review" count instead of reading "nothing due" beside it.
const FUTURE_DUE_WINDOW_DAYS = 14;
router.get("/future-due", requireAuth, (req, res) => {
  const rows = db.prepare(
    "SELECT CASE WHEN cs.srs_due_at <= strftime('%s','now') THEN date('now') " +
    "ELSE date(cs.srs_due_at,'unixepoch') END AS day, COUNT(*) AS cnt " +
    "FROM card_states cs JOIN cards ca ON ca.id = cs.card_id " +
    "JOIN lessons l ON l.id = ca.lesson_id JOIN classes c ON c.id = l.class_id " +
    "WHERE cs.user_id = ? AND c.user_id = ? AND c.archived = 0 " +
    "AND cs.srs_due_at IS NOT NULL AND cs.srs_due_at <= strftime('%s','now') + ? " +
    "GROUP BY day"
  ).all(req.session.userId, req.session.userId, FUTURE_DUE_WINDOW_DAYS * 86400);
  res.json({ days: rows, windowDays: FUTURE_DUE_WINDOW_DAYS });
});

// What the home board and the end of a session need about today: cards answered, the
// streak with its rest days, this week's row, and the user's typical seconds per card.
const MEDIAN_SAMPLE = 200;

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// Today's answers with whether each card had been answered before today (UTC), the day
// boundary every other "today" number uses.
function todayActivity(uid) {
  const dayStart = Math.floor(Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z") / 1000);
  return summarizeToday(db.prepare(
    "SELECT a.card_id, a.duration_ms, EXISTS (SELECT 1 FROM attempts b WHERE b.card_id = a.card_id " +
    "AND b.user_id = a.user_id AND b.created_at < ?) AS seen_before " +
    "FROM attempts a WHERE a.user_id = ? AND a.created_at >= ?"
  ).all(dayStart, uid, dayStart));
}

function todayStats(uid) {
  const days = db.prepare(
    "SELECT DISTINCT date(created_at, 'unixepoch') AS day FROM attempts WHERE user_id = ? ORDER BY day DESC"
  ).all(uid).map(r => r.day);
  const todayStr = new Date().toISOString().slice(0, 10);
  const s = computeStreak(days, todayStr);
  const count = db.prepare(
    "SELECT COUNT(*) AS cnt FROM attempts WHERE user_id = ? AND date(created_at,'unixepoch') = date('now')"
  ).get(uid).cnt;
  // Flashcards and quiz questions take very different times, so each gets its own median;
  // a median, not a mean, so one card left open over lunch does not double the estimate.
  const medianMs = {};
  ["flashcard", "quiz"].forEach(source => {
    medianMs[source] = median(db.prepare(
      "SELECT duration_ms FROM attempts WHERE user_id = ? AND source = ? AND duration_ms > 0 " +
      "ORDER BY created_at DESC LIMIT ?"
    ).all(uid, source, MEDIAN_SAMPLE).map(r => r.duration_ms));
  });
  return {
    date: todayStr,
    count,
    streak: s.streak,
    studiedToday: s.studiedToday,
    restAvailableToday: s.restAvailableToday,
    week: weekRow(days, s.restDays, todayStr),
    medianMs,
    activity: todayActivity(uid)
  };
}

router.get("/today", requireAuth, (req, res) => {
  res.json(todayStats(req.session.userId));
});

// GET /api/stats/reviews-today — answers today to cards first answered on an earlier day,
// used to enforce the daily review cap. First answers to new cards do not count: the cap is
// "Max reviews per day", and the Home strip shows this same number against it.
router.get("/reviews-today", requireAuth, (req, res) => {
  res.json({ count: todayActivity(req.session.userId).reviews });
});

// GET /api/stats/new-card-estimate — estimate how many never-studied cards the user could
// reasonably introduce today, based on historical new-card pace and recent accuracy. A
// separate concept from "Max reviews per day" (reviews-today above) — that caps due-review
// load, this estimates new-card intake; deliberately kept as its own endpoint/number so the
// two "daily budget" concepts don't get merged or confused in the UI.
const NEW_CARD_ACCURACY_WINDOW_DAYS = 7;
const NEW_CARD_COLD_START_MIN_ACTIVE_DAYS = 3;
const NEW_CARD_COLD_START_MIN_RECENT_ATTEMPTS = 10;
const NEW_CARD_COLD_START_DEFAULT = 10;

router.get("/new-card-estimate", requireAuth, (req, res) => {
  const uid = req.session.userId;

  // Historical pace: for each card ever attempted, its first-attempt day is the day it was
  // "new" to this user. Average new-cards-introduced only over days that had >=1 introduction
  // (same "exclude untracked days, don't count as zero" convention as /dashboard's studyTime).
  const introRow = db.prepare(`
    SELECT COUNT(*) AS activeDays, AVG(cnt) AS avgNewPerActiveDay
    FROM (
      SELECT date(first_seen, 'unixepoch') AS day, COUNT(*) AS cnt
      FROM (
        SELECT card_id, MIN(created_at) AS first_seen
        FROM attempts
        WHERE user_id = ?
        GROUP BY card_id
      )
      GROUP BY day
    )
  `).get(uid);
  const activeDays = introRow.activeDays || 0;
  const avgNewPerActiveDay = introRow.avgNewPerActiveDay || 0;

  // Recent performance adjustment
  const accRow = db.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN correct=1 THEN 1 ELSE 0 END) AS correct " +
    "FROM attempts WHERE user_id = ? AND created_at >= strftime('%s','now') - ?"
  ).get(uid, NEW_CARD_ACCURACY_WINDOW_DAYS * 86400);
  const recentTotal   = accRow.total || 0;
  const recentCorrect = accRow.correct || 0;

  let accuracyMultiplier = 1.0;
  if (recentTotal >= NEW_CARD_COLD_START_MIN_RECENT_ATTEMPTS) {
    const acc = recentCorrect / recentTotal;
    accuracyMultiplier = acc >= 0.85 ? 1.15 : acc >= 0.70 ? 1.0 : acc >= 0.50 ? 0.7 : 0.4;
  }

  // Cards never touched at all (no card_states row), non-archived classes only
  const availRow = db.prepare(
    "SELECT COUNT(*) AS n FROM cards ca " +
    "JOIN lessons l ON ca.lesson_id = l.id " +
    "JOIN classes c ON l.class_id = c.id " +
    "LEFT JOIN card_states cs ON cs.card_id = ca.id AND cs.user_id = ? " +
    "WHERE c.user_id = ? AND c.archived = 0 AND cs.card_id IS NULL"
  ).get(uid, uid);
  const availableNewCards = availRow.n || 0;

  const personalized = activeDays >= NEW_CARD_COLD_START_MIN_ACTIVE_DAYS;
  let estimatedNewCards = personalized
    ? Math.round(avgNewPerActiveDay * accuracyMultiplier)
    : Math.min(NEW_CARD_COLD_START_DEFAULT, availableNewCards);
  estimatedNewCards = Math.max(0, Math.min(estimatedNewCards, availableNewCards));

  res.json({
    estimatedNewCards,
    availableNewCards,
    personalized,
    avgNewPerActiveDay: Math.round(avgNewPerActiveDay * 10) / 10,
    activeDays,
    recentAccuracy: recentTotal > 0 ? Math.round((recentCorrect / recentTotal) * 100) : null,
    recentAttempts: recentTotal,
    accuracyMultiplier
  });
});

module.exports = router;
