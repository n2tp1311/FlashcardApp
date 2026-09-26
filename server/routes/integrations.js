"use strict";

// KnowledgeApp → FlashcardApp sync. Authenticated by personal API token, not session.
// Every event is safe to replay: outcomes are decided from the card's current state
// (same text → noop, split card already in lesson → skipped), so KnowledgeApp can retry
// a batch whose response it never received without duplicating or re-flagging anything.

const express = require("express");
const db      = require("../db");
const { forEachBatch } = require("../lib/batch");
const { scheduler, cardFromState } = require("../fsrs");
const { requireApiToken } = require("../middleware/apiToken");
const { rateLimit, byApiUser } = require("../middleware/rateLimit");
const router  = express.Router();

const MAX_EVENTS = 500;
const MAX_LINK_UNITS = 2000;
const MAX_SPLIT_CARDS = 20;
const MAX_ID_LEN = 128;
const MAX_TEXT_LEN = 20000;
const MAX_LINK_CARDS = 2000;
const MAX_ADD_CARDS = 500;
const MAX_CONVERT_CARDS = 500;
const MAX_TITLE_LEN = 200;
const EVENT_TYPES = ["updated", "deleted", "restored", "split"];

const limiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: "Too many sync requests. Try again later.", keyFn: byApiUser });
router.use(requireApiToken, limiter);

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function isId(v) {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LEN;
}

function isText(v) {
  return typeof v === "string" && v.trim().length > 0 && v.length <= MAX_TEXT_LEN;
}

function validateEvent(ev) {
  if (!ev || !EVENT_TYPES.includes(ev.type)) return "type must be one of " + EVENT_TYPES.join(", ");
  if (!isId(ev.external_id)) return "external_id required";
  if (ev.type === "updated" || ev.type === "restored") {
    if (!isText(ev.term) || !isText(ev.def)) return "term and def required";
  }
  if (ev.type === "split") {
    if (!Array.isArray(ev.cards) || ev.cards.length < 1 || ev.cards.length > MAX_SPLIT_CARDS)
      return "cards must be an array of 1-" + MAX_SPLIT_CARDS;
    for (const c of ev.cards) {
      if (!c || !isId(c.external_id) || !isText(c.term) || !isText(c.def))
        return "each split card needs external_id, term and def";
    }
  }
  return null;
}

function cardsForExternalId(userId, externalId) {
  return db.prepare(
    "SELECT cards.* FROM cards " +
    "JOIN lessons ON cards.lesson_id = lessons.id " +
    "JOIN classes ON lessons.class_id = classes.id " +
    "WHERE classes.user_id = ? AND cards.external_id = ?"
  ).all(userId, externalId);
}

function applyUpdate(card, term, def, now, userId) {
  if (card.format !== "term-def") return false;
  let old;
  try { old = JSON.parse(card.data); } catch (_) { old = {}; }
  const trimmed = v => (typeof v === "string" ? v.trim() : v);
  if (trimmed(old.term) === term && trimmed(old.def) === def) return false;
  const nextData = JSON.stringify({ ...old, term, def });
  const prev = card.upstream_prev_data ?? card.data;
  if (prev === nextData) {
    db.prepare(
      "UPDATE cards SET data = ?, upstream_change = NULL, upstream_changed_at = NULL, upstream_prev_data = NULL WHERE id = ?"
    ).run(nextData, card.id);
  } else {
    db.prepare(
      "UPDATE cards SET data = ?, upstream_change = 'updated', upstream_changed_at = ?, upstream_prev_data = ? WHERE id = ?"
    ).run(nextData, now, prev, card.id);
    // Due now, but stability/difficulty untouched: a reworded card is re-checked soon
    // without being demoted to brand new. Cards never reviewed have no due date and stay new.
    db.prepare(
      "UPDATE card_states SET srs_due_at = ? WHERE card_id = ? AND user_id = ? AND srs_due_at IS NOT NULL AND srs_due_at > ?"
    ).run(now, card.id, userId, now);
  }
  return true;
}

function applyDeleted(card, now) {
  if (card.upstream_change === "deleted") return false;
  db.prepare("UPDATE cards SET upstream_change = 'deleted', upstream_changed_at = ? WHERE id = ?").run(now, card.id);
  return true;
}

