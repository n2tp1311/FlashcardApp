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
  const ctx = {
    escHtml: function(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); },
    t: function(k, v) { return k + "|" + v.n; }
  };
  vm.createContext(ctx);
  vm.runInContext(app.match(/\nvar LATEX_DELIMITER_RE = .*\n/)[0] +
    app.match(/\nvar HINT_SHOWN_WINDOW = .*\n/)[0] + app.match(/\nvar HINT_BLOCKS_AHEAD = .*\n/)[0] +
    ["hintWords", "hintRevealHtml", "hintAvailable", "containsLatex"].map(extract).join(""), ctx);
  return ctx;
}

test("each step uncovers the next word, in reading order", function() {
  const ctx = load();
  assert.deepEqual(Array.from(ctx.hintWords("  lasting a  very short time ")), ["lasting", "a", "very", "short", "time"]);
  const html = ctx.hintRevealHtml("lasting a very short time", 2);
  assert.match(html, /^lasting a <span class="hint-hid" style="width:4ch" aria-hidden="true"><\/span> /);
  assert.equal((html.match(/hint-hid/g) || []).length, 3);
  assert.equal(ctx.hintRevealHtml("lasting a very short time", 5), "lasting a very short time");
});

test("a long answer shows a window: the last six words, three blocks and a count", function() {
  const ctx = load();
  const answer = "one two three four five six seven eight nine ten eleven twelve";
  const start = ctx.hintRevealHtml(answer, 1);
  assert.equal((start.match(/hint-hid/g) || []).length, 3);
  assert.match(start, /<span class="hint-rest">hint\.moreWords\|8<\/span>$/);
  const late = ctx.hintRevealHtml(answer, 9);
  assert.match(late, /^… four five six seven eight nine <span class="hint-hid"/);
  assert.doesNotMatch(late, /hint-rest/);
});

test("covered words are never in the markup, and shown words are escaped", function() {
  const ctx = load();
  const html = ctx.hintRevealHtml("a <b> secret", 2);
  assert.doesNotMatch(html, /secret/);
  assert.match(html, /^a &lt;b> <span class="hint-hid" style="width:6ch"/);
});

test("a covered block's width counts letters, not UTF-16 units, and is capped", function() {
  const ctx = load();
  assert.match(ctx.hintRevealHtml("nước", 0), /width:4ch/);
  assert.match(ctx.hintRevealHtml("pneumonoultramicroscopic", 0), /width:16ch/);
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
  assert.match(html, /id="fc-hint-cap"/);
  assert.match(app, /getElementById\("fc-type-hint-row"\)\.addEventListener\("click", function\(e\) \{\n  e\.stopPropagation\(\);/);
});
