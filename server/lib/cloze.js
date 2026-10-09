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

// Gap-fill cards (format "gapfill"): a short passage whose every gap is hidden at once, all
// filled from a word bank of the answers plus data.distractors. Unlike a cloze card the gap
// numbers are not cards of their own -- the passage is scheduled as one card.
const GAPFILL_MIN_GAPS = 2;
const GAPFILL_MAX_GAPS = 8;
const GAPFILL_MAX_DISTRACTORS = 6;
const GAPFILL_MAX_WORD = 100;

function gapfillAnswers(text) {
  return typeof text === "string" ? [...text.matchAll(GAP)].map(m => m[2].trim()) : [];
}

function validGapfill(data) {
  if (!data || typeof data.text !== "string" || !data.text.trim() || data.text.length > MAX_CLOZE_LEN) return false;
  const answers = gapfillAnswers(data.text);
  if (answers.length < GAPFILL_MIN_GAPS || answers.length > GAPFILL_MAX_GAPS) return false;
  if (answers.some(a => !a || a.length > GAPFILL_MAX_WORD)) return false;
  if (data.title !== undefined && (typeof data.title !== "string" || data.title.length > 200)) return false;
  const d = data.distractors === undefined ? [] : data.distractors;
  if (!Array.isArray(d) || d.length > GAPFILL_MAX_DISTRACTORS) return false;
  return d.every(w => typeof w === "string" && w.trim() && w.length <= GAPFILL_MAX_WORD);
}

module.exports = { MAX_CLOZE_LEN, validClozeText, clozePlain, validGapfill, gapfillAnswers,
  GAPFILL_MIN_GAPS, GAPFILL_MAX_GAPS, GAPFILL_MAX_DISTRACTORS };