function applyRestored(card, term, def, now, userId) {
  let changed = false;
  if (card.upstream_change === "deleted") {
    const next = card.upstream_prev_data == null ? null : "updated";
    db.prepare("UPDATE cards SET upstream_change = ?, upstream_changed_at = ? WHERE id = ?")
      .run(next, next ? card.upstream_changed_at : null, card.id);
    card = { ...card, upstream_change: next };
    changed = true;
  }
  return applyUpdate(card, term, def, now, userId) || changed;
}

// Rewrites the lesson's order densely (0..n-1) with new cards placed after their anchors.
// A shift of `sort_order > anchor` is not enough: sort_order is COUNT-based and repeats,
// so a card tied with the anchor but created later would still sort before the new cards.
// Opens no transaction; callers run it inside theirs.
function placeInLesson(lessonId, anchored, tail) {
  const rows = db.prepare(
    "SELECT id, sort_order FROM cards WHERE lesson_id = ? ORDER BY sort_order, created_at, rowid"
  ).all(lessonId);
  const order = [];
  rows.forEach(r => {
    order.push({ existing: r });
    (anchored.get(r.id) || []).forEach(item => order.push({ item }));
  });
  tail.forEach(item => order.push({ item }));

  const placed = [];
  order.forEach((entry, i) => {
    if (entry.existing) {
      if (entry.existing.sort_order !== i)
        db.prepare("UPDATE cards SET sort_order = ? WHERE id = ?").run(i, entry.existing.id);
      return;
    }
    const id = genId();
    db.prepare("INSERT INTO cards (id, lesson_id, format, data, sort_order, external_id) VALUES (?, ?, 'term-def', ?, ?, ?)")
      .run(id, lessonId, JSON.stringify({ term: entry.item.term.trim(), def: entry.item.def.trim() }), i, entry.item.external_id);
    placed.push({ item: entry.item, id });
  });
  return placed;
}

function applySplit(anchor, newCards) {
  const existing = new Set(
    db.prepare("SELECT external_id FROM cards WHERE lesson_id = ? AND external_id IS NOT NULL")
      .all(anchor.lesson_id).map(r => r.external_id)
  );
  const toAdd = newCards.filter(c => !existing.has(c.external_id));
  if (toAdd.length === 0) return false;
  placeInLesson(anchor.lesson_id, new Map([[anchor.id, toAdd]]), []);
  return true;
}

function ownClass(userId, classId) {
  return db.prepare("SELECT id, name, archived FROM classes WHERE id = ? AND user_id = ?").get(classId, userId);
}

