"use strict";

const db = require("../db");

const MAX_MOVE = 500;

// Moves a user's cards to another lesson, in the same class or another, keeping their review
// state: card_states and attempts are keyed by card, so only lesson_id changes. Recreating a
// card elsewhere would start its reviews over. A KnowledgeApp card (external_id) is not moved:
// KnowledgeApp places it, and its next sync would put it back. A card is moved only into a
// lesson of its own format. Changing class drops the passage, which came from the old book;
// KnowledgeApp searches the new book on its next sync.
// Shared by the learner's Select bar and KnowledgeApp's token, so both refuse the same cards.
// Returns { status, body }.
function moveCards(userId, ids, lessonId) {
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_MOVE || !ids.every(id => typeof id === "string"))
    return { status: 400, body: { error: "card_ids is a list of 1 to " + MAX_MOVE + " ids" } };
  if (typeof lessonId !== "string") return { status: 400, body: { error: "lesson_id is required" } };
  const target = db.prepare(
    "SELECT lessons.id, lessons.class_id, lessons.format FROM lessons JOIN classes ON lessons.class_id = classes.id " +
    "WHERE lessons.id = ? AND classes.user_id = ?").get(lessonId, userId);
  if (!target) return { status: 404, body: { error: "Lesson not found" } };
  const getCard = db.prepare(
    "SELECT cards.id, cards.lesson_id, cards.external_id, lessons.class_id, lessons.format FROM cards " +
    "JOIN lessons ON cards.lesson_id = lessons.id JOIN classes ON lessons.class_id = classes.id " +
    "WHERE cards.id = ? AND classes.user_id = ?");
  const out = { moved: 0, linked: 0, format: 0, not_found: 0 };
  db.transaction(() => {
    let next = db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM cards WHERE lesson_id = ?").get(lessonId).n;
    const move = db.prepare("UPDATE cards SET lesson_id = ?, sort_order = ? WHERE id = ?");
    const dropSource = db.prepare(
      "UPDATE cards SET source = NULL, source_verdict = NULL, source_rejected = NULL, source_note = NULL, " +
      "source_before = NULL, source_after = NULL, source_related = NULL WHERE id = ?");
    [...new Set(ids)].forEach(id => {
      const c = getCard.get(id, userId);
      if (!c) { out.not_found++; return; }
      if (c.external_id) { out.linked++; return; }
      if (c.format !== target.format) { out.format++; return; }
      if (c.lesson_id === lessonId) return;
      move.run(lessonId, next++, id);
      if (c.class_id !== target.class_id) dropSource.run(id);
      out.moved++;
    });
  })();
  return { status: 200, body: out };
}

module.exports = { moveCards, MAX_MOVE };
