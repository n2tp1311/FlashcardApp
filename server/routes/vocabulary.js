"use strict";

const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { rateLimit, byUser } = require("../middleware/rateLimit");

const router = express.Router();
const saveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  message: "Too many saved words. Try again later.",
  keyFn: byUser,
});

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

router.post("/", requireAuth, saveLimiter, (req, res) => {
  const body = req.body || {};
  const selectedText = typeof body.selected_text === "string" ? body.selected_text.trim() : "";
  const contextText = typeof body.context_text === "string" ? body.context_text.trim() : "";
  const sourceCardId = typeof body.source_card_id === "string" ? body.source_card_id : null;
  if (!selectedText || selectedText.length > 1000)
    return res.status(400).json({ error: "Select 1-1000 characters to save" });
  if (contextText.length > 4000)
    return res.status(400).json({ error: "Context must be at most 4000 characters" });

  let source = null;
  if (sourceCardId) {
    source = db.prepare(
      "SELECT ca.id, cl.name AS class_name, l.title AS lesson_title " +
      "FROM cards ca JOIN lessons l ON l.id = ca.lesson_id " +
      "JOIN classes cl ON cl.id = l.class_id " +
      "WHERE ca.id = ? AND cl.user_id = ?"
    ).get(sourceCardId, req.session.userId);
    if (!source) return res.status(404).json({ error: "Source card not found" });
  }

  const id = genId();
  db.prepare(
    "INSERT INTO vocabulary_requests " +
    "(id, user_id, selected_text, context_text, source_card_id, source_class_name, source_lesson_title) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, req.session.userId, selectedText, contextText,
    source ? source.id : null, source ? source.class_name : null, source ? source.lesson_title : null);

  res.status(201).json({ id, status: "pending" });
});

module.exports = router;