function ensureVocabularyLesson(userId) {
  const rows = db.prepare("SELECT id, name, archived FROM classes WHERE user_id = ? ORDER BY created_at, id").all(userId);
  let cls = rows.find(row => row.name === "English Vocabulary" && !row.archived);
  if (!cls) {
    const names = new Set(rows.map(row => row.name));
    let name = "English Vocabulary", suffix = 2;
    while (names.has(name)) name = "English Vocabulary (" + suffix++ + ")";
    const id = genId();
    const order = db.prepare("SELECT COUNT(*) AS n FROM classes WHERE user_id = ?").get(userId).n;
    db.prepare("INSERT INTO classes (id, user_id, name, color, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, userId, name, "#0f766e", "book", order);
    cls = { id, name };
  }

  const lessons = db.prepare("SELECT id, title, format FROM lessons WHERE class_id = ? ORDER BY sort_order, created_at")
    .all(cls.id);
  let lesson = lessons.find(row => row.title === "Saved Words" && row.format === "term-def");
  if (!lesson) {
    const titles = new Set(lessons.map(row => row.title));
    let title = "Saved Words", suffix = 2;
    while (titles.has(title)) title = "Saved Words (" + suffix++ + ")";
    const id = genId();
    const order = db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM lessons WHERE class_id = ?")
      .get(cls.id).n;
    db.prepare("INSERT INTO lessons (id, class_id, title, format, sort_order) VALUES (?, ?, ?, 'term-def', ?)")
      .run(id, cls.id, title, order);
    lesson = { id, title, format: "term-def" };
  }
  return { class: cls, lesson };
}

// GET /api/integrations/knowledge/ping — lets KnowledgeApp check its token
router.get("/ping", (req, res) => {
  const user = db.prepare("SELECT email FROM users WHERE id = ?").get(req.userId);
  res.json({ ok: true, email: user ? user.email : null });
});

// POST /api/integrations/knowledge/events  { events: [...] }
router.post("/events", (req, res) => {
  const events = req.body && req.body.events;
  if (!Array.isArray(events) || events.length < 1 || events.length > MAX_EVENTS)
    return res.status(400).json({ error: "events must be an array of 1-" + MAX_EVENTS });
  for (let i = 0; i < events.length; i++) {
    if (!events[i] || !isId(events[i].id))
      return res.status(400).json({ error: "event " + i + ": id required" });
  }

  const userId = req.userId;
  const held = new Set();
  const results = events.map(ev => {
    const invalid = validateEvent(ev);
    if (invalid) return { id: ev.id, status: "invalid", cards: 0, error: invalid };
    if (held.has(ev.external_id))
      return { id: ev.id, status: "error", cards: 0, error: "held: earlier event for this card failed" };
    try {
      return db.transaction(() => {
        const cards = cardsForExternalId(userId, ev.external_id);
        if (cards.length === 0) return { id: ev.id, status: "not_found", cards: 0 };
        const now = Math.floor(Date.now() / 1000);
        let touched = 0;
        cards.forEach(card => {
          let changed = false;
          if (ev.type === "updated")  changed = applyUpdate(card, ev.term.trim(), ev.def.trim(), now, userId);
          if (ev.type === "deleted")  changed = applyDeleted(card, now);
          if (ev.type === "restored") changed = applyRestored(card, ev.term.trim(), ev.def.trim(), now, userId);
          if (ev.type === "split")    changed = applySplit(card, ev.cards);
          if (changed) touched++;
        });
        return { id: ev.id, status: touched ? "applied" : "noop", cards: touched };
      })();
    } catch (e) {
      console.error("[integrations] event failed:", e.message);
      held.add(ev.external_id);
      return { id: ev.id, status: "error", cards: 0, error: "internal error" };
    }
  });
  res.json({ results });
});

// POST /api/integrations/knowledge/link  { units: [{external_id, term, def}] }
// One-time backfill for cards imported before external ids existed: exact trimmed
// term+def match, only fills cards that have no link yet.
router.post("/link", (req, res) => {
  const units = req.body && req.body.units;
  if (!Array.isArray(units) || units.length < 1 || units.length > MAX_LINK_UNITS)
    return res.status(400).json({ error: "units must be an array of 1-" + MAX_LINK_UNITS });

  const byText = new Map();
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (!u || !isId(u.external_id) || typeof u.term !== "string" || typeof u.def !== "string")
      return res.status(400).json({ error: "unit " + i + ": external_id, term and def required" });
    const key = u.term.trim() + "\u0000" + u.def.trim();
    if (!byText.has(key)) byText.set(key, new Set());
    byText.get(key).add(u.external_id);
  }
  let ambiguous = 0;
  byText.forEach((ids, key) => { if (ids.size > 1) { ambiguous++; byText.delete(key); } });

  const cards = db.prepare(
    "SELECT cards.id, cards.data FROM cards " +
    "JOIN lessons ON cards.lesson_id = lessons.id " +
    "JOIN classes ON lessons.class_id = classes.id " +
    "WHERE classes.user_id = ? AND cards.format = 'term-def' AND cards.external_id IS NULL"
  ).all(req.userId);

  const links = [];
  const matched = new Set();
  cards.forEach(card => {
    let data;
    try { data = JSON.parse(card.data); } catch (_) { return; }
    if (typeof data.term !== "string" || typeof data.def !== "string") return;
    const ids = byText.get(data.term.trim() + "\u0000" + data.def.trim());
    if (!ids) return;
    const externalId = ids.values().next().value;
    links.push([externalId, card.id]);
    matched.add(externalId);
  });

  db.transaction(() => {
    const stmt = db.prepare("UPDATE cards SET external_id = ? WHERE id = ? AND external_id IS NULL");
    links.forEach(([externalId, cardId]) => stmt.run(externalId, cardId));
  })();

  res.json({
    linked_cards: links.length,
    matched_units: matched.size,
    unmatched_units: byText.size - matched.size,
    ambiguous
  });
});

