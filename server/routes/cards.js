"use strict";

const express = require("express");
const path    = require("path");
const fs      = require("fs");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const router  = express.Router();

const UPLOADS_DIR = path.join(__dirname, "..", "..", "data", "uploads");

function unlinkUpload(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string" || !imageUrl.startsWith("/uploads/")) return;
  try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(imageUrl))); } catch (_) {}
}

function validateCardData(format, data) {
  if (format === "image-def") {
    if (!data.imageUrl || typeof data.imageUrl !== "string" || !data.imageUrl.startsWith("/uploads/"))
      return "image-def requires imageUrl starting with /uploads/";
    if (!data.def || typeof data.def !== "string" || !data.def.trim())
      return "image-def requires def (text definition)";
  }
  if (format === "true-false") {
    if (!data.statement || typeof data.statement !== "string" || !data.statement.trim())
      return "true-false requires statement";
    if (data.correct !== "true" && data.correct !== "false")
      return 'true-false requires correct to be "true" or "false"';
    if (data.explanation !== undefined && (typeof data.explanation !== "string" || !data.explanation.trim()))
      return "true-false explanation must be a non-empty string if provided";
  }
  return null;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function ownLesson(lessonId, userId) {
  return db.prepare(
    "SELECT l.id, l.format FROM lessons l JOIN classes c ON l.class_id = c.id WHERE l.id = ? AND c.user_id = ?"
  ).get(lessonId, userId);
}

function ownCard(cardId, userId) {
  return db.prepare(
    "SELECT cards.id, cards.lesson_id FROM cards " +
    "JOIN lessons ON cards.lesson_id = lessons.id " +
    "JOIN classes ON lessons.class_id = classes.id " +
    "WHERE cards.id = ? AND classes.user_id = ?"
  ).get(cardId, userId);
}

// GET /api/lessons/:lessonId/cards
router.get("/lessons/:lessonId/cards", requireAuth, (req, res) => {
  if (!ownLesson(req.params.lessonId, req.session.userId))
    return res.status(404).json({ error: "Not found" });

  const userId = req.session.userId;
  const lessonId = req.params.lessonId;

  const rows = db.prepare(
    "SELECT cards.*, cs.known, cs.last_seen_at, cs.srs_step, cs.srs_due_at, la.last_studied_at " +
    "FROM cards " +
    "LEFT JOIN card_states cs ON cs.card_id = cards.id AND cs.user_id = ? " +
    "LEFT JOIN (SELECT card_id, MAX(created_at) AS last_studied_at FROM attempts WHERE user_id = ? GROUP BY card_id) la ON la.card_id = cards.id " +
    "WHERE cards.lesson_id = ? " +
    "ORDER BY cards.sort_order, cards.created_at"
  ).all(userId, userId, lessonId);

  res.json(rows.map(r => ({ ...r, data: JSON.parse(r.data) })));
});

// POST /api/cards/by-lessons  { lessonIds: [...] }  — bulk load for multi-lesson quiz
router.post("/cards/by-lessons", requireAuth, (req, res) => {
  const { lessonIds } = req.body;
  if (!Array.isArray(lessonIds) || lessonIds.length === 0)
    return res.status(400).json({ error: "lessonIds array required" });

  const userId = req.session.userId;
  const ph = lessonIds.map(() => "?").join(",");

  const owned = db.prepare(
    `SELECT l.id FROM lessons l JOIN classes c ON l.class_id = c.id WHERE l.id IN (${ph}) AND c.user_id = ?`
  ).all(...lessonIds, userId);

  if (owned.length !== lessonIds.length)
    return res.status(404).json({ error: "Not found" });

  const rows = db.prepare(
    "SELECT cards.*, cs.known, cs.last_seen_at, cs.srs_step, cs.srs_due_at, la.last_studied_at " +
    "FROM cards " +
    "LEFT JOIN card_states cs ON cs.card_id = cards.id AND cs.user_id = ? " +
    "LEFT JOIN (SELECT card_id, MAX(created_at) AS last_studied_at FROM attempts WHERE user_id = ? GROUP BY card_id) la ON la.card_id = cards.id " +
    `WHERE cards.lesson_id IN (${ph}) ` +
    "ORDER BY cards.lesson_id, cards.sort_order, cards.created_at"
  ).all(userId, userId, ...lessonIds);

  res.json(rows.map(r => ({ ...r, data: JSON.parse(r.data) })));
});

// POST /api/lessons/:lessonId/cards
router.post("/lessons/:lessonId/cards", requireAuth, (req, res) => {
  const lesson = ownLesson(req.params.lessonId, req.session.userId);
  if (!lesson) return res.status(404).json({ error: "Not found" });
  const { format, data } = req.body;
  if (!format || !data) return res.status(400).json({ error: "format and data required" });
  if (format === "mcq") {
    if (!data.question || !data.correct || !Array.isArray(data.distractors) ||
        data.distractors.length < 1 || data.distractors.length > 4)
      return res.status(400).json({ error: "mcq requires question, correct, and 1–4 distractors" });
    if (data.explanation !== undefined && (typeof data.explanation !== "string" || !data.explanation.trim()))
      return res.status(400).json({ error: "explanation must be a non-empty string if provided" });
  }
  const validErr = validateCardData(format, data);
  if (validErr) return res.status(400).json({ error: validErr });
  const count = db.prepare("SELECT COUNT(*) as n FROM cards WHERE lesson_id = ?")
    .get(req.params.lessonId).n;
  const id = genId();
  db.prepare(
    "INSERT INTO cards (id, lesson_id, format, data, sort_order) VALUES (?, ?, ?, ?, ?)"
  ).run(id, req.params.lessonId, format, JSON.stringify(data), count);
  const card = db.prepare("SELECT * FROM cards WHERE id = ?").get(id);
  res.status(201).json({ ...card, data: JSON.parse(card.data) });
});

// POST /api/lessons/:lessonId/cards/bulk
router.post("/lessons/:lessonId/cards/bulk", requireAuth, (req, res) => {
  const lesson = ownLesson(req.params.lessonId, req.session.userId);
  if (!lesson) return res.status(404).json({ error: "Not found" });
  const { cards } = req.body;
  if (!Array.isArray(cards) || cards.length === 0)
    return res.status(400).json({ error: "cards array required" });

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    if (c.format === "mcq") {
      if (!c.data || !c.data.question || !c.data.correct || !Array.isArray(c.data.distractors) ||
          c.data.distractors.length < 1 || c.data.distractors.length > 4)
        return res.status(400).json({ error: "mcq card " + i + ": requires question, correct, and 1–4 distractors" });
      if (c.data.explanation !== undefined && (typeof c.data.explanation !== "string" || !c.data.explanation.trim()))
        return res.status(400).json({ error: "mcq card " + i + ": explanation must be a non-empty string if provided" });
    }
    const bulkErr = validateCardData(c.format, c.data || {});
    if (bulkErr) return res.status(400).json({ error: "card " + i + ": " + bulkErr });
  }

  const startOrder = db.prepare("SELECT COUNT(*) as n FROM cards WHERE lesson_id = ?")
    .get(req.params.lessonId).n;

  const insert = db.prepare(
    "INSERT INTO cards (id, lesson_id, format, data, sort_order) VALUES (?, ?, ?, ?, ?)"
  );
  const insertMany = db.transaction((items) => {
    return items.map((c, i) => {
      const id = genId();
      insert.run(id, req.params.lessonId, c.format, JSON.stringify(c.data), startOrder + i);
      return id;
    });
  });

  const ids = insertMany(cards);
  const created = db.prepare(
    `SELECT * FROM cards WHERE id IN (${ids.map(() => "?").join(",")})`
  ).all(...ids);
  res.status(201).json(created.map(r => ({ ...r, data: JSON.parse(r.data) })));
});

