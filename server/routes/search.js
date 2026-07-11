"use strict";
const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const router  = express.Router();

const CARD_TEXT =
  "CASE ca.format " +
  "WHEN 'term-def'   THEN json_extract(ca.data, '$.term') " +
  "WHEN 'mcq'        THEN json_extract(ca.data, '$.question') " +
  "WHEN 'true-false' THEN json_extract(ca.data, '$.statement') " +
  "WHEN 'image-def'  THEN json_extract(ca.data, '$.def') " +
  "ELSE NULL END";

router.get("/", requireAuth, (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 2) return res.json({ classes: [], lessons: [], cards: [] });

  const uid  = req.session.userId;
  const like = "%" + q.toLowerCase() + "%";

  const classes = db.prepare(
    "SELECT id, name, icon, color FROM classes " +
    "WHERE user_id = ? AND LOWER(name) LIKE ? " +
    "ORDER BY sort_order, created_at LIMIT 5"
  ).all(uid, like);

  const lessons = db.prepare(
    "SELECT l.id, l.class_id, l.title, l.format, " +
    "c.name AS class_name, c.icon AS class_icon " +
    "FROM lessons l JOIN classes c ON l.class_id = c.id " +
    "WHERE c.user_id = ? AND LOWER(l.title) LIKE ? " +
    "ORDER BY l.created_at DESC LIMIT 5"
  ).all(uid, like);

  const cards = db.prepare(
    "SELECT ca.id, ca.lesson_id, ca.format, " +
    "(" + CARD_TEXT + ") AS display_text, " +
    "l.title AS lesson_title, l.class_id, " +
    "c.name AS class_name, c.icon AS class_icon " +
    "FROM cards ca " +
    "JOIN lessons l ON ca.lesson_id = l.id " +
    "JOIN classes c ON l.class_id = c.id " +
    "WHERE c.user_id = ? AND LOWER(COALESCE(" + CARD_TEXT + ", '')) LIKE ? LIMIT 5"
  ).all(uid, like);

  res.json({ classes, lessons, cards });
});

module.exports = router;
