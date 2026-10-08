"use strict";

// Cloze cards (format "cloze"): data.text is a sentence with gaps in Anki's syntax,
// {{c1::answer}} or {{c1::answer::hint}}, so a card reads the same in both apps. A card
// hides its c1 gaps; other numbers show as plain text. KnowledgeApp sends one sentence per
// gap, each its own card, so each gap gets its own schedule.

const MAX_CLOZE_LEN = 4000;
const GAP = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

function validClozeText(text) {
  if (typeof text !== "string" || !text.trim() || text.length > MAX_CLOZE_LEN) return false;
  let hidden = false;
  for (const m of text.matchAll(GAP)) if (m[1] === "1" && m[2].trim()) hidden = true;
  return hidden;
}

// The sentence with its answers filled in and the markers gone, for search and summaries.
function clozePlain(text) {
  return typeof text === "string" ? text.replace(GAP, (_, n, answer) => answer) : "";
}

module.exports = { MAX_CLOZE_LEN, validClozeText, clozePlain };
