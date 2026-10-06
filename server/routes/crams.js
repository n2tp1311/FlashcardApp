"use strict";

// Crams: a test date and the lessons it covers (client/app.js, CRAM). Progress is not stored:
// it is read from attempts since the cram began, so an undone answer, an offline replay and an
// answer given outside cram mode all count, with no second copy to keep in step.
const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const router  = express.Router();

const MAX_NAME = 80;
const MAX_LESSONS = 200;
const MAX_MISSED = 5000;
const DAY = 86400;

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function parseIds(text) {
  try { const v = JSON.parse(text || "[]"); return Array.isArray(v) ? v : []; } catch (_) { return []; }
}

function view(row) {
  return {
    id: row.id, name: row.name, lesson_ids: parseIds(row.lesson_ids), test_at: row.test_at,
    created_at: row.created_at, rounds: row.rounds, last_round_at: row.last_round_at,
    last_missed: parseIds(row.last_missed), archived: !!row.archived_at
  };
}

function ownCram(id, userId) {
  return db.prepare("SELECT * FROM crams WHERE id = ? AND user_id = ?").get(id, userId);
}

function isIdList(v, max) {
  return Array.isArray(v) && v.length >= 1 && v.length <= max &&
    v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 64) && new Set(v).size === v.length;
}

// Every lesson must be the user's: a cram over someone else's lesson would read their cards.
function ownsLessons(ids, userId) {
  const marks = ids.map(() => "?").join(",");
  const row = db.prepare(
    "SELECT count(*) AS n FROM lessons l JOIN classes c ON l.class_id = c.id " +
    `WHERE c.user_id = ? AND l.id IN (${marks})`
  ).get(userId, ...ids);
  return row.n === ids.length;
}

// A test from yesterday (set late) to a year out; anything else is a typo in the date.
function validTestAt(v) {
  return Number.isInteger(v) && v > now() - DAY && v < now() + 366 * DAY;
}

function validName(v) {
  return typeof v === "string" && v.trim().length > 0 && v.trim().length <= MAX_NAME;
}

// GET /api/crams -- the user's crams not archived, soonest test first.
router.get("/", requireAuth, (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM crams WHERE user_id = ? AND archived_at IS NULL ORDER BY test_at"
  ).all(req.session.userId);
  res.json({ crams: rows.map(view) });
});

// POST /api/crams  { name, lessonIds, testAt }
router.post("/", requireAuth, (req, res) => {
  const { name, lessonIds, testAt } = req.body || {};
  if (!validName(name)) return res.status(400).json({ error: "name required, at most " + MAX_NAME + " characters" });
  if (!isIdList(lessonIds, MAX_LESSONS)) return res.status(400).json({ error: "lessonIds must be 1-" + MAX_LESSONS + " lesson ids" });
  if (!validTestAt(testAt)) return res.status(400).json({ error: "testAt must be a time within the next year" });
  if (!ownsLessons(lessonIds, req.session.userId)) return res.status(404).json({ error: "Lesson not found" });
  const id = genId();
  db.prepare("INSERT INTO crams (id, user_id, name, lesson_ids, test_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, req.session.userId, name.trim(), JSON.stringify(lessonIds), testAt);
  res.status(201).json(view(ownCram(id, req.session.userId)));
});

// PATCH /api/crams/:id  { name?, testAt?, lessonIds?, archived?, round?: { missed: [cardId] } }
// `round` records a finished round: one more, now, and which cards it missed.
router.patch("/:id", requireAuth, (req, res) => {
  const userId = req.session.userId;
  const cram = ownCram(req.params.id, userId);
  if (!cram) return res.status(404).json({ error: "Not found" });
  const b = req.body || {};
  const sets = [];
  const args = [];
  if (b.name !== undefined) {
    if (!validName(b.name)) return res.status(400).json({ error: "name required, at most " + MAX_NAME + " characters" });
    sets.push("name = ?"); args.push(b.name.trim());
  }
  if (b.testAt !== undefined) {
    if (!validTestAt(b.testAt)) return res.status(400).json({ error: "testAt must be a time within the next year" });
    sets.push("test_at = ?"); args.push(b.testAt);
  }
  if (b.lessonIds !== undefined) {
    if (!isIdList(b.lessonIds, MAX_LESSONS)) return res.status(400).json({ error: "lessonIds must be 1-" + MAX_LESSONS + " lesson ids" });
    if (!ownsLessons(b.lessonIds, userId)) return res.status(404).json({ error: "Lesson not found" });
    sets.push("lesson_ids = ?"); args.push(JSON.stringify(b.lessonIds));
  }
  if (b.archived !== undefined) {
    sets.push("archived_at = ?"); args.push(b.archived ? now() : null);
  }
  if (b.round !== undefined) {
    const missed = b.round && b.round.missed;
    if (!Array.isArray(missed) || missed.length > MAX_MISSED || !missed.every((x) => typeof x === "string" && x.length <= 64))
      return res.status(400).json({ error: "round.missed must be a list of card ids" });
    sets.push("rounds = rounds + 1", "last_round_at = ?", "last_missed = ?");
    args.push(now(), JSON.stringify(missed));
  }
  if (!sets.length) return res.status(400).json({ error: "nothing to change" });
  db.prepare(`UPDATE crams SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...args, cram.id, userId);
  res.json(view(ownCram(cram.id, userId)));
});

router.delete("/:id", requireAuth, (req, res) => {
  const cram = ownCram(req.params.id, req.session.userId);
  if (!cram) return res.status(404).json({ error: "Not found" });
  db.prepare("DELETE FROM crams WHERE id = ?").run(cram.id);
  res.status(204).end();
});

// GET /api/crams/:id/progress -- per card answered since the cram began: right, wrong, last.
// Only cards still in the cram's lessons; a deleted lesson simply drops out.
router.get("/:id/progress", requireAuth, (req, res) => {
  const userId = req.session.userId;
  const cram = ownCram(req.params.id, userId);
  if (!cram) return res.status(404).json({ error: "Not found" });
  const ids = parseIds(cram.lesson_ids);
  if (!ids.length) return res.json({ cards: {} });
  const marks = ids.map(() => "?").join(",");
  const rows = db.prepare(
    "SELECT a.card_id, SUM(a.correct) AS correct, SUM(1 - a.correct) AS wrong, MAX(a.created_at) AS last_at " +
    "FROM attempts a JOIN cards c ON c.id = a.card_id " +
    `WHERE a.user_id = ? AND a.created_at >= ? AND c.lesson_id IN (${marks}) GROUP BY a.card_id`
  ).all(userId, cram.created_at, ...ids);
  const cards = {};
  rows.forEach((r) => { cards[r.card_id] = { correct: r.correct, wrong: r.wrong, last_at: r.last_at }; });
  res.json({ cards });
});

module.exports = router;
