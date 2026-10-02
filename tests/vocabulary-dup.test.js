"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { findDuplicate, normalizeWord } = require("../server/lib/vocabularyDup");

const rows = [
  { id: "a", status: "pending", selected_text: "Bank", context_text: "We sat on the river bank." },
  { id: "b", status: "completed", selected_text: "resilient", context_text: "" }
];

test("the same word with the same context is a duplicate, ignoring case, spacing and clinging punctuation", function() {
  assert.equal(findDuplicate(rows, "bank,", "We sat on  the RIVER bank.").id, "a");
  assert.equal(normalizeWord(" “Resilient.” "), "resilient");
});

test("the same word in a different context is another meaning and is saved", function() {
  assert.equal(findDuplicate(rows, "bank", "The bank approved the loan."), null);
  assert.equal(findDuplicate(rows, "resilient", "A resilient supply chain."), null, "an earlier save without context does not cover a new one with it");
});

test("a save with no context duplicates any earlier save of the word", function() {
  assert.equal(findDuplicate(rows, "BANK", "").id, "a");
  assert.equal(findDuplicate(rows, "resilient", "  ").id, "b");
  assert.equal(findDuplicate(rows, "banks", ""), null, "a different word form is a different word");
});

test("the route refuses a duplicate before inserting, and a deleted card no longer counts", function() {
  const route = fs.readFileSync(path.join(__dirname, "../server/routes/vocabulary.js"), "utf8");
  assert.match(route, /LEFT JOIN cards c ON c\.id = v\.card_id[\s\S]*v\.status = 'pending' OR c\.id IS NOT NULL/);
  assert.ok(route.indexOf("findDuplicate(standing") < route.indexOf("INSERT INTO vocabulary_requests"));
  assert.match(route, /status\(409\)[\s\S]*"duplicateWordQueued" : "duplicateWordFetched"/);
  const app = fs.readFileSync(path.join(__dirname, "../client/app.js"), "utf8");
  for (const k of ["study.wordAlreadyQueued", "study.wordAlreadyFetched", "vocabulary.duplicatePending", "vocabulary.duplicateFetched"]) {
    assert.equal(app.split('"' + k + '":').length - 1, 2, k);
  }
});