// GET /api/integrations/knowledge/classes — what KnowledgeApp can reconcile into
router.get("/classes", (req, res) => {
  const rows = db.prepare(
    "SELECT cl.id, cl.name, cl.archived, COUNT(DISTINCT l.id) AS lessons, COUNT(ca.id) AS cards, " +
    "COALESCE(SUM(ca.format = 'term-def'), 0) AS term_def_cards, COUNT(ca.external_id) AS linked_cards " +
    "FROM classes cl LEFT JOIN lessons l ON l.class_id = cl.id LEFT JOIN cards ca ON ca.lesson_id = l.id " +
    "WHERE cl.user_id = ? GROUP BY cl.id ORDER BY cl.sort_order, cl.created_at"
  ).all(req.userId);
  res.json({ classes: rows.map(r => ({ ...r, archived: !!r.archived })) });
});

// POST /api/integrations/knowledge/classes  { name, color?, icon? }
// Lets KnowledgeApp create the class for a book that has none, so "sync this book" works
// without a manual import. Always creates: KnowledgeApp keeps the book → class mapping and
// only calls this when it has none, and refuses on its side when a class of that name
// already exists (that class is the user's and should be reconciled, not duplicated).
router.post("/classes", (req, res) => {
  const body = req.body || {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > MAX_TITLE_LEN) return res.status(400).json({ error: "name must be 1-" + MAX_TITLE_LEN + " chars" });
  const color = typeof body.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(body.color) ? body.color : "#2563eb";
  const icon = typeof body.icon === "string" && body.icon.length <= 40 ? body.icon : "book";
  const count = db.prepare("SELECT COUNT(*) AS n FROM classes WHERE user_id = ?").get(req.userId).n;
  const id = genId();
  db.prepare("INSERT INTO classes (id, user_id, name, color, icon, sort_order, tags) VALUES (?, ?, ?, ?, ?, ?, '[]')")
    .run(id, req.userId, name, color, icon, count);
  res.status(201).json({ id, name, archived: false, lessons: 0, cards: 0, term_def_cards: 0, linked_cards: 0 });
});

// PUT /api/integrations/knowledge/lessons/:id { title }
// Changes the title in place so card ids and learner progress remain untouched.
router.put("/lessons/:id", (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (!title || Array.from(title).length > MAX_TITLE_LEN)
    return res.status(400).json({ error: "title must be 1-" + MAX_TITLE_LEN + " chars" });
  const lesson = db.prepare(
    "SELECT l.id FROM lessons l JOIN classes c ON l.class_id = c.id WHERE l.id = ? AND c.user_id = ?"
  ).get(req.params.id, req.userId);
  if (!lesson) return res.status(404).json({ error: "Not found" });
  db.prepare("UPDATE lessons SET title = ? WHERE id = ?").run(title, lesson.id);
  res.json({ id: lesson.id, title });
});

