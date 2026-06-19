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

// GET /api/review/due  — returns lesson ids that have SRS-due cards
// Query: ?lessonIds=id1,id2,...
router.get("/due", requireAuth, (req, res) => {
  const ids = req.query.lessonIds ? req.query.lessonIds.split(",") : [];
  if (!ids.length) return res.json({ due: [], schedule: {}, dueCounts: {} });

  const userId = req.session.userId;
  const now    = Math.floor(Date.now() / 1000);
  const placeholders = ids.map(() => "?").join(",");

  const rows = db.prepare(
    "SELECT ca.lesson_id, cs.srs_due_at " +
    "FROM cards ca " +
    "LEFT JOIN card_states cs ON cs.card_id = ca.id AND cs.user_id = ? " +
    `WHERE ca.lesson_id IN (${placeholders})`
  ).all(userId, ...ids);

  const dueCounts = {};
  const nextDue   = {};
  ids.forEach(id => { dueCounts[id] = 0; });

  rows.forEach(r => {
    if (r.srs_due_at !== null && r.srs_due_at <= now) {
      dueCounts[r.lesson_id] = (dueCounts[r.lesson_id] || 0) + 1;
    } else if (r.srs_due_at && r.srs_due_at > now) {
      if (!nextDue[r.lesson_id] || r.srs_due_at < nextDue[r.lesson_id])
        nextDue[r.lesson_id] = r.srs_due_at;
    }
  });

  const due      = ids.filter(id => dueCounts[id] > 0);
  const schedule = {};
  ids.forEach(id => { if (!dueCounts[id] && nextDue[id]) schedule[id] = nextDue[id]; });

  res.json({ due, schedule, dueCounts });
});

module.exports = router;
