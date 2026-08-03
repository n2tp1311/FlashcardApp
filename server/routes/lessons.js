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

// GET /api/classes/:classId/lessons
router.get("/classes/:classId/lessons", requireAuth, (req, res) => {
  if (!ownClass(req.params.classId, req.session.userId))
    return res.status(404).json({ error: "Not found" });

  const lessons = db.prepare(
    "SELECT * FROM lessons WHERE class_id = ? ORDER BY sort_order, created_at"
  ).all(req.params.classId);

  if (lessons.length === 0) return res.json(lessons);

  const lessonIds = lessons.map((l) => l.id);
  const placeholders = lessonIds.map(() => "?").join(",");

  // last_modified_at: latest card creation time per lesson (indexed on cards.lesson_id)
  const modifiedRows = db.prepare(`
    SELECT lesson_id, MAX(created_at) AS last_modified_at
    FROM cards
    WHERE lesson_id IN (${placeholders})
    GROUP BY lesson_id
  `).all(...lessonIds);
  const lastModifiedByLesson = new Map(
    modifiedRows.map((r) => [r.lesson_id, r.last_modified_at])
  );

  // last_interacted_at: latest attempt by this user on any card in the lesson,
  // scoped up-front by user_id + lesson set to keep the join small.
  const interactedRows = db.prepare(`
    SELECT c.lesson_id AS lesson_id, MAX(a.created_at) AS last_interacted_at
    FROM cards c
    JOIN attempts a ON a.card_id = c.id
    WHERE c.lesson_id IN (${placeholders}) AND a.user_id = ?
    GROUP BY c.lesson_id
  `).all(...lessonIds, req.session.userId);
  const lastInteractedByLesson = new Map(
    interactedRows.map((r) => [r.lesson_id, r.last_interacted_at])
  );

  const rows = lessons.map((lesson) => ({
    ...lesson,
    last_modified_at: lastModifiedByLesson.get(lesson.id) ?? null,
    last_interacted_at: lastInteractedByLesson.get(lesson.id) ?? null,
  }));

  res.json(rows);
});

// POST /api/classes/:classId/lessons
router.post("/classes/:classId/lessons", requireAuth, (req, res) => {
  if (!ownClass(req.params.classId, req.session.userId))
    return res.status(404).json({ error: "Not found" });
  const { title, format } = req.body;
  if (!title || !format) return res.status(400).json({ error: "title and format required" });
  if (!["term-def", "mcq", "true-false", "image-def"].includes(format))
    return res.status(400).json({ error: "format must be term-def, mcq, true-false, or image-def" });
  const count = db.prepare("SELECT COUNT(*) as n FROM lessons WHERE class_id = ?")
    .get(req.params.classId).n;
  const id = genId();
  db.prepare(
    "INSERT INTO lessons (id, class_id, title, format, sort_order) VALUES (?, ?, ?, ?, ?)"
  ).run(id, req.params.classId, title, format, count);
  res.status(201).json(db.prepare("SELECT * FROM lessons WHERE id = ?").get(id));
});

// PUT /api/lessons/:id  (router mounted at /api, so prefix needed)
router.put("/lessons/:id", requireAuth, (req, res) => {
  if (!ownLesson(req.params.id, req.session.userId))
    return res.status(404).json({ error: "Not found" });
  const lesson = db.prepare("SELECT * FROM lessons WHERE id = ?").get(req.params.id);
  const { title, sort_order } = req.body;
  db.prepare("UPDATE lessons SET title = ?, sort_order = ? WHERE id = ?")
    .run(title ?? lesson.title, sort_order ?? lesson.sort_order, req.params.id);
  res.json(db.prepare("SELECT * FROM lessons WHERE id = ?").get(req.params.id));
});

// DELETE /api/lessons/:id
router.delete("/lessons/:id", requireAuth, (req, res) => {
  if (!ownLesson(req.params.id, req.session.userId))
    return res.status(404).json({ error: "Not found" });
  db.prepare("DELETE FROM lessons WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

module.exports = router;
