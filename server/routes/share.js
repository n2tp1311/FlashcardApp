"use strict";

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const { rateLimit, byUser } = require("../middleware/rateLimit");
const { forEachBatch } = require("../lib/batch");
const router  = express.Router();

// The only unauthenticated route in this file, so this can only key by IP (no
// session to key by). A share link can plausibly get opened by many real people
// behind one shared IP at once — a classroom or office on one NAT — so this is set
// well above that, aiming to catch a scripted/scraping loop rather than a burst of
// legitimate simultaneous viewers.
const viewLimiter = rateLimit({ windowMs: 60 * 1000, max: 100, message: "Too many requests. Try again shortly." });
// cloneClass() runs a transaction inserting every lesson and card of a class — the
// same class of expensive per-request work export/import got throttled for. Both
// sit behind requireAuth, so keyed by userId like export/import. Two separate
// instances (not one shared between both routes) for the same reason export and
// import got separate limiters — one route's usage shouldn't burn the other's quota.
const cloneLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: "Too many clone requests. Try again later.", keyFn: byUser });
const cloneInviteLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: "Too many clone requests. Try again later.", keyFn: byUser });

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function genToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function parseClassTags(row) {
  return Object.assign({}, row, { tags: row.tags ? JSON.parse(row.tags) : [] });
}

// Batched instead of one query per lesson (the same N+1 pattern already fixed in
// cards.js/stats.js this month) — chunked (via forEachBatch) for the same reason
// those fixes were: getClassData() is reachable from GET /view/:token, which is
// public and unauthenticated, making it the most exposed of the three call sites.
//
// `lessonIds` arrives already in the lessons' real display order (getClassData
// passes lessons.map(l => l.id), and that query is ORDER BY sort_order, created_at).
// SQL can't sort by that order directly since lesson_id is an opaque random string —
// `ORDER BY lesson_id` would group cards by that string's alphabetical value instead
// of the lessons' intended order. Sorted here in JS using each id's position in the
// input array instead, so the old per-lesson-query behavior (cards grouped in the
// same order as `lessons`) is preserved.
function getCardsForLessons(lessonIds) {
  const orderOf = new Map(lessonIds.map((id, i) => [id, i]));
  const cards = [];
  forEachBatch(lessonIds, chunk => {
    const placeholders = chunk.map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT * FROM cards WHERE lesson_id IN (${placeholders})`
    ).all(...chunk);
    rows.forEach(c => cards.push({ ...c, data: JSON.parse(c.data) }));
  });
  cards.sort((a, b) =>
    orderOf.get(a.lesson_id) - orderOf.get(b.lesson_id) ||
    a.sort_order - b.sort_order ||
    a.created_at - b.created_at
  );
  return cards;
}

// Helper: get full class data (lessons + cards) for a class id
function getClassData(classId) {
  const cls     = db.prepare("SELECT * FROM classes WHERE id = ?").get(classId);
  const lessons = db.prepare("SELECT * FROM lessons WHERE class_id = ? ORDER BY sort_order, created_at").all(classId);
  const cards   = getCardsForLessons(lessons.map(l => l.id));
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
      "INSERT INTO classes (id, user_id, name, color, icon, sort_order, level, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(newClassId, toUserId, cls.name, cls.color, cls.icon, count, cls.level ?? null, cls.tags || null);
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
router.get("/view/:token", viewLimiter, (req, res) => {
  const link = db.prepare("SELECT * FROM class_share_links WHERE token = ?").get(req.params.token);
  if (!link) return res.status(404).json({ error: "Invalid or expired link" });

  const { cls, lessons, cards } = getClassData(link.class_id);
  const owner = db.prepare("SELECT name FROM users WHERE id = ?").get(cls.user_id);
  // getClassData() keeps tags as a raw JSON string for cloneClass()'s INSERT passthrough —
  // parse it here so the public view response matches every other class-returning endpoint.
  const parsedCls = { ...cls, tags: cls.tags ? JSON.parse(cls.tags) : [] };
  res.json({ cls: parsedCls, lessons, cards, ownerName: owner ? owner.name : "Unknown" });
});

// POST /api/share/clone/:token  — clone shared class into current user's account
router.post("/clone/:token", requireAuth, cloneLimiter, (req, res) => {
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
  res.json(rows.map(parseClassTags));
});

// POST /api/share/clone-invite/:classId  — clone an invited class
router.post("/clone-invite/:classId", requireAuth, cloneInviteLimiter, (req, res) => {
  const invite = db.prepare("SELECT id FROM class_invites WHERE class_id = ? AND user_id = ?")
    .get(req.params.classId, req.session.userId);
  if (!invite) return res.status(403).json({ error: "No access" });

  const newClassId = cloneClass(req.params.classId, req.session.userId);
  res.status(201).json({ classId: newClassId });
});

module.exports = router;
