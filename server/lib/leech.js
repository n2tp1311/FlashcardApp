"use strict";

// A leech is a card forgotten LEECH_LAPSES times since its text last changed. Anki's default
// threshold. Lapses are counted from leech_base, which an edit (by the user or KnowledgeApp)
// moves up to the current count: rewriting the card is the fix, and the rewritten card
// starts clean without losing its FSRS history.
const LEECH_LAPSES = 8;

function lapsesSinceEdit(row) {
  if (!row) return 0;
  return Math.max(0, (row.fsrs_lapses || 0) - (row.leech_base || 0));
}

function isLeech(row) {
  return lapsesSinceEdit(row) >= LEECH_LAPSES;
}

// Called inside the transaction that changes a card's text.
function resetLeech(db, cardId) {
  db.prepare("UPDATE card_states SET leech_base = fsrs_lapses WHERE card_id = ?").run(cardId);
}

module.exports = { LEECH_LAPSES, lapsesSinceEdit, isLeech, resetLeech };
