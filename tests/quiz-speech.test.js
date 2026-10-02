const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");

function load(withVocab) {
  const start = app.indexOf("\nfunction quizSpeechText(");
  assert.ok(start >= 0, "missing quizSpeechText");
  const ctx = { window: withVocab ? { getVocabularySpeechText: function(s) { return s.replace(/\s*\/[^/]*\/\s*$/, ""); } } : {} };
  vm.createContext(ctx);
  vm.runInContext(app.slice(start, app.indexOf("\n}\n", start) + 3), ctx);
  return ctx;
}

test("the quiz speaker reads the term and nothing else", function() {
  const ctx = load(false);
  assert.equal(ctx.quizSpeechText({ format: "term-def", data: { term: "  ephemeral ", definition: "short-lived" } }), "ephemeral");
});

test("a vocabulary term is read without its IPA", function() {
  const ctx = load(true);
  assert.equal(ctx.quizSpeechText({ format: "term-def", data: { term: "ephemeral /ɪˈfem(ə)rəl/" } }), "ephemeral");
});

test("cards without a term get no speaker", function() {
  const ctx = load(true);
  assert.equal(ctx.quizSpeechText({ format: "mcq", data: { question: "Q?", term: "x" } }), "");
  assert.equal(ctx.quizSpeechText({ format: "true-false", data: { statement: "S" } }), "");
  assert.equal(ctx.quizSpeechText({ format: "image-def", data: { term: "cat" } }), "");
  assert.equal(ctx.quizSpeechText({ format: "term-def", data: {} }), "");
  assert.equal(ctx.quizSpeechText(undefined), "");
});

test("the quiz has a speaker button and lists P in its keymap", function() {
  assert.match(html, /id="btn-quiz-audio"/);
  assert.match(html, /data-i18n="keymap.pronounceTerm"/);
});
