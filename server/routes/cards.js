"use strict";

const { validClozeText, validGapfill } = require("../lib/cloze");
const express = require("express");
const path    = require("path");
const fs      = require("fs");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const { previewIntervals } = require("../fsrs");
const { forEachBatch } = require("../lib/batch");
const { isLeech, lapsesSinceEdit, resetLeech } = require("../lib/leech");
const { userScheduler } = require("../lib/memory");
const { UNSCHEDULED_SQL } = require("../lib/mastery");
const router  = express.Router();

const UPLOADS_DIR = path.join(__dirname, "..", "..", "data", "uploads");

// Precomputes what each of the 4 grading buttons would produce for this card, so the
// flashcard screen's interval-preview text never has to duplicate FSRS math client-side.
function attachFsrsPreview(row, sched) {
  var now = new Date();
  var preview = previewIntervals({
    srs_due_at: row.srs_due_at,
    fsrs_stability: row.fsrs_stability,
    fsrs_difficulty: row.fsrs_difficulty,
    fsrs_state: row.fsrs_state,
    fsrs_reps: row.fsrs_reps,
    fsrs_lapses: row.fsrs_lapses,
    fsrs_learning_steps: row.fsrs_learning_steps,
    fsrs_last_review_at: row.fsrs_last_review_at
  }, now, sched);
  row.fsrs_preview_again = preview.again;
  row.fsrs_preview_hard  = preview.hard;
  row.fsrs_preview_good  = preview.good;
  row.fsrs_preview_easy  = preview.easy;
  row.is_leech = isLeech(row);
  row.leech_lapses = lapsesSinceEdit(row);
  row.rewrite_pending = !!row.rewrite_pending;
  return row;
}

function unlinkUpload(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string" || !imageUrl.startsWith("/uploads/")) return;
  try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(imageUrl))); } catch (_) {}
}

