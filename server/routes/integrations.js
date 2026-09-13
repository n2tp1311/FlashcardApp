"use strict";

// KnowledgeApp → FlashcardApp sync. Authenticated by personal API token, not session.
// Every event is safe to replay: outcomes are decided from the card's current state
// (same text → noop, split card already in lesson → skipped), so KnowledgeApp can retry
// a batch whose response it never received without duplicating or re-flagging anything.

const express = require("express");
const db      = require("../db");
const { requireApiToken } = require("../middleware/apiToken");
const { rateLimit, byApiUser } = require("../middleware/rateLimit");
const router  = express.Router();

const MAX_EVENTS = 500;
const MAX_LINK_UNITS = 2000;
const MAX_SPLIT_CARDS = 20;
const MAX_ID_LEN = 128;
const MAX_TEXT_LEN = 20000;
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

function applySplit(anchor, newCards) {
  const existing = new Set(
    db.prepare("SELECT external_id FROM cards WHERE lesson_id = ? AND external_id IS NOT NULL")
      .all(anchor.lesson_id).map(r => r.external_id)
  );
  const toAdd = newCards.filter(c => !existing.has(c.external_id));
  if (toAdd.length === 0) return false;
  db.prepare("UPDATE cards SET sort_order = sort_order + ? WHERE lesson_id = ? AND sort_order > ?")
    .run(toAdd.length, anchor.lesson_id, anchor.sort_order);
  toAdd.forEach((c, i) => {
    db.prepare("INSERT INTO cards (id, lesson_id, format, data, sort_order, external_id) VALUES (?, ?, 'term-def', ?, ?, ?)")
      .run(genId(), anchor.lesson_id, JSON.stringify({ term: c.term.trim(), def: c.def.trim() }), anchor.sort_order + i + 1, c.external_id);
  });
  return true;
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

module.exports = router;