// GET /api/integrations/knowledge/classes/:id/cards
// Every card is returned: term-def rows carry term/def, other formats carry their raw
// `data` so KnowledgeApp can rewrite them as term-def (see /convert-cards).
// `position` replaces sort_order, which repeats and so means nothing on its own.
router.get("/classes/:id/cards", (req, res) => {
  const cls = ownClass(req.userId, req.params.id);
  if (!cls) return res.status(404).json({ error: "Not found" });

  const lessons = db.prepare(
    "SELECT l.id, l.title, l.format, COUNT(ca.id) AS card_count FROM lessons l " +
    "LEFT JOIN cards ca ON ca.lesson_id = l.id WHERE l.class_id = ? GROUP BY l.id ORDER BY l.sort_order, l.created_at"
  ).all(cls.id).map((l, i) => ({ id: l.id, title: l.title, format: l.format, position: i, card_count: l.card_count }));

  const rows = db.prepare(
    "SELECT ca.id, ca.lesson_id, ca.format, ca.data, ca.external_id, ca.upstream_change, cs.known, cs.srs_due_at, cs.fsrs_reps, " +
    "cs.fsrs_state, cs.fsrs_stability, cs.fsrs_difficulty, cs.fsrs_lapses, cs.fsrs_last_review_at " +
    "FROM cards ca JOIN lessons l ON ca.lesson_id = l.id " +
    "LEFT JOIN card_states cs ON cs.card_id = ca.id AND cs.user_id = ? " +
    "WHERE l.class_id = ? ORDER BY l.sort_order, l.created_at, ca.sort_order, ca.created_at, ca.rowid"
  ).all(req.userId, cls.id);

  const positions = new Map();
  const cards = [];
  const nowDate = new Date();
  rows.forEach(r => {
    const position = positions.get(r.lesson_id) || 0;
    positions.set(r.lesson_id, position + 1);
    let data;
    try { data = JSON.parse(r.data); } catch (_) { return; }
    const card = {
      id: r.id, lesson_id: r.lesson_id, position, format: r.format,
      external_id: r.external_id, upstream_change: r.upstream_change,
      studied: r.srs_due_at != null || (r.fsrs_reps || 0) > 0,
      known: r.known == null ? null : r.known === 1,
      // Learning progress, read by KnowledgeApp's Fetch to measure how much of a book the
      // learner has actually taken in. Raw FSRS values; the interpretation lives there.
      progress: {
        state: r.fsrs_state == null ? null : r.fsrs_state,          // 0 new, 1 learning, 2 review, 3 relearning
        stability: r.fsrs_stability == null ? null : r.fsrs_stability,   // days
        difficulty: r.fsrs_difficulty == null ? null : r.fsrs_difficulty,
        reps: r.fsrs_reps || 0,
        lapses: r.fsrs_lapses || 0,
        last_review_at: r.fsrs_last_review_at || null,              // unix seconds
        due_at: r.srs_due_at || null,
        // Probability of recall right now, from the same scheduler that sets the due dates,
        // so KnowledgeApp never has to copy FSRS parameters that could drift.
        retrievability: r.fsrs_stability == null || !r.fsrs_last_review_at ? null
          : Number(scheduler.get_retrievability(cardFromState({
              fsrs_stability: r.fsrs_stability, fsrs_difficulty: r.fsrs_difficulty, fsrs_state: r.fsrs_state,
              fsrs_reps: r.fsrs_reps, fsrs_lapses: r.fsrs_lapses, fsrs_last_review_at: r.fsrs_last_review_at,
              srs_due_at: r.srs_due_at }, nowDate), nowDate, false).toFixed(4))
      }
    };
    if (r.format === "term-def") {
      if (typeof data.term !== "string" || typeof data.def !== "string") return;
      card.term = data.term; card.def = data.def;
    } else {
      card.data = data;
    }
    cards.push(card);
  });

  res.json({ class: { id: cls.id, name: cls.name, archived: !!cls.archived }, lessons, cards });
});

// GET /api/integrations/knowledge/deletions?since=<id>
// Linked cards the learner deleted, oldest first, after the cursor KnowledgeApp last saw.
// Read-only: KnowledgeApp keeps the cursor, so a response lost in transit is simply re-read.
router.get("/deletions", (req, res) => {
  const since = Number.parseInt(req.query.since, 10);
  const rows = db.prepare(
    "SELECT id, external_id, card_id, deleted_at FROM external_card_deletions " +
    "WHERE user_id = ? AND id > ? ORDER BY id LIMIT 1000"
  ).all(req.userId, Number.isFinite(since) && since > 0 ? since : 0);
  res.json({ deletions: rows, more: rows.length === 1000 });
});

// POST /api/integrations/knowledge/link-cards  { links: [{card_id, external_id}] }
// Links cards KnowledgeApp matched by meaning, where /link can only match exact text.
// Never overwrites a different link; touches nothing but external_id.
router.post("/link-cards", (req, res) => {
  const links = req.body && req.body.links;
  if (!Array.isArray(links) || links.length < 1 || links.length > MAX_LINK_CARDS)
    return res.status(400).json({ error: "links must be an array of 1-" + MAX_LINK_CARDS });
  for (let i = 0; i < links.length; i++) {
    if (!links[i] || !isId(links[i].card_id) || !isId(links[i].external_id))
      return res.status(400).json({ error: "link " + i + ": card_id and external_id required" });
  }

  try {
    const owned = new Map();
    forEachBatch([...new Set(links.map(l => l.card_id))], chunk => {
      db.prepare(
        "SELECT cards.id, cards.format, cards.external_id FROM cards " +
        "JOIN lessons ON cards.lesson_id = lessons.id JOIN classes ON lessons.class_id = classes.id " +
        "WHERE classes.user_id = ? AND cards.id IN (" + chunk.map(() => "?").join(",") + ")"
      ).all(req.userId, ...chunk).forEach(r => owned.set(r.id, r));
    });

    const counts = { linked: 0, already: 0, conflict: 0, not_found: 0, invalid: 0 };
    const results = [];
    db.transaction(() => {
      links.forEach(l => {
        const card = owned.get(l.card_id);
        let out;
        if (!card) out = { status: "not_found" };
        else if (card.format !== "term-def") out = { status: "invalid", error: "only term-def cards can be linked" };
        else if (card.external_id === l.external_id) out = { status: "already" };
        else if (card.external_id != null) out = { status: "conflict", current_external_id: card.external_id };
        else {
          db.prepare("UPDATE cards SET external_id = ? WHERE id = ? AND external_id IS NULL").run(l.external_id, card.id);
          card.external_id = l.external_id;
          out = { status: "linked" };
        }
        counts[out.status]++;
        results.push({ card_id: l.card_id, external_id: l.external_id, ...out });
      });
    })();
    res.json({ results, ...counts });
  } catch (e) {
    console.error("[integrations] link-cards failed:", e.message);
    res.status(500).json({ error: "internal error" });
  }
});

