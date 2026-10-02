const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "client", "app.js"), "utf8");

function extract(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}

function load(state) {
  const ctx = {
    state: state,
    t: function(k, v) { return k + (v ? "|" + v.n : ""); }
  };
  vm.createContext(ctx);
  vm.runInContext("var SESSION_CARD_MAX_MS = 300000; var ETA_FALLBACK_MS = { flashcard: 10000, quiz: 15000 }; var ETA_MIN_SAMPLES = 3;" +
    ["addSessionTime", "medianOf", "estimateTimeLeftMs", "formatTimeLeft", "studyProgressText"].map(extract).join(""), ctx);
  return ctx;
}

test("with no history and no answers yet, a per-mode guess is used", function() {
  const ctx = load({});
  assert.equal(ctx.estimateTimeLeftMs(6, "flashcard"), 60000);
  assert.equal(ctx.estimateTimeLeftMs(6, "quiz"), 90000);
});

test("the user's own history for the mode wins over the guess", function() {
  const ctx = load({ sessionTodayAtStart: { medianMs: { flashcard: 4000, quiz: null } } });
  assert.equal(ctx.estimateTimeLeftMs(10, "flashcard"), 40000);
  assert.equal(ctx.estimateTimeLeftMs(10, "quiz"), 150000, "no quiz history: fall back");
});

test("after three answers this session's median wins, and one long pause does not swing it", function() {
  const state = { sessionTodayAtStart: { medianMs: { flashcard: 4000 } } };
  const ctx = load(state);
  ctx.addSessionTime(20000);
  ctx.addSessionTime(22000);
  assert.equal(ctx.estimateTimeLeftMs(10, "flashcard"), 40000, "two answers are not enough");
  ctx.addSessionTime(240000);
  assert.equal(ctx.estimateTimeLeftMs(10, "flashcard"), 220000);
});

test("the header reads position, then a rounded estimate; nothing when done", function() {
  const ctx = load({});
  assert.equal(ctx.studyProgressText(3, 24, 22, "flashcard"), "3 / 24 · eta.minutes|4");
  assert.equal(ctx.studyProgressText(24, 24, 2, "flashcard"), "24 / 24 · eta.underMinute");
  assert.equal(ctx.studyProgressText(24, 24, 0, "flashcard"), "24 / 24");
});

test("both study headers use it, counting cards not yet answered", function() {
  assert.match(app, /fc-progress-text"\)\.textContent = studyProgressText\(i \+ 1, cards\.length,\s*cards\.length - Object\.keys\(state\.studySessionLog \|\| \{\}\)\.length, "flashcard"\)/);
  assert.match(app, /quiz-progress-text"\)\.textContent = studyProgressText\(i \+ 1, total,\s*total - state\.quizResults\.length, "quiz"\)/);
  assert.equal(app.split('"eta.minutes":').length - 1, 2);
});
