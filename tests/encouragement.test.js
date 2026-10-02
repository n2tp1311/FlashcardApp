const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..", "client");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "style.css"), "utf8");

const start = app.indexOf("var QUIZ_PRAISE_COUNT");
const end = app.indexOf("function showQuizSheet(");
assert.ok(start > 0 && end > start, "encouragement block not found in app.js");

function load(random) {
  const ctx = {
    Math: Object.create(Math),
    t: function(key, vars) { return vars ? key + ":" + vars.n : key; }
  };
  if (random) ctx.Math.random = random;
  vm.createContext(ctx);
  vm.runInContext(app.slice(start, end), ctx);
  return ctx;
}

test("a wrong answer gets a calm line and no praise", function() {
  const r = load().quizEncouragement(false, 0, 4, 10, 2);
  assert.equal(r.tone, "wrong");
  assert.match(r.title, /^enc\.wrong[123]$/);
  assert.equal(r.sub, "enc.wrongSub");
  assert.equal(r.praise, undefined);
});

test("3, 5, 10 and every tenth in a row are combos; others are praise", function() {
  const ctx = load();
  assert.equal(ctx.quizEncouragement(true, 3, 3, 20).title, "enc.combo3:3");
  assert.equal(ctx.quizEncouragement(true, 5, 5, 20).title, "enc.combo5:5");
  assert.equal(ctx.quizEncouragement(true, 10, 10, 20).title, "enc.combo10:10");
  assert.equal(ctx.quizEncouragement(true, 20, 20, 20).title, "enc.combo10:20");
  for (const n of [1, 2, 4, 6, 9, 11, 15]) {
    assert.equal(ctx.quizEncouragement(true, n, n, 30).tone, "correct", "streak " + n);
  }
});

test("praise never repeats the previous phrase", function() {
  const seq = [0, 0, 0.5];
  const ctx = load(function() { return seq.length ? seq.shift() : 0.9; });
  // The first draw lands on phrase 1, which was last; it must draw again.
  const r = ctx.quizEncouragement(true, 1, 1, 30, 1);
  assert.notEqual(r.praise, 1);
  assert.equal(r.title, "enc.right" + r.praise);
});

test("halfway and one-left notes replace the praise subtitle", function() {
  const ctx = load();
  assert.equal(ctx.quizEncouragement(true, 1, 5, 10).sub, "enc.half");
  assert.equal(ctx.quizEncouragement(true, 1, 9, 10).sub, "enc.oneLeft");
  assert.match(ctx.quizEncouragement(true, 1, 4, 10).sub, /^enc\.rightSub[123]$/);
  // A combo is not talked over by a progress note.
  assert.equal(ctx.quizEncouragement(true, 5, 5, 10).sub, "enc.comboSub");
});

test("every phrase exists in English and Vietnamese", function() {
  const keys = ["enc.wrongSub", "enc.combo3", "enc.combo5", "enc.combo10", "enc.comboSub", "enc.half", "enc.oneLeft"];
  for (let i = 1; i <= 6; i++) keys.push("enc.right" + i);
  for (let i = 1; i <= 3; i++) keys.push("enc.rightSub" + i, "enc.wrong" + i);
  for (const k of keys) {
    const n = app.split('"' + k + '":').length - 1;
    assert.equal(n, 2, k + " should be translated exactly twice, found " + n);
  }
});

test("the answer sheet is wired: markup, Next lives on it, it is cleared per card", function() {
  assert.match(html, /id="quiz-sheet"[^>]*aria-live="polite"/);
  const answer = app.slice(app.indexOf("function answerQuiz("), app.indexOf("var QUIZ_PRAISE_COUNT"));
  assert.match(answer, /showQuizSheet\(cheer\)/);
  assert.match(answer, /state\.quizStreak = isCorrect \?/);
  const next = app.slice(app.indexOf("function showQuizNextButton("), app.indexOf("function showQuizNextButton(") + 900);
  assert.match(next, /getElementById\("quiz-sheet"\)\.appendChild\(nextBtn\)/);
  const render = app.slice(app.indexOf("function renderQuizCard("), app.indexOf("function showQuizHint("));
  assert.match(render, /hideQuizSheet\(\)/);
  const startQuiz = app.slice(app.indexOf("function startQuiz("), app.indexOf("function buildQuizOptions("));
  assert.match(startQuiz, /state\.quizStreak = 0/);
});

test("the sheet slides from below, respects the safe area, and leaves room for the explanation", function() {
  assert.match(css, /\.study-sheet \{[^}]*position: fixed[^}]*translateY\(105%\)[^}]*visibility: hidden/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /#screen-quiz\.sheet-open \.quiz-container \{ padding-bottom/);
  for (const tone of ["correct", "combo", "wrong"]) assert.match(css, new RegExp("\\.study-sheet-" + tone + " +\\{ background"));
});
