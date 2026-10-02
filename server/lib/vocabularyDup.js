"use strict";

// One saved word per meaning. The same word saved again with the same context would make
// KnowledgeApp write the same card twice; the same word in a different context may be a
// different sense ("bank" of a river, "bank" that lends), so it is kept. Comparison ignores
// case, runs of whitespace, and punctuation hugging the word (a selection often grabs the
// comma after it). A save with no context has nothing different to say, so any earlier save
// of the word covers it.
function normalizeWord(text) {
  return String(text || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim()
    .replace(/^[\s"'“”‘’.,;:!?()[\]{}]+|[\s"'“”‘’.,;:!?()[\]{}]+$/g, "");
}

function normalizeContext(text) {
  return String(text || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

// rows: the user's earlier requests that still stand -- pending, or completed with their card
// still present. Returns the row the new save duplicates, or null.
function findDuplicate(rows, selectedText, contextText) {
  const word = normalizeWord(selectedText);
  const context = normalizeContext(contextText);
  return rows.find(r => normalizeWord(r.selected_text) === word &&
    (!context || normalizeContext(r.context_text) === context)) || null;
}

module.exports = { findDuplicate, normalizeWord, normalizeContext };