// POST /api/integrations/knowledge/convert-cards  { cards: [{card_id, term, def}] }
// Rewrites mcq / true-false cards as term-def in place. The card id is kept, so card_states,
// attempts and the FSRS schedule stay exactly as they were — deliberately not made due:
// the user chose to keep the current schedule. The original {format, data} goes to
// converted_from (first conversion only) so it can be undone. A lesson whose cards are all
// term-def afterwards becomes a term-def lesson.
router.post("/convert-cards", (req, res) => {
  const items = req.body && req.body.cards;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_CONVERT_CARDS)
    return res.status(400).json({ error: "cards must be an array of 1-" + MAX_CONVERT_CARDS });
  for (let i = 0; i < items.length; i++) {
    const c = items[i];
    if (!c || !isId(c.card_id) || !isText(c.term) || !isText(c.def))
      return res.status(400).json({ error: "card " + i + ": card_id, term and def required" });
  }

  try {
    const owned = new Map();
    forEachBatch([...new Set(items.map(c => c.card_id))], chunk => {
      db.prepare(
        "SELECT cards.id, cards.lesson_id, cards.format, cards.data, cards.converted_from FROM cards " +
        "JOIN lessons ON cards.lesson_id = lessons.id JOIN classes ON lessons.class_id = classes.id " +
        "WHERE classes.user_id = ? AND cards.id IN (" + chunk.map(() => "?").join(",") + ")"
      ).all(req.userId, ...chunk).forEach(r => owned.set(r.id, r));
    });

    const counts = { converted: 0, already: 0, not_found: 0, invalid: 0 };
    const results = [];
    const touched = new Set();
    const lessonsConverted = [];
    db.transaction(() => {
      items.forEach(c => {
        const card = owned.get(c.card_id);
        const term = c.term.trim(), def = c.def.trim();
        let out;
        if (!card) out = { status: "not_found" };
        else if (card.format === "term-def") {
          let d; try { d = JSON.parse(card.data); } catch (_) { d = {}; }
          out = (typeof d.term === "string" && d.term.trim() === term && typeof d.def === "string" && d.def.trim() === def)
            ? { status: "already" }
            : { status: "invalid", error: "card is already term-def; send an updated event to change its text" };
        } else if (card.format === "image-def") {
          out = { status: "invalid", error: "image-def cards are not converted: the image would be lost" };
        } else {
          db.prepare("UPDATE cards SET format = 'term-def', data = ?, converted_from = COALESCE(converted_from, ?) WHERE id = ?")
            .run(JSON.stringify({ term, def }), JSON.stringify({ format: card.format, data: JSON.parse(card.data) }), card.id);
          card.format = "term-def";
          card.data = JSON.stringify({ term, def });
          touched.add(card.lesson_id);
          out = { status: "converted" };
        }
        counts[out.status]++;
        results.push({ card_id: c.card_id, ...out });
      });

      touched.forEach(lessonId => {
        const left = db.prepare("SELECT COUNT(*) AS n FROM cards WHERE lesson_id = ? AND format != 'term-def'").get(lessonId).n;
        if (left === 0) {
          const changed = db.prepare("UPDATE lessons SET format = 'term-def' WHERE id = ? AND format != 'term-def'").run(lessonId);
          if (changed.changes) lessonsConverted.push(lessonId);
        }
      });
    })();
    res.json({ results, lessons_converted: lessonsConverted, ...counts });
  } catch (e) {
    console.error("[integrations] convert-cards failed:", e.message);
    res.status(500).json({ error: "internal error" });
  }
});

