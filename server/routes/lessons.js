"use strict";

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const router  = express.Router();

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function ownClass(classId, userId) {
  return db.prepare("SELECT id FROM classes WHERE id = ? AND user_id = ?").get(classId, userId);
}

function ownLesson(lessonId, userId) {
  return db.prepare(
    "SELECT l.id FROM lessons l JOIN classes c ON l.class_id = c.id WHERE l.id = ? AND c.user_id = ?"
  ).get(lessonId, userId);
}

function parseLessonTags(row) {
  return Object.assign({}, row, { tags: row.tags ? JSON.parse(row.tags) : [] });
}

// Capped at 10 to keep the tag filter bar scannable; lowercased so "Exam-Prep" and
// "exam-prep" don't fragment into two separate filter pills.
function normalizeTags(tags) {
  if (!Array.isArray(tags)) return null;
  var seen = [];
  tags.forEach(function(tag) {
    if (typeof tag !== "string") return;
    var t = tag.trim().toLowerCase();
    if (t && seen.indexOf(t) === -1) seen.push(t);
  });
  return seen.slice(0, 10);
}

// GET /api/classes/:classId/lessons
router.get("/classes/:classId/lessons", requireAuth, (req, res) => {
  if (!ownClass(req.params.classId, req.session.userId))
    return res.status(404).json({ error: "Not found" });
  const rows = db.prepare(`
    SELECT l.*,
      MAX(c.created_at) AS last_modified_at,
      MAX(a.created_at) AS last_interacted_at
    FROM lessons l
    LEFT JOIN cards c ON c.lesson_id = l.id
    LEFT JOIN attempts a ON a.card_id = c.id AND a.user_id = ?
    WHERE l.class_id = ?
    GROUP BY l.id
    ORDER BY l.sort_order, l.created_at
  `).all(req.session.userId, req.params.classId);
  res.json(rows.map(parseLessonTags));
});

// POST /api/classes/:classId/lessons
router.post("/classes/:classId/lessons", requireAuth, (req, res) => {
  if (!ownClass(req.params.classId, req.session.userId))
    return res.status(404).json({ error: "Not found" });
  const { title, format } = req.body;
  if (!title || !format) return res.status(400).json({ error: "title and format required" });
  if (!["term-def", "mcq", "true-false", "image-def"].includes(format))
    return res.status(400).json({ error: "format must be term-def, mcq, true-false, or image-def" });
  const tags = req.body.tags === undefined ? [] : normalizeTags(req.body.tags);
  if (tags === null) return res.status(400).json({ error: "tags must be an array of strings" });
  const count = db.prepare("SELECT COUNT(*) as n FROM lessons WHERE class_id = ?")
    .get(req.params.classId).n;
  const id = genId();
  db.prepare(
    "INSERT INTO lessons (id, class_id, title, format, sort_order, tags) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, req.params.classId, title, format, count, JSON.stringify(tags));
  res.status(201).json(parseLessonTags(db.prepare("SELECT * FROM lessons WHERE id = ?").get(id)));
});

// PUT /api/lessons/:id  (router mounted at /api, so prefix needed)
router.put("/lessons/:id", requireAuth, (req, res) => {
  if (!ownLesson(req.params.id, req.session.userId))
    return res.status(404).json({ error: "Not found" });
  const lesson = db.prepare("SELECT * FROM lessons WHERE id = ?").get(req.params.id);
  const { title, sort_order } = req.body;
  const tags = req.body.tags === undefined ? null : normalizeTags(req.body.tags);
  if (req.body.tags !== undefined && tags === null)
    return res.status(400).json({ error: "tags must be an array of strings" });
  db.prepare("UPDATE lessons SET title = ?, sort_order = ?, tags = ? WHERE id = ?")
    .run(title ?? lesson.title, sort_order ?? lesson.sort_order, tags === null ? lesson.tags : JSON.stringify(tags), req.params.id);
  res.json(parseLessonTags(db.prepare("SELECT * FROM lessons WHERE id = ?").get(req.params.id)));
});

// DELETE /api/lessons/:id
router.delete("/lessons/:id", requireAuth, (req, res) => {
  if (!ownLesson(req.params.id, req.session.userId))
    return res.status(404).json({ error: "Not found" });
  db.prepare("DELETE FROM lessons WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

module.exports = router;
