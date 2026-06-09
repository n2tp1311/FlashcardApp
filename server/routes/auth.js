"use strict";

const express = require("express");
const bcrypt  = require("bcryptjs");
const db      = require("../db");
const router  = express.Router();

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// POST /api/auth/register
router.post("/register", (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email and password are required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: "Email already registered" });
  }
  const hash = bcrypt.hashSync(password, 10);
  const id   = genId();
  db.prepare("INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)")
    .run(id, email.toLowerCase(), name.trim(), hash);

  req.session.userId    = id;
  req.session.userName  = name.trim();
  req.session.userEmail = email.toLowerCase();
  res.json({ id, name: name.trim(), email: email.toLowerCase() });
});

// POST /api/auth/login
router.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  req.session.userId    = user.id;
  req.session.userName  = user.name;
  req.session.userEmail = user.email;
  res.json({ id: user.id, name: user.name, email: user.email });
});

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// GET /api/auth/me
router.get("/me", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  res.json({ id: req.session.userId, name: req.session.userName, email: req.session.userEmail });
});

module.exports = router;
