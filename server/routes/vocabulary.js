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
const listLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: "Too many vocabulary requests. Try again later.",
  keyFn: byUser,
});

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

router.get("/", requireAuth, listLimiter, (req, res) => {
  const requests = db.prepare(
    "SELECT id, selected_text, context_text, source_class_name, source_lesson_title, created_at " +
    "FROM vocabulary_requests WHERE user_id = ? AND status = 'pending' " +
    "ORDER BY created_at, id"
  ).all(req.session.userId);
  res.json({ requests });
});

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

router.delete("/:id", requireAuth, saveLimiter, (req, res) => {
  const result = db.prepare(
    "DELETE FROM vocabulary_requests WHERE id = ? AND user_id = ? AND status = 'pending'"
  ).run(req.params.id, req.session.userId);
  if (result.changes) return res.status(204).end();

  const request = db.prepare(
    "SELECT status FROM vocabulary_requests WHERE id = ? AND user_id = ?"
  ).get(req.params.id, req.session.userId);
  if (!request) return res.status(404).json({ error: "Vocabulary request not found" });
  res.status(409).json({ error: "This word has already been fetched" });
});

module.exports = router;
