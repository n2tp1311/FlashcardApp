const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "client", "style.css"), "utf8");

function fn(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}

function load(stored, throws) {
  const store = stored == null ? {} : { "fc-quiz-layout": stored };
  const classes = new Set();
  const attrs = {};
  const text = { textContent: "" };
  const btn = { innerHTML: "", title: "", text, setAttribute: function(k, v) { attrs[k] = v; },
                querySelector: function(sel) { return sel === ".menu-text" ? text : null; } };
  const opts = { classList: { toggle: function(c, on) { on ? classes.add(c) : classes.delete(c); } } };
  const ctx = {
    localStorage: { getItem: function(k) { if (throws) throw new Error("blocked"); return store[k] || null; } },
    document: { getElementById: function(id) { return id === "quiz-options" ? opts : btn; } },
    t: function(k) { return k; },
    ICON_LAYOUT_LIST: "LIST", ICON_LAYOUT_GRID: "GRID",
  };
  vm.createContext(ctx);
  vm.runInContext(fn("quizLayout") + fn("applyQuizLayout") + fn("setMenuLabel"), ctx);
  return { ctx, classes, attrs, btn };
}

test("answers are a list unless the grid was chosen", function() {
  assert.equal(load(null).ctx.quizLayout(), "list");
  assert.equal(load("grid").ctx.quizLayout(), "grid");
  assert.equal(load("nonsense").ctx.quizLayout(), "list");
  assert.equal(load(null, true).ctx.quizLayout(), "list");
});

test("the grid layout tags the options and the button offers the list back", function() {
  const g = load("grid");
  g.ctx.applyQuizLayout();
  assert.ok(g.classes.has("grid-mode"));
  assert.equal(g.btn.innerHTML, 'LIST<span class="menu-text"></span>');
  assert.equal(g.btn.title, "quiz.layoutList");
  assert.equal(g.btn.text.textContent, "quiz.layoutList", "the menu row reads what it switches to");
  // The label already flips; aria-pressed on top read as "list, pressed".
  assert.equal(g.attrs["aria-pressed"], undefined);

  const l = load(null);
  l.ctx.applyQuizLayout();
  assert.ok(!l.classes.has("grid-mode"));
  assert.equal(l.btn.innerHTML, 'GRID<span class="menu-text"></span>');
});

test("the quiz header has the button, both languages label it, and true/false keeps its row", function() {
  assert.match(html, /id="btn-quiz-layout"/);
  assert.equal((app.match(/"quiz\.layoutGrid":/g) || []).length, 2);
  assert.equal((app.match(/"quiz\.layoutList":/g) || []).length, 2);
  assert.match(css, /\.quiz-options\.grid-mode:not\(\.tf-mode\)\s*\{[^}]*display:\s*grid/);
  assert.match(app, /applyQuizLayout\(\);\n  opts\.forEach/);
});