// POST /api/integrations/knowledge/add-cards
//   { class_id, cards: [{external_id, term, def, lesson_id? | after_card_id? | new_lesson_title?}] }
// Adds into an existing class. One transaction per request; replay-safe because an
// external_id already in the class is `exists`, and a new lesson is only created
// when at least one card will actually go into it.
router.post("/add-cards", (req, res) => {
  const body = req.body || {};
  const items = body.cards;
  if (!isId(body.class_id)) return res.status(400).json({ error: "class_id required" });
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ADD_CARDS)
    return res.status(400).json({ error: "cards must be an array of 1-" + MAX_ADD_CARDS });
  for (let i = 0; i < items.length; i++) {
    const c = items[i];
    if (!c || !isId(c.external_id) || !isText(c.term) || !isText(c.def))
      return res.status(400).json({ error: "card " + i + ": external_id, term and def required" });
    if (c.new_lesson_title != null) {
      const t = typeof c.new_lesson_title === "string" ? c.new_lesson_title.trim() : "";
      if (!t || t.length > MAX_TITLE_LEN || c.lesson_id != null || c.after_card_id != null)
        return res.status(400).json({ error: "card " + i + ": new_lesson_title must be 1-" + MAX_TITLE_LEN + " chars, without lesson_id or after_card_id" });
    } else {
      const hasLesson = c.lesson_id != null, hasAnchor = c.after_card_id != null;
      if ((!hasLesson && !hasAnchor) || (hasLesson && !isId(c.lesson_id)) || (hasAnchor && !isId(c.after_card_id)))
        return res.status(400).json({ error: "card " + i + ": lesson_id, after_card_id or new_lesson_title required" });
    }
  }

  const cls = ownClass(req.userId, body.class_id);
  if (!cls) return res.status(404).json({ error: "Not found" });

  try {
    const results = items.map((c, index) => ({ index, external_id: c.external_id }));
    const counts = { added: 0, exists: 0, not_found: 0, invalid: 0 };
    const lessonsOut = [];

    db.transaction(() => {
      const linked = new Map();
      db.prepare(
        "SELECT ca.external_id, ca.id, ca.lesson_id FROM cards ca JOIN lessons l ON ca.lesson_id = l.id " +
        "WHERE l.class_id = ? AND ca.external_id IS NOT NULL ORDER BY ca.created_at"
      ).all(cls.id).forEach(r => { if (!linked.has(r.external_id)) linked.set(r.external_id, r); });
      const lessons = db.prepare("SELECT id, title, format FROM lessons WHERE class_id = ? ORDER BY sort_order, created_at").all(cls.id);
      const lessonById = new Map(lessons.map(l => [l.id, l]));
      const anchorStmt = db.prepare(
        "SELECT cards.id, cards.lesson_id FROM cards JOIN lessons ON cards.lesson_id = lessons.id WHERE cards.id = ? AND lessons.class_id = ?"
      );

      const byLesson = new Map();   // lessonId -> { anchored: Map(anchorId -> items), tail: items }
      const byTitle = new Map();    // title -> [{ item, result }]
      const resultOf = new Map();   // item -> its result row
      const place = (lessonId, anchorId, item, result) => {
        if (!byLesson.has(lessonId)) byLesson.set(lessonId, { anchored: new Map(), tail: [] });
        const slot = byLesson.get(lessonId);
        if (anchorId) {
          if (!slot.anchored.has(anchorId)) slot.anchored.set(anchorId, []);
          slot.anchored.get(anchorId).push(item);
        } else slot.tail.push(item);
        resultOf.set(item, result);
      };

      items.forEach((c, i) => {
        const result = results[i];
        const fail = (status, error) => { result.status = status; if (error) result.error = error; counts[status]++; };
        const hit = linked.get(c.external_id);
        if (hit) {
          // A repeat within this request has no card yet; report it without inventing an id.
          result.status = "exists";
          if (hit.id) { result.card_id = hit.id; result.lesson_id = hit.lesson_id; }
          counts.exists++;
          return;
        }

        if (c.new_lesson_title != null) {
          const title = c.new_lesson_title.trim();
          if (!byTitle.has(title)) byTitle.set(title, []);
          byTitle.get(title).push({ item: c, result });
          linked.set(c.external_id, { id: null, lesson_id: null });
          return;
        }

        let lessonId = c.lesson_id;
        if (c.after_card_id != null) {
          const anchor = anchorStmt.get(c.after_card_id, cls.id);
          if (!anchor) return fail("not_found", "after_card_id not in this class");
          if (lessonId != null && anchor.lesson_id !== lessonId) return fail("invalid", "after_card_id is not in lesson_id");
          lessonId = anchor.lesson_id;
        }
        const lesson = lessonById.get(lessonId);
        if (!lesson) return fail("not_found", "lesson_id not in this class");
        if (lesson.format !== "term-def") return fail("invalid", "lesson is not term-def");

        linked.set(c.external_id, { id: null, lesson_id: lessonId });
        place(lessonId, c.after_card_id || null, c, result);
      });

      byTitle.forEach((entries, title) => {
        let lesson = lessons.find(l => l.format === "term-def" && l.title.trim() === title);
        let created = false;
        if (!lesson) {
          lesson = { id: genId(), title, format: "term-def" };
          db.prepare(
            "INSERT INTO lessons (id, class_id, title, format, sort_order) " +
            "VALUES (?, ?, ?, 'term-def', (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM lessons WHERE class_id = ?))"
          ).run(lesson.id, cls.id, title, cls.id);
          lessons.push(lesson);
          created = true;
        }
        lessonsOut.push({ id: lesson.id, title, created });
        entries.forEach(({ item, result }) => place(lesson.id, null, item, result));
      });

      byLesson.forEach((slot, lessonId) => {
        placeInLesson(lessonId, slot.anchored, slot.tail).forEach(({ item, id }) => {
          const result = resultOf.get(item);
          result.status = "added"; result.card_id = id; result.lesson_id = lessonId;
          counts.added++;
        });
      });
    })();

    res.json({ results, lessons: lessonsOut, ...counts });
  } catch (e) {
    console.error("[integrations] add-cards failed:", e.message);
    res.status(500).json({ error: "internal error" });
  }
});

