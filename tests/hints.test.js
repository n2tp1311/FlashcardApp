const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "client", "app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "client", "index.html"), "utf8");

function extract(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}

function load() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(app.match(/\nvar LATEX_DELIMITER_RE = .*\n/)[0] +
    ["hintMask", "hintMaxSteps", "hintAvailable", "containsLatex"].map(extract).join(""), ctx);
  return ctx;
}

test("each step shows one more letter of every word and keeps spaces and punctuation", function() {
  const ctx = load();
  assert.equal(ctx.hintMask("mitochondria", 0), "____________");
  assert.equal(ctx.hintMask("mitochondria", 1), "m___________");
  assert.equal(ctx.hintMask("cell wall, plant", 2), "ce__ wa__, pl___");
  assert.equal(ctx.hintMask("well-known", 1), "w___-k____");
});

test("a Vietnamese letter is one blank, whether typed precomposed or decomposed", function() {
  const ctx = load();
  assert.equal(ctx.hintMask("nước", 1), "n___");
  assert.equal(ctx.hintMask("nước", 1), "n___");
});

test("steps stop at the longest word", function() {
  const ctx = load();
  assert.equal(ctx.hintMaxSteps("cell wall, plant"), 5);
  assert.equal(ctx.hintMask("cell wall, plant", 5), "cell wall, plant");
  assert.equal(ctx.hintMaxSteps(""), 0);
});

test("no hint for an empty answer or a formula", function() {
  const ctx = load();
  assert.equal(ctx.hintAvailable("photosynthesis"), true);
  assert.equal(ctx.hintAvailable("  "), false);
  assert.equal(ctx.hintAvailable("$E = mc^2$"), false);
});

test("a hinted card is capped at Hard on every grading path", function() {
  const mark = extract("markCard");
  assert.match(mark, /if \(known && state\.fcHintSteps > 0\) grade = "hard";/);
  assert.ok(mark.indexOf("fcHintSteps") < mark.indexOf("state.studyCardGraded = true"),
    "the cap must apply before the grade is recorded");
  assert.match(extract("setMarkButtonsEnabled"), /applyHintGradeCap\(\)/);
});

test("the hint row exists and its clicks do not flip the card", function() {
  assert.match(html, /id="fc-type-hint-row"/);
  assert.match(html, /id="btn-fc-type-hint"/);
  assert.match(app, /getElementById\("fc-type-hint-row"\)\.addEventListener\("click", function\(e\) \{\n  e\.stopPropagation\(\);/);
});