test("the grid widens the quiz column and puts the answers in one row on a wide screen", function() {
  assert.match(css, /#screen-quiz:has\(\.quiz-options\.grid-mode:not\(\.tf-mode\)\) \{ --quiz-col: 1400px; \}/);
  assert.match(css, /\.quiz-container \{ max-width: var\(--quiz-col, 600px\); \}/);
  // The answer sheet lines up with the widened column.
  assert.match(css, /padding: 16px max\(16px, calc\(\(100% - var\(--quiz-col, 600px\)\) \/ 2\)\)/);
  assert.match(css, /\.quiz-options\.grid-mode:not\(\.tf-mode\)\s*\{[^}]*grid-auto-flow:\s*column/);
  // Tiles of different text lengths line up along the top, numbers in one row.
  assert.match(css, /\.quiz-options\.grid-mode:not\(\.tf-mode\) \.quiz-opt\s*\{[^}]*justify-content:\s*flex-start/);
  assert.match(css, /@media \(max-width: 900px\)\s*\{\s*\.quiz-options\.grid-mode:not\(\.tf-mode\)\s*\{\s*grid-auto-flow:\s*row/);
});

test("sentence-length answers left-align in tiles and fall back to the list on a phone", function() {
  assert.match(app, /optsEl\.classList\.toggle\("long-opts", opts\.some\(/);
  assert.match(css, /\.quiz-options\.grid-mode\.long-opts:not\(\.tf-mode\) \.quiz-opt \{ align-items: stretch; text-align: start; \}/);
  const phone = css.slice(css.indexOf("@media (max-width: 600px) {\n  .quiz-options.grid-mode"));
  assert.match(phone, /\.quiz-options\.grid-mode\.long-opts:not\(\.tf-mode\) \{ display: flex; flex-direction: column; \}/);
  assert.match(css, /\.quiz-opt:last-child:nth-child\(odd\) \{ grid-column: 1 \/ -1; \}/);
});

function distractors(card, quizCards, lessonCards, jitter = 0) {
  const ctx = { state: { quizCards, currentLessonCards: lessonCards }, QUIZ_DISTRACTOR_JITTER: jitter };
  vm.createContext(ctx);
  vm.runInContext(fn("quizDistractors") + fn("quizDistractorScore"), ctx);
  return JSON.parse(JSON.stringify(ctx.quizDistractors(card, "def")));
}

test("too few cards give fewer choices, never a dash, and draw on the open lesson first", function() {
  const a = { id: 1, format: "term-def", data: { def: "A" } };
  const b = { id: 2, format: "term-def", data: { def: "B" } };
  assert.deepEqual(distractors(a, [a, b], []), ["B"]);
  const lesson = [a, b, { id: 3, format: "term-def", data: { def: "C" } }, { id: 4, format: "term-def", data: { def: "B" } },
                  { id: 5, format: "mcq", data: { def: "X" } }];
  assert.deepEqual(distractors(a, [a, b], lesson).sort(), ["B", "C"]);
  assert.doesNotMatch(fn("buildQuizOptions"), /"—"/);
});

test("the wrong answers most likely to be mistaken are chosen: same lesson, about as long", function() {
  const c = (id, def, lesson_id = "l1") => ({ id, lesson_id, format: "term-def", data: { def } });
  const asked = c("q", "x".repeat(100));
  const near = [c("n1", "a".repeat(95)), c("n2", "b".repeat(110)), c("n3", "c".repeat(90))];
  const short = [c("s1", "tiny"), c("s2", "a few words")];
  const other = c("o1", "d".repeat(100), "l2");
  assert.deepEqual(distractors(asked, [asked], [...short, ...near, other]).sort(), near.map((x) => x.data.def).sort(),
    "neither a one-word option nor another lesson's when this lesson has close ones");
  const sameLen = c("o2", "e".repeat(100), "l2");
  assert.ok(distractors(asked, [asked], [...short, sameLen]).includes(sameLen.data.def),
    "another lesson's is still used when this lesson runs short");
  // With the random part, the three vary, but a one-word option still almost never shows.
  const pool = [...short, ...near, other, c("n4", "f".repeat(105)), c("n5", "g".repeat(98))];
  const drawn = new Set(); let tiny = 0;
  for (let i = 0; i < 300; i++) {
    const got = distractors(asked, [asked], pool, 0.35);
    got.forEach((d) => drawn.add(d));
    if (got.includes("tiny")) tiny++;
  }
  assert.ok(drawn.size >= 5, "the three vary between questions");
  assert.equal(tiny, 0);
});

test("the quiz header matches the flashcard one: Exit, progress, a check-mark score", function() {
  assert.match(html, /id="btn-quiz-back"[^>]*data-i18n="study\.exit"/);
  assert.match(html, /<span id="quiz-score-display" class="score-display">✓ 0<\/span>/);
  assert.match(fn("setQuizScoreDisplay"), /"✓ " \+ state\.quizScore/);
  const header = html.slice(html.indexOf('<div id="screen-quiz"'), html.indexOf('<div class="quiz-container">'));
  // No toolbar row: the session toggles are in the header's settings menu, the card actions
  // in a menu on the question card's corner.
  assert.doesNotMatch(header, /fc-toolbar/);
  const headerOnly = header.slice(0, header.indexOf("</header>"));
  assert.match(headerOnly, /<div class="study-header-end">\s*<span id="quiz-score-display"[\s\S]*id="btn-quiz-settings"[^>]*aria-controls="quiz-settings-menu"/);
  const settings = html.slice(html.indexOf('id="quiz-settings-menu"'), html.indexOf("</header>", html.indexOf('id="quiz-settings-menu"')));
  assert.match(settings, /id="btn-quiz-layout"[\s\S]*id="btn-quiz-voice"[\s\S]*id="btn-quiz-music"[\s\S]*id="quiz-music-volume"[\s\S]*id="btn-quiz-music-reset"/);
  const card = html.slice(html.indexOf('<div class="quiz-question-wrap">'), html.indexOf('id="quiz-question"'));
  assert.match(card, /id="btn-quiz-card-menu"[^>]*aria-controls="quiz-card-menu"[\s\S]*id="btn-quiz-edit-card"[\s\S]*id="btn-quiz-flag-card"[\s\S]*dropdown-divider[\s\S]*id="btn-quiz-delete-card"/);
  assert.match(app, /registerDropdown\("btn-quiz-settings", "quiz-settings-menu"\);/);
  assert.match(app, /registerDropdown\("btn-quiz-card-menu", "quiz-card-menu"\);/);
  // The settings stay open while changed; a card action closes its menu as it runs.
  assert.match(app, /getElementById\("quiz-settings-menu"\)\.addEventListener\("click", function\(e\) \{ e\.stopPropagation\(\); \}\);/);
  assert.match(app, /e\.key === "Escape" && document\.querySelector\("#screen-quiz \.dropdown-menu:not\(\.hidden\)"\)\) closeAllDropdowns\(\);/);
  for (const k of ["quiz.settings", "quiz.cardMenu"])
    assert.equal(app.split('"' + k + '":').length - 1, 2, k + " in both languages");
});