// GET /api/integrations/knowledge/vocabulary — saved words waiting for enrichment.
router.get("/vocabulary", (req, res) => {
  const rawLimit = req.query.limit == null ? "20" : req.query.limit;
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    return res.status(400).json({ error: "limit must be an integer from 1 to 100" });

  const requests = db.prepare(
    "SELECT id, selected_text, context_text, source_class_name, source_lesson_title, created_at " +
    "FROM vocabulary_requests WHERE user_id = ? AND status = 'pending' " +
    "ORDER BY created_at, id LIMIT ?"
  ).all(req.userId, limit);
  res.json({ requests });
});

// POST /api/integrations/knowledge/vocabulary/:id/complete — add the enriched word to its deck.
router.post("/vocabulary/:id/complete", (req, res) => {
  const body = req.body || {};
  const fields = [
    ["term", 200],
    ["definition", 2000],
    ["example", 1000],
  ];
  for (const [key, max] of fields) {
    if (typeof body[key] !== "string" || !body[key].trim() || body[key].trim().length > max)
      return res.status(400).json({ error: key + " must be a non-empty string of at most " + max + " characters" });
  }

  try {
    const result = db.transaction(() => {
      const request = db.prepare(
        "SELECT id, status, card_id FROM vocabulary_requests WHERE id = ? AND user_id = ?"
      ).get(req.params.id, req.userId);
      if (!request) return { status: "not_found" };
      if (request.status === "completed") return { status: "already", card_id: request.card_id };

      const { class: cls, lesson } = ensureVocabularyLesson(req.userId);
      const order = db.prepare("SELECT COUNT(*) AS n FROM cards WHERE lesson_id = ?").get(lesson.id).n;
      const cardId = genId();
      const definition = body.definition.trim() + "\n\nExample: " + body.example.trim();
      db.prepare("INSERT INTO cards (id, lesson_id, format, data, sort_order) VALUES (?, ?, 'term-def', ?, ?)")
        .run(cardId, lesson.id, JSON.stringify({ term: body.term.trim(), def: definition }), order);
      db.prepare(
        "UPDATE vocabulary_requests SET status = 'completed', card_id = ?, completed_at = unixepoch() " +
        "WHERE id = ? AND user_id = ? AND status = 'pending'"
      ).run(cardId, request.id, req.userId);
      return { status: "completed", card_id: cardId, class_id: cls.id, lesson_id: lesson.id };
    })();

    if (result.status === "not_found") return res.status(404).json({ error: "Vocabulary request not found" });
    res.json(result);
  } catch (e) {
    console.error("[integrations] vocabulary completion failed:", e.message);
    res.status(500).json({ error: "internal error" });
  }
});

module.exports = router;
