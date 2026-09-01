"use strict";

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const { rateLimit, byUser } = require("../middleware/rateLimit");
const classifier = require("../services/classifier");
const router  = express.Router();

// Money-costing endpoint (calls the Anthropic API) — capped well above normal usage (nobody
// legitimately re-suggests tags for the same class more than a few times) but low enough to
// bound worst-case spend from one compromised/abusive account.
const suggestTagsLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 15,
  message: "Too many tag suggestion requests. Try again later.",
  keyFn: byUser
});

// Caps both the number of cards read and each card's contribution — a class with hundreds of
// cards or one card with a huge pasted definition shouldn't blow up the request's token cost.
const MAX_CARDS_FOR_SUGGESTION = 60;
const MAX_CHARS_PER_FIELD = 300;

function truncate(str) {
  if (!str) return "";
  return str.length > MAX_CHARS_PER_FIELD ? str.slice(0, MAX_CHARS_PER_FIELD) + "…" : str;
}

// A third independent copy of the per-format field list, alongside cards.js's validation
// and stats.js's CSV export — each needs different fields (this one keeps both sides of the
// card, not just the front, since tag suggestion benefits from the answer/definition too),
// so there's no single shared helper to reuse here, just the same four format strings.
function extractCardText(format, data) {
  if (format === "term-def") return truncate(data.term) + ": " + truncate(data.def);
  if (format === "mcq") return truncate(data.question) + " — " + truncate(data.correct);
  if (format === "true-false") return truncate(data.statement);
  if (format === "image-def") return truncate(data.def);
  return "";
}

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
    "SELECT cl.*, CASE WHEN cl.archived = 1 THEN 0 ELSE COALESCE(dc.due_count, 0) END AS due_count, " +
      "la.last_activity_at AS last_activity_at " +
    "FROM classes cl " +
    "LEFT JOIN (" +
      "SELECT l.class_id, COUNT(*) AS due_count " +
      "FROM cards ca " +
      "JOIN card_states cs ON cs.card_id = ca.id AND cs.user_id = ? " +
      "JOIN lessons l ON ca.lesson_id = l.id " +
      "WHERE cs.srs_due_at IS NOT NULL AND cs.srs_due_at <= ? " +
      "GROUP BY l.class_id" +
    ") dc ON dc.class_id = cl.id " +
    "LEFT JOIN (" +
      "SELECT l.class_id, MAX(a.created_at) AS last_activity_at " +
      "FROM attempts a " +
      "JOIN cards ca ON ca.id = a.card_id " +
      "JOIN lessons l ON ca.lesson_id = l.id " +
      "WHERE a.user_id = ? " +
      "GROUP BY l.class_id" +
    ") la ON la.class_id = cl.id " +
    "WHERE cl.user_id = ? " +
    "ORDER BY cl.sort_order, cl.created_at"
  ).all(uid, nowSec, uid, uid);
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
  ).run(id, req.session.userId, name, color || "#2563eb", icon || "book", count, normalizeLevel(level, null), JSON.stringify(tags));
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

// POST /api/classes/:id/suggest-tags
router.post("/:id/suggest-tags", requireAuth, suggestTagsLimiter, async (req, res) => {
  const cls = db.prepare("SELECT id FROM classes WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.session.userId);
  if (!cls) return res.status(404).json({ error: "Not found" });

  const cards = db.prepare(
    "SELECT ca.format, ca.data FROM cards ca JOIN lessons l ON ca.lesson_id = l.id " +
    "WHERE l.class_id = ? ORDER BY l.sort_order, ca.sort_order LIMIT ?"
  ).all(req.params.id, MAX_CARDS_FOR_SUGGESTION);

  const cardTexts = cards
    .map(c => {
      // A card whose data fails to parse has nothing usable to extract — skip it outright
      // rather than falling back to {}, which extractCardText would turn into a non-empty
      // placeholder string (e.g. ": " for term-def) that .filter(Boolean) wouldn't catch,
      // silently feeding the model garbage instead of just excluding the card.
      try { return extractCardText(c.format, JSON.parse(c.data)); } catch (_) { return ""; }
    })
    .filter(Boolean);

  try {
    const tags = await classifier.suggestTags(cardTexts);
    // The model is prompted for lowercase/hyphenated/short tags but nothing enforces that on
    // its response — route it through the same normalizeTags() the manual-entry path already
    // uses (trim/lowercase/dedupe/cap at 10) rather than trusting external API output verbatim.
    res.json({ tags: normalizeTags(tags) });
  } catch (err) {
    if (err.code === "no_content")
      return res.status(400).json({ error: "This class has no cards to analyze yet" });
    if (err.code === "not_configured")
      return res.status(501).json({ error: "AI tag suggestions aren't configured on this server" });
    console.error("[classifier] suggestTags failed:", err);
    res.status(502).json({ error: "AI tag suggestion failed — try again" });
  }
});

module.exports = router;
