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

function returnFrom(returnScreen) {
  const calls = [];
  const ctx = {
    state: { studyScope: returnScreen ? { returnScreen } : null },
    calls,
  };
  ["dismissGradeUndo", "clearTimeout", "clearFlashcardTranslation", "renderHome", "renderUpstream",
   "renderDashboard", "renderCards", "renderLessons"].forEach(function(n) {
    ctx[n] = function() { calls.push(n); };
  });
  ctx.showScreen = function(s) { calls.push("show:" + s); };
  vm.createContext(ctx);
  vm.runInContext(fn("returnFromStudy") + fn("studyReturnTarget"), ctx);
  ctx.returnFromStudy();
  return calls.filter(function(c) { return /^render|^show:/.test(c); });
}

test("leaving a session redraws the screen it returns to, the lesson's card list included", function() {
  assert.deepEqual(returnFrom(null), ["show:lesson", "renderCards"]);
  assert.deepEqual(returnFrom("lesson"), ["show:lesson", "renderCards"]);
  assert.deepEqual(returnFrom("class"), ["show:class", "renderLessons"]);
  assert.deepEqual(returnFrom("dashboard"), ["show:dashboard", "renderDashboard"]);
  assert.deepEqual(returnFrom("upstream"), ["show:upstream", "renderUpstream"]);
});

test("a due quiz opened from the Dashboard returns there, and the button says so", function() {
  assert.match(fn("openDueReview"), /startDueQuiz\(lesson, dueCards, "dashboard"\)/);
  ["lesson", "home", "class", "upstream", "dashboard"].forEach(function(s) {
    const key = { lesson: "Lesson", home: "Home", class: "Class", upstream: "Updates", dashboard: "Dashboard" }[s];
    assert.equal((app.match(new RegExp('"results\\.backTo' + key + '":', "g")) || []).length, 2, key);
  });
  assert.match(app, /setStudyBackLabels\(\);\n  showScreen\("results"\)/);
  assert.match(app, /setStudyBackLabels\(\);\n  showScreen\("flashcard-summary"\)/);
});

test("the search swipe-down listener finds its element", function() {
  const sel = app.match(/document\.querySelector\("(#modal-search \.search-modal)"\)/);
  assert.ok(sel, "swipe-down must look the modal up by a selector that exists");
  assert.match(html, /id="modal-search"[^>]*>\s*<div class="modal search-modal"/);
});

test("the hidden compatibility header is gone and the Dashboard opens directly", function() {
  assert.doesNotMatch(html, /Keep for compatibility/);
  assert.doesNotMatch(html, /id="btn-dashboard"/);
  assert.doesNotMatch(app, /getElementById\("btn-dashboard"\)/);
  assert.equal((html.match(/<kbd class="kbd">A<\/kbd><span data-i18n="nav\.dashboard">/g) || []).length, 0);
});

test("pills and tabs carry their ARIA state; form focus is visible; distractors stay legible", function() {
  assert.match(fn("setPrefLang"), /aria-pressed/);
  assert.match(fn("setStatsTab"), /aria-selected/);
  assert.match(html, /class="stats-tabs" role="tablist"/);
  assert.match(css, /\.form-input:focus-visible, \.form-textarea:focus-visible \{ box-shadow/);
  const op = css.match(/\.quiz-opt\.dimmed \{ opacity: ([\d.]+); \}/);
  assert.ok(op && Number(op[1]) >= 0.7);
});

test("a phone flashcard sizes from the viewport and says when there is more to scroll", function() {
  assert.match(css, /\.fc-scene \{ height: clamp\(220px, calc\(100dvh - 340px\), 520px\); \}/);
  assert.doesNotMatch(css, /\.fc-scene \{ height: 220px; \}/);
  assert.match(css, /\.fc-front, \.fc-back \{[^}]*padding: 44px 24px 24px;/);
  assert.match(css, /\.fc-content\.fc-more \{[^}]*mask-image/);
  const marks = [];
  const els = {};
  ["fc-front-content", "fc-back-content"].forEach(function(id, i) {
    els[id] = { textContent: i ? "x".repeat(200) : "short", scrollHeight: i ? 900 : 100, scrollTop: 0, clientHeight: 300,
      classList: { toggle: function(c, on) { marks.push(id + ":" + c + ":" + on); } } };
  });
  const ctx = { document: { getElementById: function(id) { return els[id]; } }, FC_LONG_TEXT: 140 };
  vm.createContext(ctx);
  vm.runInContext(fn("markFcOverflow"), ctx);
  ctx.markFcOverflow();
  assert.deepEqual(marks, ["fc-front-content:fc-long:false", "fc-front-content:fc-more:false",
                           "fc-back-content:fc-long:true", "fc-back-content:fc-more:true"]);
});

test("touch screens get 44px icon targets", function() {
  const coarse = css.slice(css.indexOf("Apple's 44pt minimum"));
  assert.match(coarse, /\.btn-icon, \.icon-btn, \.sort-dir-btn, \.btn-audio, \.modal-close \{ min-width: 44px; min-height: 44px; \}/);
  assert.match(html, /id="btn-fc-edit-card"[^\n]*\n\s*<span class="fc-toolbar-gap"/);
});
