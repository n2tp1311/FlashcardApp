"use strict";

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const router  = express.Router();

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function nextReviewAt(pct) {
  const now = Math.floor(Date.now() / 1000);
  if (pct >= 90) return now + 7 * 86400;
  if (pct >= 70) return now + 3 * 86400;
  if (pct >= 50) return now + 86400;
  return now + 4 * 3600;
}

// POST /api/review/sessions
router.post("/sessions", requireAuth, (req, res) => {
  const { lessonIds, score, total } = req.body;
  if (!Array.isArray(lessonIds) || !lessonIds.length || total === undefined)
    return res.status(400).json({ error: "lessonIds[], score, total required" });

  const pct = total > 0 ? (score / total) * 100 : 0;
  const id  = genId();
  db.prepare(
    "INSERT INTO quiz_sessions (id, user_id, lesson_ids, score, total, next_review_at) VALUES (?,?,?,?,?,?)"
  ).run(id, req.session.userId, JSON.stringify(lessonIds), score, total, nextReviewAt(pct));

  res.status(201).json({ ok: true });
});

// GET /api/review/due  — returns lesson ids that are due (or never studied)
// Query: ?lessonIds=id1,id2,...
router.get("/due", requireAuth, (req, res) => {
  const ids = req.query.lessonIds ? req.query.lessonIds.split(",") : [];
  if (!ids.length) return res.json({ due: [] });

  const now = Math.floor(Date.now() / 1000);

  // For each lesson, get the most recent session that covers it
  const due = ids.filter(lessonId => {
    const rows = db.prepare(
      "SELECT next_review_at FROM quiz_sessions WHERE user_id = ? ORDER BY taken_at DESC"
    ).all(req.session.userId);
    const lastSession = rows.find(r => {
      try { return JSON.parse(r.lesson_ids).includes(lessonId); } catch { return false; }
    });
    // Due if never studied OR past next_review_at
    return !lastSession || lastSession.next_review_at <= now;
  });

  // Also return next_review_at for each non-due lesson so the UI can show "review in N days"
  const schedule = {};
  ids.forEach(lessonId => {
    const rows = db.prepare(
      "SELECT next_review_at FROM quiz_sessions WHERE user_id = ? ORDER BY taken_at DESC"
    ).all(req.session.userId);
    const lastSession = rows.find(r => {
      try { return JSON.parse(r.lesson_ids).includes(lessonId); } catch { return false; }
    });
    if (lastSession) schedule[lessonId] = lastSession.next_review_at;
  });

  res.json({ due, schedule });
});

module.exports = router;