function validateCardData(format, data) {
  if (format === "cloze" && !validClozeText(data.text))
    return "cloze requires text with at least one {{c1::answer}} gap";
  if (format === "gapfill" && !validGapfill(data))
    return "gapfill requires text with 2–8 {{cN::answer}} gaps and up to 6 distractors";
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

// Batched instead of a LEFT JOIN against a per-user GROUP BY subquery — that pattern
// aggregates the user's entire attempt history before joining, and was measured taking
// ~24s cold on a real account's data instead of the ~1ms an indexed card_id IN (...)
// lookup takes (idx_attempts_cu / idx_attempts_cu_created cover this exactly).
// forEachBatch chunks at 500 IDs per query — /cards/by-lessons can pass an arbitrarily
// large cardIds array (user-controlled lessonIds selection), and SQLite caps bound
// variables per statement; the old subquery-based JOIN had no such per-card binding.
function batchLastStudiedAt(cardIds, userId) {
  const map = {};
  forEachBatch(cardIds, chunk => {
    const placeholders = chunk.map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT card_id, MAX(created_at) AS last_studied_at FROM attempts WHERE card_id IN (${placeholders}) AND user_id = ? GROUP BY card_id`
    ).all(...chunk, userId);
    rows.forEach(r => { map[r.card_id] = r.last_studied_at; });
  });
  return map;
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

  const cards = db.prepare(
    "SELECT cards.*, cs.known, cs.last_seen_at, cs.srs_due_at, cs.last_correct_source, " +
    "cs.fsrs_stability, cs.fsrs_difficulty, cs.fsrs_state, cs.fsrs_reps, cs.fsrs_lapses, " +
    "cs.fsrs_learning_steps, cs.fsrs_last_review_at, cs.leech_base, " +
    "EXISTS (SELECT 1 FROM rewrite_requests rr WHERE rr.card_id = cards.id AND rr.status = 'pending') AS rewrite_pending " +
    "FROM cards " +
    "LEFT JOIN card_states cs ON cs.card_id = cards.id AND cs.user_id = ? " +
    "WHERE cards.lesson_id = ? " +
    "ORDER BY cards.sort_order, cards.created_at"
  ).all(userId, lessonId);

  const lastStudiedMap = batchLastStudiedAt(cards.map(c => c.id), userId);
  const rows = cards.map(c => ({ ...c, last_studied_at: lastStudiedMap[c.id] ?? null }));

  const sched = userScheduler(db, userId);
  res.json(rows.map(r => attachFsrsPreview({ ...r, data: JSON.parse(r.data) }, sched)));
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

  const cards = db.prepare(
    "SELECT cards.*, cs.known, cs.last_seen_at, cs.srs_due_at, cs.last_correct_source, " +
    "cs.fsrs_stability, cs.fsrs_difficulty, cs.fsrs_state, cs.fsrs_reps, cs.fsrs_lapses, " +
    "cs.fsrs_learning_steps, cs.fsrs_last_review_at, cs.leech_base, " +
    "EXISTS (SELECT 1 FROM rewrite_requests rr WHERE rr.card_id = cards.id AND rr.status = 'pending') AS rewrite_pending " +
    "FROM cards " +
    "LEFT JOIN card_states cs ON cs.card_id = cards.id AND cs.user_id = ? " +
    `WHERE cards.lesson_id IN (${ph}) ` +
    "ORDER BY cards.lesson_id, cards.sort_order, cards.created_at"
  ).all(userId, ...lessonIds);

  const lastStudiedMap = batchLastStudiedAt(cards.map(c => c.id), userId);
  const rows = cards.map(c => ({ ...c, last_studied_at: lastStudiedMap[c.id] ?? null }));

  const sched = userScheduler(db, userId);
  res.json(rows.map(r => attachFsrsPreview({ ...r, data: JSON.parse(r.data) }, sched)));
});

// POST /api/cards/study-now — Home's one-tap session across every class that isn't
// archived: cards due now, most overdue first, then never-answered cards in course order
// (class, lesson, card). The client sends how many of each fit today -- it already holds the
// review cap, the reviews done and the new-card estimate -- and reviews: null means no cap.
// classIds, when given, keeps it to the classes picked on Study now's checklist.
const STUDY_NOW_MAX = 2000;
const STUDY_NOW_MAX_CLASSES = 500;
const STUDY_NOW_COLS =
  "SELECT cards.*, cs.known, cs.last_seen_at, cs.srs_due_at, cs.last_correct_source, " +
  "cs.fsrs_stability, cs.fsrs_difficulty, cs.fsrs_state, cs.fsrs_reps, cs.fsrs_lapses, " +
  "cs.fsrs_learning_steps, cs.fsrs_last_review_at, cs.leech_base, " +
  "EXISTS (SELECT 1 FROM rewrite_requests rr WHERE rr.card_id = cards.id AND rr.status = 'pending') AS rewrite_pending " +
  "FROM cards JOIN lessons l ON cards.lesson_id = l.id JOIN classes c ON l.class_id = c.id ";
router.post("/cards/study-now", requireAuth, (req, res) => {
  const count = (v) => Number.isInteger(v) && v >= 0 ? Math.min(v, STUDY_NOW_MAX) : null;
  const reviews = req.body.reviews === null ? STUDY_NOW_MAX : count(req.body.reviews);
  const fresh = count(req.body.newCards);
  if (reviews === null || fresh === null)
    return res.status(400).json({ error: "reviews and newCards must be whole numbers >= 0 (reviews may be null)" });
  const classIds = req.body.classIds;
  if (classIds !== undefined && classIds !== null &&
      (!Array.isArray(classIds) || !classIds.length || classIds.length > STUDY_NOW_MAX_CLASSES ||
       !classIds.every(id => typeof id === "string" && id.length <= 64)))
    return res.status(400).json({ error: "classIds must be a non-empty list of class ids" });
  const inClasses = classIds ? " AND c.id IN (" + classIds.map(() => "?").join(",") + ")" : "";
  const classArgs = classIds || [];

  const userId = req.session.userId;
  const now = Math.floor(Date.now() / 1000);
  const due = reviews === 0 ? [] : db.prepare(STUDY_NOW_COLS +
    "JOIN card_states cs ON cs.card_id = cards.id AND cs.user_id = ? " +
    "WHERE c.user_id = ? AND c.archived = 0 AND cs.srs_due_at IS NOT NULL AND cs.srs_due_at <= ?" + inClasses + " " +
    "ORDER BY cs.srs_due_at, cards.id LIMIT ?"
  ).all(userId, userId, now, ...classArgs, reviews);
  const unseen = fresh === 0 ? [] : db.prepare(STUDY_NOW_COLS +
    "LEFT JOIN card_states cs ON cs.card_id = cards.id AND cs.user_id = ? " +
    "WHERE c.user_id = ? AND c.archived = 0 AND " + UNSCHEDULED_SQL + inClasses + " " +
    "ORDER BY c.sort_order, c.created_at, l.sort_order, l.created_at, cards.sort_order, cards.created_at LIMIT ?"
  ).all(userId, userId, ...classArgs, fresh);

  const cards = due.concat(unseen);
  const lastStudiedMap = batchLastStudiedAt(cards.map(c => c.id), userId);
  const sched = userScheduler(db, userId);
  const lessonIds = [...new Set(cards.map(c => c.lesson_id))];
  const lessons = [];
  forEachBatch(lessonIds, chunk => {
    lessons.push(...db.prepare(
      `SELECT id, title, class_id FROM lessons WHERE id IN (${chunk.map(() => "?").join(",")})`
    ).all(...chunk));
  });
  res.json({
    cards: cards.map(r => attachFsrsPreview({ ...r, data: JSON.parse(r.data), last_studied_at: lastStudiedMap[r.id] ?? null }, sched)),
    lessons
  });
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
  if (data) {
    db.prepare("UPDATE cards SET upstream_change = NULL, upstream_changed_at = NULL, upstream_prev_data = NULL WHERE id = ?")
      .run(req.params.id);
    // Editing a leech is the fix: its count starts again, and a rewrite still waiting in
    // KnowledgeApp's queue would overwrite the user's own wording.
    if (JSON.stringify(data) !== existing.data) {
      resetLeech(db, req.params.id);
      db.prepare("DELETE FROM rewrite_requests WHERE card_id = ? AND status = 'pending'").run(req.params.id);
    }
  }
  const updated = db.prepare("SELECT * FROM cards WHERE id = ?").get(req.params.id);
  res.json({ ...updated, data: JSON.parse(updated.data) });
});

// The issues a learner can flag a card for, in the order they are stored. A flag may tick
// several; they are kept comma-joined in rewrite_requests.issue. 'leech' is the leech
// prompt's request and stands alone.
const FLAG_ISSUES = ["wrong", "front", "back", "typo", "other"];
const FLAG_NOTE_MAX = 500;
const splitIssues = (stored) => (stored || "leech").split(",");

// The issues in the body, canonical order, or null when they are not a valid flag. `issue`
// (one string) is what the first version of the flag sheet sent.
function flagIssues(body) {
  const raw = Array.isArray(body.issues) ? body.issues : body.issue != null ? [body.issue] : null;
  if (raw == null) return ["leech"];
  if (!raw.length || !raw.every((i) => FLAG_ISSUES.includes(i))) return null;
  return FLAG_ISSUES.filter((i) => raw.includes(i));
}

// POST /api/cards/:id/rewrite-request — ask KnowledgeApp to fix a card: one that keeps being
// forgotten, or one the learner flagged with an issue and an optional note. Only a card synced
// from KnowledgeApp can be fixed there. Asking again keeps the one request; a new flag replaces
// its issue and note, since the latest is what the learner means now.
router.post("/cards/:id/rewrite-request", requireAuth, (req, res) => {
  const userId = req.session.userId;
  if (!ownCard(req.params.id, userId)) return res.status(404).json({ error: "Not found" });
  const body = req.body || {};
  const issues = flagIssues(body);
  if (!issues)
    return res.status(400).json({ error: "issues must be one or more of " + FLAG_ISSUES.join(", ") });
  const issue = issues.join(",");
  const isFlag = issue !== "leech";
  if (body.note != null && typeof body.note !== "string")
    return res.status(400).json({ error: "note must be text" });
  const note = (body.note || "").trim().slice(0, FLAG_NOTE_MAX) || null;
  if (issues.includes("other") && !note)
    return res.status(400).json({ error: "Say what is wrong with the card", code: "noteRequired" });
  const card = db.prepare("SELECT id, external_id, format FROM cards WHERE id = ?").get(req.params.id);
  if (!card.external_id || card.format !== "term-def")
    return res.status(409).json({ error: "Only cards from KnowledgeApp can be rewritten there", code: "notLinked" });
  const pending = db.prepare("SELECT id FROM rewrite_requests WHERE card_id = ? AND status = 'pending'").get(card.id);
  if (pending) {
    if (isFlag)
      db.prepare("UPDATE rewrite_requests SET issue = ?, note = ? WHERE id = ?").run(issue, note, pending.id);
    return res.json({ id: pending.id, status: "pending" });
  }
  const state = db.prepare("SELECT fsrs_lapses, leech_base FROM card_states WHERE card_id = ? AND user_id = ?").get(card.id, userId);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  db.prepare("INSERT INTO rewrite_requests (id, user_id, card_id, lapses, issue, note) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, userId, card.id, lapsesSinceEdit(state), issue, note);
  res.status(201).json({ id, status: "pending" });
});

// GET /api/cards/:id/rewrite-request — the flag sheet's state: the request still waiting, if
// any, and how the last finished one ended, so a card KnowledgeApp left as it was says why.
router.get("/cards/:id/rewrite-request", requireAuth, (req, res) => {
  const userId = req.session.userId;
  if (!ownCard(req.params.id, userId)) return res.status(404).json({ error: "Not found" });
  const pending = db.prepare(
    "SELECT id, issue, note FROM rewrite_requests WHERE card_id = ? AND user_id = ? AND status = 'pending'"
  ).get(req.params.id, userId);
  const last = db.prepare(
    "SELECT issue, outcome, outcome_note, before_term, before_def, after_term, after_def, completed_at FROM rewrite_requests " +
    "WHERE card_id = ? AND user_id = ? AND status = 'completed' ORDER BY completed_at DESC, rowid DESC LIMIT 1"
  ).get(req.params.id, userId);
  res.json({ pending: requestShape(pending), last: requestShape(last) });
});

// `issue` as a list, and the wording columns as {term, definition} pairs (null when absent).
function requestShape(r) {
  if (!r) return null;
  const { issue, before_term, before_def, after_term, after_def, ...rest } = r;
  const shaped = { ...rest, issues: splitIssues(issue) };
  if ("before_term" in r) {
    shaped.before = before_term == null ? null : { term: before_term, definition: before_def || "" };
    shaped.after = after_term == null ? null : { term: after_term, definition: after_def || "" };
  }
  return shaped;
}

// GET /api/rewrite-requests — Your feedback: every flag and rewrite request this learner sent,
// newest first, with the class and the card's current front, and how KnowledgeApp answered.
router.get("/rewrite-requests", requireAuth, (req, res) => {
  const rows = db.prepare(
    "SELECT rr.id, rr.card_id, rr.status, rr.issue, rr.note, rr.outcome, rr.outcome_note, rr.before_term, rr.before_def, " +
    "rr.after_term, rr.after_def, rr.created_at, rr.completed_at, cards.data, classes.name AS class_name " +
    "FROM rewrite_requests rr JOIN cards ON cards.id = rr.card_id JOIN lessons ON lessons.id = cards.lesson_id " +
    "JOIN classes ON classes.id = lessons.class_id WHERE rr.user_id = ? AND classes.user_id = ? " +
    "ORDER BY COALESCE(rr.completed_at, rr.created_at) DESC, rr.rowid DESC LIMIT 100"
  ).all(req.session.userId, req.session.userId);
  res.json({ requests: rows.map(({ data, ...r }) => {
    let term = "";
    try { term = (JSON.parse(data) || {}).term || ""; } catch (_) {}
    return { ...requestShape(r), term };
  }) });
});

// GET /api/cards/:id/needs — the cards this card's definition builds on (cards.needs), from
// the same class, in that order, shaped like a lesson's cards so the study screen can put them
// straight into the session. `weak`: never scheduled, still learning or relearning, or due
// now -- the ones worth reviewing before this card comes back. A card in review and not yet
// due is known well enough and is not offered.
router.get("/cards/:id/needs", requireAuth, (req, res) => {
  const userId = req.session.userId;
  if (!ownCard(req.params.id, userId)) return res.status(404).json({ error: "Not found" });
  const card = db.prepare("SELECT cards.needs, l.class_id FROM cards JOIN lessons l ON l.id = cards.lesson_id WHERE cards.id = ?").get(req.params.id);
  let ids = [];
  try { ids = JSON.parse(card.needs || "[]"); } catch (_) {}
  ids = Array.isArray(ids) ? ids.filter(x => typeof x === "string").slice(0, 10) : [];
  if (!ids.length) return res.json({ cards: [] });
  const rows = db.prepare(
    "SELECT cards.*, cs.known, cs.last_seen_at, cs.srs_due_at, cs.last_correct_source, " +
    "cs.fsrs_stability, cs.fsrs_difficulty, cs.fsrs_state, cs.fsrs_reps, cs.fsrs_lapses, " +
    "cs.fsrs_learning_steps, cs.fsrs_last_review_at, cs.leech_base, " +
    "EXISTS (SELECT 1 FROM rewrite_requests rr WHERE rr.card_id = cards.id AND rr.status = 'pending') AS rewrite_pending " +
    "FROM cards JOIN lessons l ON cards.lesson_id = l.id " +
    "LEFT JOIN card_states cs ON cs.card_id = cards.id AND cs.user_id = ? " +
    `WHERE l.class_id = ? AND cards.id != ? AND cards.external_id IN (${ids.map(() => "?").join(",")})`
  ).all(userId, card.class_id, req.params.id, ...ids);
  const now = Math.floor(Date.now() / 1000);
  const sched = userScheduler(db, userId);
  const order = new Map(ids.map((x, i) => [x, i]));
  res.json({ cards: rows
    .sort((a, b) => order.get(a.external_id) - order.get(b.external_id))
    .map(r => ({ ...attachFsrsPreview({ ...r, data: JSON.parse(r.data) }, sched),
      weak: r.srs_due_at == null || r.fsrs_state !== 2 || r.srs_due_at <= now })) });
});

// POST /api/cards/:id/source-feedback { verdict: "good" | "bad" | null, note?: string }
// "Did this passage help?" under a book passage. 'bad' takes the passage off the card at once
// -- a wrong passage misleads, none does not -- and keeps it in source_rejected, which undo
// (null) puts back and KnowledgeApp reads so it searches past it on the next sync. `note` is
// the learner's optional "what should it show?"; it is typed after the passage is already
// gone, so a 'bad' on a card already judged bad only stores the note.
const MAX_SOURCE_NOTE = 300;
router.post("/cards/:id/source-feedback", requireAuth, (req, res) => {
  if (!ownCard(req.params.id, req.session.userId)) return res.status(404).json({ error: "Not found" });
  const verdict = req.body ? req.body.verdict : undefined;
  if (verdict !== "good" && verdict !== "bad" && verdict !== null)
    return res.status(400).json({ error: "verdict must be good, bad or null" });
  const rawNote = req.body ? req.body.note : null;
  if (rawNote != null && (typeof rawNote !== "string" || rawNote.length > MAX_SOURCE_NOTE))
    return res.status(400).json({ error: "note is text of at most " + MAX_SOURCE_NOTE + " characters" });
  const note = verdict === "bad" && rawNote ? rawNote.replace(/\s+/g, " ").trim() || null : null;
  const card = db.prepare("SELECT source, source_verdict, source_rejected FROM cards WHERE id = ?").get(req.params.id);
  if (verdict === null) {
    if (card.source_verdict === "bad" && card.source == null && card.source_rejected)
      db.prepare("UPDATE cards SET source = source_rejected, source_rejected = NULL, source_verdict = NULL, source_note = NULL WHERE id = ?").run(req.params.id);
    else db.prepare("UPDATE cards SET source_verdict = NULL, source_note = NULL WHERE id = ?").run(req.params.id);
  } else if (verdict === "bad" && card.source_verdict === "bad" && card.source == null && card.source_rejected) {
    db.prepare("UPDATE cards SET source_note = ? WHERE id = ?").run(note, req.params.id);
  } else {
    if (!card.source || !card.source.trim()) return res.status(409).json({ error: "This card has no passage" });
    if (verdict === "bad")
      db.prepare("UPDATE cards SET source_rejected = source, source = NULL, source_verdict = 'bad', source_note = ? WHERE id = ?").run(note, req.params.id);
    else db.prepare("UPDATE cards SET source_verdict = 'good', source_note = NULL WHERE id = ?").run(req.params.id);
  }
  const after = db.prepare("SELECT source, source_verdict FROM cards WHERE id = ?").get(req.params.id);
  res.json({ source: after.source, source_verdict: after.source_verdict });
});

// POST /api/cards/:id/acknowledge-update
router.post("/cards/:id/acknowledge-update", requireAuth, (req, res) => {
  if (!ownCard(req.params.id, req.session.userId))
    return res.status(404).json({ error: "Not found" });
  db.prepare("UPDATE cards SET upstream_change = NULL, upstream_changed_at = NULL, upstream_prev_data = NULL WHERE id = ?")
    .run(req.params.id);
  res.json({ ok: true });
});

// GET /api/upstream-changes — every card KnowledgeApp changed that the user hasn't reviewed.
// Archived classes included: a flagged card still needs a look even if its class is shelved.
router.get("/upstream-changes", requireAuth, (req, res) => {
  const uid = req.session.userId;
  const rows = db.prepare(
    "SELECT ca.id, ca.lesson_id, ca.format, ca.data, ca.upstream_prev_data, ca.upstream_change, " +
    "ca.upstream_changed_at, l.title AS lesson_title, l.class_id, c.name AS class_name, " +
    "c.icon AS class_icon, cs.srs_due_at " +
    "FROM cards ca JOIN lessons l ON ca.lesson_id = l.id JOIN classes c ON l.class_id = c.id " +
    "LEFT JOIN card_states cs ON cs.card_id = ca.id AND cs.user_id = ? " +
    "WHERE c.user_id = ? AND ca.upstream_change IS NOT NULL " +
    "ORDER BY ca.upstream_changed_at DESC, ca.id"
  ).all(uid, uid);
  const count = { updated: 0, deleted: 0, total: rows.length };
  const cards = rows.map(r => {
    count[r.upstream_change] = (count[r.upstream_change] || 0) + 1;
    let data = {};
    let prev = null;
    try { data = JSON.parse(r.data); } catch (_) {}
    if (r.upstream_prev_data) { try { prev = JSON.parse(r.upstream_prev_data); } catch (_) {} }
    const { upstream_prev_data, ...rest } = r;
    return { ...rest, data, prev_data: prev };
  });
  res.json({ count, cards });
});

const MAX_ACK_IDS = 1000;

// POST /api/cards/acknowledge-updates  { cardIds: [...] }
router.post("/cards/acknowledge-updates", requireAuth, (req, res) => {
  const { cardIds } = req.body || {};
  if (!Array.isArray(cardIds) || cardIds.length === 0 || cardIds.length > MAX_ACK_IDS ||
      !cardIds.every(id => typeof id === "string"))
    return res.status(400).json({ error: "cardIds must be an array of 1-" + MAX_ACK_IDS + " card ids" });
  const ids = [...new Set(cardIds)];
  const userId = req.session.userId;

  let owned = 0;
  forEachBatch(ids, chunk => {
    owned += db.prepare(
      "SELECT COUNT(*) AS n FROM cards " +
      "JOIN lessons ON cards.lesson_id = lessons.id " +
      "JOIN classes ON lessons.class_id = classes.id " +
      `WHERE cards.id IN (${chunk.map(() => "?").join(",")}) AND classes.user_id = ?`
    ).get(...chunk, userId).n;
  });
  if (owned !== ids.length) return res.status(403).json({ error: "Forbidden" });

  db.transaction(() => {
    forEachBatch(ids, chunk => {
      db.prepare(
        "UPDATE cards SET upstream_change = NULL, upstream_changed_at = NULL, upstream_prev_data = NULL " +
        `WHERE id IN (${chunk.map(() => "?").join(",")})`
      ).run(...chunk);
    });
  })();
  res.json({ ok: true, count: ids.length });
});

// DELETE /api/cards/:id
router.delete("/cards/:id", requireAuth, (req, res) => {
  if (!ownCard(req.params.id, req.session.userId))
    return res.status(404).json({ error: "Not found" });
  const toDelete = db.prepare("SELECT format, data, external_id FROM cards WHERE id = ?").get(req.params.id);
  if (toDelete && toDelete.format === "image-def") {
    try { unlinkUpload(JSON.parse(toDelete.data).imageUrl); } catch (_) {}
  }
  db.transaction(() => {
    if (toDelete && toDelete.external_id) {
      db.prepare("INSERT INTO external_card_deletions (user_id, external_id, card_id) VALUES (?, ?, ?)")
        .run(req.session.userId, toDelete.external_id, req.params.id);
    }
    db.prepare("DELETE FROM cards WHERE id = ?").run(req.params.id);
  })();
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
  ).run(req.params.cardId, req.session.userId, known === null ? null : known ? 1 : 0); // null: undoing a first grade
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
