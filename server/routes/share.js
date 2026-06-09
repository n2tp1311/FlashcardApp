"use strict";

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const router  = express.Router();

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function genToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

// Helper: get full class data (lessons + cards) for a class id
function getClassData(classId) {
  const cls     = db.prepare("SELECT * FROM classes WHERE id = ?").get(classId);
  const lessons = db.prepare("SELECT * FROM lessons WHERE class_id = ? ORDER BY sort_order, created_at").all(classId);
  const cards   = lessons.flatMap(l =>
    db.prepare("SELECT * FROM cards WHERE lesson_id = ? ORDER BY sort_order, created_at").all(l.id)
      .map(c => ({ ...c, data: JSON.parse(c.data) }))
  );
  return { cls, lessons, cards };
}

// Helper: clone a class into a user's account
function cloneClass(classId, toUserId) {
  const { cls, lessons, cards } = getClassData(classId);
  const idMap = {};

  db.transaction(() => {
    const newClassId = genId();
    const count = db.prepare("SELECT COUNT(*) as n FROM classes WHERE user_id = ?").get(toUserId).n;
    db.prepare(
      "INSERT INTO classes (id, user_id, name, color, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(newClassId, toUserId, cls.name, cls.color, cls.icon, count);
    idMap[classId] = newClassId;

    lessons.forEach(l => {
      const newId = genId();
      idMap[l.id] = newId;
      db.prepare(
        "INSERT INTO lessons (id, class_id, title, format, sort_order) VALUES (?, ?, ?, ?, ?)"
      ).run(newId, newClassId, l.title, l.format, l.sort_order);
    });

    cards.forEach(c => {
      const newId = genId();
      const lessonId = idMap[c.lesson_id];
      db.prepare(
        "INSERT INTO cards (id, lesson_id, format, data, sort_order) VALUES (?, ?, ?, ?, ?)"
      ).run(newId, lessonId, c.format, JSON.stringify(c.data), c.sort_order);
    });
  })();

  return idMap[classId];
}

// ── Share Link ──────────────────────────────────────────────

// POST /api/share/link/:classId  — generate or return existing share link
router.post("/link/:classId", requireAuth, (req, res) => {
  const cls = db.prepare("SELECT id FROM classes WHERE id = ? AND user_id = ?")
    .get(req.params.classId, req.session.userId);
  if (!cls) return res.status(404).json({ error: "Not found" });

  let link = db.prepare("SELECT token FROM class_share_links WHERE class_id = ?").get(req.params.classId);
  if (!link) {
    const token = genToken();
    db.prepare("INSERT INTO class_share_links (class_id, token) VALUES (?, ?)").run(req.params.classId, token);
    link = { token };
  }
  res.json({ token: link.token });
});

// DELETE /api/share/link/:classId  — revoke share link
router.delete("/link/:classId", requireAuth, (req, res) => {
  const cls = db.prepare("SELECT id FROM classes WHERE id = ? AND user_id = ?")
    .get(req.params.classId, req.session.userId);
  if (!cls) return res.status(404).json({ error: "Not found" });
  db.prepare("DELETE FROM class_share_links WHERE class_id = ?").run(req.params.classId);
  res.status(204).end();
});

// GET /api/share/view/:token  — public: get class info by token (no auth required)
router.get("/view/:token", (req, res) => {
  const link = db.prepare("SELECT * FROM class_share_links WHERE token = ?").get(req.params.token);
  if (!link) return res.status(404).json({ error: "Invalid or expired link" });

  const { cls, lessons, cards } = getClassData(link.class_id);
  const owner = db.prepare("SELECT name FROM users WHERE id = ?").get(cls.user_id);
  res.json({ cls, lessons, cards, ownerName: owner ? owner.name : "Unknown" });
});

// POST /api/share/clone/:token  — clone shared class into current user's account
router.post("/clone/:token", requireAuth, (req, res) => {
  const link = db.prepare("SELECT * FROM class_share_links WHERE token = ?").get(req.params.token);
  if (!link) return res.status(404).json({ error: "Invalid or expired link" });

  // Prevent owner from cloning their own class
  const cls = db.prepare("SELECT user_id FROM classes WHERE id = ?").get(link.class_id);
  if (cls.user_id === req.session.userId) return res.status(400).json({ error: "You already own this class" });

  const newClassId = cloneClass(link.class_id, req.session.userId);
  res.status(201).json({ classId: newClassId });
});

// ── Username Invites ────────────────────────────────────────

// POST /api/share/invite/:classId  — invite user by name or email
router.post("/invite/:classId", requireAuth, (req, res) => {
  const cls = db.prepare("SELECT * FROM classes WHERE id = ? AND user_id = ?")
    .get(req.params.classId, req.session.userId);
  if (!cls) return res.status(404).json({ error: "Not found" });

  const { query } = req.body; // name or email
  if (!query) return res.status(400).json({ error: "query is required" });

  const target = db.prepare("SELECT id, name, email FROM users WHERE email = ? OR name = ? LIMIT 1")
    .get(query.trim(), query.trim());
  if (!target) return res.status(404).json({ error: "User not found" });
  if (target.id === req.session.userId) return res.status(400).json({ error: "Cannot invite yourself" });

  const existing = db.prepare("SELECT id FROM class_invites WHERE class_id = ? AND user_id = ?")
    .get(req.params.classId, target.id);
  if (existing) return res.status(400).json({ error: "User already has access" });

  db.prepare(
    "INSERT INTO class_invites (id, class_id, user_id, invited_by) VALUES (?, ?, ?, ?)"
  ).run(genId(), req.params.classId, target.id, req.session.userId);

  res.status(201).json({ userId: target.id, name: target.name });
});

// GET /api/share/invites/:classId  — list users with access to this class
router.get("/invites/:classId", requireAuth, (req, res) => {
  const cls = db.prepare("SELECT id FROM classes WHERE id = ? AND user_id = ?")
    .get(req.params.classId, req.session.userId);
  if (!cls) return res.status(404).json({ error: "Not found" });

  const rows = db.prepare(
    "SELECT u.id, u.name, u.email, i.created_at FROM class_invites i JOIN users u ON i.user_id = u.id WHERE i.class_id = ?"
  ).all(req.params.classId);
  res.json(rows);
});

// DELETE /api/share/invite/:classId/:userId  — remove user's access
router.delete("/invite/:classId/:userId", requireAuth, (req, res) => {
  const cls = db.prepare("SELECT id FROM classes WHERE id = ? AND user_id = ?")
    .get(req.params.classId, req.session.userId);
  if (!cls) return res.status(404).json({ error: "Not found" });
  db.prepare("DELETE FROM class_invites WHERE class_id = ? AND user_id = ?")
    .run(req.params.classId, req.params.userId);
  res.status(204).end();
});

// GET /api/share/shared-with-me  — classes shared with current user
router.get("/shared-with-me", requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT c.*, u.name as owner_name
     FROM class_invites i
     JOIN classes c ON i.class_id = c.id
     JOIN users u ON c.user_id = u.id
     WHERE i.user_id = ?
     ORDER BY i.created_at DESC`
  ).all(req.session.userId);
  res.json(rows);
});

// POST /api/share/clone-invite/:classId  — clone an invited class
router.post("/clone-invite/:classId", requireAuth, (req, res) => {
  const invite = db.prepare("SELECT id FROM class_invites WHERE class_id = ? AND user_id = ?")
    .get(req.params.classId, req.session.userId);
  if (!invite) return res.status(403).json({ error: "No access" });

  const newClassId = cloneClass(req.params.classId, req.session.userId);
  res.status(201).json({ classId: newClassId });
});

module.exports = router;