// PUT /api/cards/:id  (router mounted at /api, so prefix needed)
router.put("/cards/:id", requireAuth, (req, res) => {
  const card = ownCard(req.params.id, req.session.userId);
  if (!card) return res.status(404).json({ error: "Not found" });
  const existing = db.prepare("SELECT * FROM cards WHERE id = ?").get(req.params.id);
  const existingData = JSON.parse(existing.data);
  const { data, sort_order } = req.body;
  if (data) {
    const validErr = validateCardData(existing.format, data);
    if (validErr) return res.status(400).json({ error: validErr });
    if (existing.format === "image-def" && existingData.imageUrl && data.imageUrl !== existingData.imageUrl)
      unlinkUpload(existingData.imageUrl);
  }
  db.prepare("UPDATE cards SET data = ?, sort_order = ? WHERE id = ?")
    .run(
      data       ? JSON.stringify(data) : existing.data,
      sort_order ?? existing.sort_order,
      req.params.id
    );
  const updated = db.prepare("SELECT * FROM cards WHERE id = ?").get(req.params.id);
  res.json({ ...updated, data: JSON.parse(updated.data) });
});

// DELETE /api/cards/:id
router.delete("/cards/:id", requireAuth, (req, res) => {
  if (!ownCard(req.params.id, req.session.userId))
    return res.status(404).json({ error: "Not found" });
  const toDelete = db.prepare("SELECT format, data FROM cards WHERE id = ?").get(req.params.id);
  if (toDelete && toDelete.format === "image-def") {
    try { unlinkUpload(JSON.parse(toDelete.data).imageUrl); } catch (_) {}
  }
  db.prepare("DELETE FROM cards WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

// POST /api/cards/seen  { cardIds: [...] }
router.post("/cards/seen", requireAuth, (req, res) => {
  const { cardIds } = req.body;
  if (!Array.isArray(cardIds) || cardIds.length === 0)
    return res.json({ ok: true });

  const userId = req.session.userId;

  // Verify ownership — all cards must belong to this user
  const placeholders = cardIds.map(() => "?").join(",");
  const owned = db.prepare(
    "SELECT cards.id FROM cards " +
    "JOIN lessons ON cards.lesson_id = lessons.id " +
    "JOIN classes ON lessons.class_id = classes.id " +
    `WHERE cards.id IN (${placeholders}) AND classes.user_id = ?`
  ).all(...cardIds, userId);

  if (owned.length !== cardIds.length)
    return res.status(403).json({ error: "Forbidden" });

  // Batch upsert last_seen_at — does NOT touch known or updated_at
  const upsert = db.prepare(
    "INSERT INTO card_states (card_id, user_id, last_seen_at) VALUES (?, ?, unixepoch()) " +
    "ON CONFLICT(card_id, user_id) DO UPDATE SET last_seen_at = unixepoch()"
  );
  const batchUpsert = db.transaction((ids) => {
    ids.forEach(id => upsert.run(id, userId));
  });
  batchUpsert(cardIds);

  res.json({ ok: true });
});

// PUT /api/cards/states/:cardId
router.put("/cards/states/:cardId", requireAuth, (req, res) => {
  if (!ownCard(req.params.cardId, req.session.userId))
    return res.status(404).json({ error: "Not found" });
  const { known } = req.body;
  db.prepare(
    "INSERT INTO card_states (card_id, user_id, known, updated_at) VALUES (?, ?, ?, unixepoch()) " +
    "ON CONFLICT(card_id, user_id) DO UPDATE SET known = excluded.known, updated_at = unixepoch()"
  ).run(req.params.cardId, req.session.userId, known ? 1 : 0);
  res.json({ ok: true });
});

// GET /api/lessons/:lessonId/states  (already correct — no prefix change needed)
router.get("/lessons/:lessonId/states", requireAuth, (req, res) => {
  if (!ownLesson(req.params.lessonId, req.session.userId))
    return res.status(404).json({ error: "Not found" });
  const rows = db.prepare(
    "SELECT cs.card_id, cs.known FROM card_states cs " +
    "JOIN cards ON cs.card_id = cards.id " +
    "WHERE cards.lesson_id = ? AND cs.user_id = ?"
  ).all(req.params.lessonId, req.session.userId);
  const map = {};
  rows.forEach(r => { map[r.card_id] = r.known === 1; });
  res.json(map);
});

module.exports = router;
