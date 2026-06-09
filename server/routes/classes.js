"use strict";

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const router  = express.Router();

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// GET /api/classes
router.get("/", requireAuth, (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM classes WHERE user_id = ? ORDER BY sort_order, created_at"
  ).all(req.session.userId);
  res.json(rows);
});

// GET /api/classes/:id
router.get("/:id", requireAuth, (req, res) => {
  const row = db.prepare(
    "SELECT * FROM classes WHERE id = ? AND user_id = ?"
  ).get(req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// POST /api/classes
router.post("/", requireAuth, (req, res) => {
  const { name, color, icon } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const count = db.prepare("SELECT COUNT(*) as n FROM classes WHERE user_id = ?")
    .get(req.session.userId).n;
  const id = genId();
  db.prepare(
    "INSERT INTO classes (id, user_id, name, color, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, req.session.userId, name, color || "#2563eb", icon || "📚", count);
  res.status(201).json(db.prepare("SELECT * FROM classes WHERE id = ?").get(id));
});

// PUT /api/classes/:id
router.put("/:id", requireAuth, (req, res) => {
  const cls = db.prepare("SELECT * FROM classes WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.session.userId);
  if (!cls) return res.status(404).json({ error: "Not found" });
  const { name, color, icon, sort_order } = req.body;
  db.prepare(
    "UPDATE classes SET name = ?, color = ?, icon = ?, sort_order = ? WHERE id = ?"
  ).run(
    name        ?? cls.name,
    color       ?? cls.color,
    icon        ?? cls.icon,
    sort_order  ?? cls.sort_order,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM classes WHERE id = ?").get(req.params.id));
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
