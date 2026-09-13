"use strict";

const express = require("express");
const crypto  = require("crypto");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const { hashToken } = require("../middleware/apiToken");
const { rateLimit, byUser } = require("../middleware/rateLimit");
const router  = express.Router();

const MAX_TOKENS_PER_USER = 10;
const createLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: "Too many token requests. Try again later.", keyFn: byUser });

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// GET /api/tokens
router.get("/", requireAuth, (req, res) => {
  res.json(db.prepare(
    "SELECT id, name, prefix, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC"
  ).all(req.session.userId));
});

// POST /api/tokens  { name }  — the plaintext token is returned only here, once
router.post("/", requireAuth, createLimiter, (req, res) => {
  const userId = req.session.userId;
  const raw = req.body && req.body.name;
  if (raw !== undefined && typeof raw !== "string")
    return res.status(400).json({ error: "name must be a string" });
  const name = (raw || "").trim() || "KnowledgeApp";
  if (name.length > 60) return res.status(400).json({ error: "name must be at most 60 characters" });
  const count = db.prepare("SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?").get(userId).n;
  if (count >= MAX_TOKENS_PER_USER)
    return res.status(400).json({ error: "Token limit reached — revoke one first" });

  const token = "fca_" + crypto.randomBytes(32).toString("base64url");
  const id = genId();
  const prefix = token.slice(0, 8);
  db.prepare("INSERT INTO api_tokens (id, user_id, name, token_hash, prefix) VALUES (?, ?, ?, ?, ?)")
    .run(id, userId, name, hashToken(token), prefix);
  const row = db.prepare("SELECT id, name, prefix, created_at, last_used_at FROM api_tokens WHERE id = ?").get(id);
  res.status(201).json({ ...row, token });
});

// DELETE /api/tokens/:id
router.delete("/:id", requireAuth, (req, res) => {
  const existing = db.prepare("SELECT id FROM api_tokens WHERE id = ? AND user_id = ?").get(req.params.id, req.session.userId);
  if (!existing) return res.status(404).json({ error: "Not found" });
  db.prepare("DELETE FROM api_tokens WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

module.exports = router;
