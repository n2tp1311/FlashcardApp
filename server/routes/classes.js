"use strict";

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const router  = express.Router();

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function normalizeLevel(val, fallback) {
  if (val === undefined) return fallback;
  if (val === null) return null;
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

function parseClassTags(row) {
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

// GET /api/classes
router.get("/", requireAuth, (req, res) => {
  const uid    = req.session.userId;
  const nowSec = Math.floor(Date.now() / 1000);
  const rows = db.prepare(
    "SELECT cl.*, CASE WHEN cl.archived = 1 THEN 0 ELSE COALESCE(dc.due_count, 0) END AS due_count " +
    "FROM classes cl " +
    "LEFT JOIN (" +
      "SELECT l.class_id, COUNT(*) AS due_count " +
      "FROM cards ca " +
      "JOIN card_states cs ON cs.card_id = ca.id AND cs.user_id = ? " +
      "JOIN lessons l ON ca.lesson_id = l.id " +
      "WHERE cs.srs_due_at IS NOT NULL AND cs.srs_due_at <= ? " +
      "GROUP BY l.class_id" +
    ") dc ON dc.class_id = cl.id " +
    "WHERE cl.user_id = ? " +
    "ORDER BY cl.sort_order, cl.created_at"
  ).all(uid, nowSec, uid);
  res.json(rows.map(parseClassTags));
});

// GET /api/classes/:id
router.get("/:id", requireAuth, (req, res) => {
  const row = db.prepare(
    "SELECT * FROM classes WHERE id = ? AND user_id = ?"
  ).get(req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(parseClassTags(row));
});

// POST /api/classes
router.post("/", requireAuth, (req, res) => {
  const { name, color, icon, level } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const tags = req.body.tags === undefined ? [] : normalizeTags(req.body.tags);
  if (tags === null) return res.status(400).json({ error: "tags must be an array of strings" });
  const count = db.prepare("SELECT COUNT(*) as n FROM classes WHERE user_id = ?")
    .get(req.session.userId).n;
  const id = genId();
  db.prepare(
    "INSERT INTO classes (id, user_id, name, color, icon, sort_order, level, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, req.session.userId, name, color || "#2563eb", icon || "📚", count, normalizeLevel(level, null), JSON.stringify(tags));
  res.status(201).json(parseClassTags(db.prepare("SELECT * FROM classes WHERE id = ?").get(id)));
});

// PUT /api/classes/:id
router.put("/:id", requireAuth, (req, res) => {
  const cls = db.prepare("SELECT * FROM classes WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.session.userId);
  if (!cls) return res.status(404).json({ error: "Not found" });
  const { name, color, icon, sort_order, level, archived } = req.body;
  const tags = req.body.tags === undefined ? null : normalizeTags(req.body.tags);
  if (req.body.tags !== undefined && tags === null)
    return res.status(400).json({ error: "tags must be an array of strings" });
  db.prepare(
    "UPDATE classes SET name = ?, color = ?, icon = ?, sort_order = ?, level = ?, archived = ?, tags = ? WHERE id = ?"
  ).run(
    name        ?? cls.name,
    color       ?? cls.color,
    icon        ?? cls.icon,
    sort_order  ?? cls.sort_order,
    normalizeLevel(level, cls.level),
    archived != null ? (archived ? 1 : 0) : cls.archived,
    tags === null ? cls.tags : JSON.stringify(tags),
    req.params.id
  );
  res.json(parseClassTags(db.prepare("SELECT * FROM classes WHERE id = ?").get(req.params.id)));
});

// DELETE /api/classes/:id
router.delete("/:id", requireAuth, (req, res) => {
  const cls = db.prepare("SELECT id FROM classes WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.session.userId);
  if (!cls) return res.status(404).json({ error: "Not found" });
  db.prepare("DELETE FROM classes WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

module.exports = router;
