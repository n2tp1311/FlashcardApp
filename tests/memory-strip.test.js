"use strict";
// The study screens' memory strip: one dot per answered card, on a 1 day to 1 year log scale.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
function extract(name) {
  const start = appJs.indexOf("function " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return appJs.slice(start, appJs.indexOf("\n}\n", start) + 3);
}
const DAY = 86400;
const ctx = {
  t: (key, vars) => key + (vars ? JSON.stringify(vars) : ""),
  formatFsrsDuration: (s) => Math.round(s / DAY) + "d",
};
vm.createContext(ctx);
vm.runInContext("var MEM_STRIP_BINS = 20; var MEM_STRIP_YEAR_DAYS = 365; var MONTH_SECONDS = 30 * 86400;", ctx);
ctx.state = {};
ctx.IS_SERVER = true;
ctx.renders = [];
ctx.renderMemStrip = (prefix) => ctx.renders.push(prefix);
for (const fn of ["memStripPos", "memStripBin", "memStripBins", "memStripPrev", "memStripRecord", "memStripNotDue",
  "memStripRestore", "memStripSettle", "memStripAnswer", "memStripPastMonth", "memStripCaption"]) {
  vm.runInContext(extract(fn), ctx);
}
const newStrip = () => ({ entries: {}, last: null, lastNotDue: false });

test("the scale runs from one day at the left to one year at the right", () => {
  assert.equal(ctx.memStripPos(600), 0);
  assert.equal(ctx.memStripPos(DAY), 0);
  assert.equal(ctx.memStripPos(365 * DAY), 100);
  assert.equal(ctx.memStripPos(5000 * DAY), 100);
  assert.ok(Math.abs(ctx.memStripPos(30 * DAY) - 57.7) < 0.1);
  assert.equal(ctx.memStripBin(365 * DAY, 20), 19);
  assert.equal(ctx.memStripBin(0, 20), 0);
});

test("a card answered twice keeps one dot, at its latest place", () => {
  const strip = newStrip();
  const card = { id: "c1" };
  ctx.memStripRecord(strip, card, 600, true, "a1");
  ctx.memStripRecord(strip, card, 3 * DAY, false, "a2");
  const cols = ctx.memStripBins(strip.entries, 20);
  assert.equal(cols.reduce((n, c) => n + c.ok + c.again, 0), 1);
  assert.equal(cols[ctx.memStripBin(3 * DAY, 20)].ok, 1);
  // Its previous place is where this session last put it, not the server's older schedule.
  assert.equal(strip.entries.c1.prev, 600);
});

test("the previous interval comes from the card's schedule, and a new card has none", () => {
  assert.equal(ctx.memStripPrev(undefined, { srs_due_at: 1000 + 3 * DAY, fsrs_last_review_at: 1000 }), 3 * DAY);
  assert.equal(ctx.memStripPrev(undefined, { srs_due_at: null, fsrs_last_review_at: null }), null);
});

test("undo puts the strip back as it was", () => {
  const strip = newStrip();
  const a = { id: "a" }, b = { id: "b" };
  ctx.memStripRecord(strip, a, 2 * DAY, false, "x1");
  const before = ctx.memStripRecord(strip, b, 40 * DAY, false, "x2");
  ctx.memStripRestore(strip, b, before);
  assert.deepEqual(Object.keys(strip.entries), ["a"]);
  assert.equal(strip.last, "a");
});

test("the server's due date replaces the preview, but only for the same answer", () => {
  const strip = newStrip();
  const card = { id: "c" };
  const before = ctx.memStripRecord(strip, card, 20 * DAY, false, "mine");
  const now = Math.floor(Date.now() / 1000);
  assert.equal(ctx.memStripSettle(strip, card, "other", before, { srs_due_at: now + 50 * DAY }), false);
  assert.equal(strip.entries.c.now, 20 * DAY);
  assert.equal(ctx.memStripSettle(strip, card, "mine", before, { srs_due_at: now + 23 * DAY }), true);
  assert.ok(Math.abs(strip.entries.c.now - 23 * DAY) <= 1);
});

test("the caption says where the last card went and where it was", () => {
  const strip = newStrip();
  assert.equal(ctx.memStripCaption(strip), "memstrip.empty");
  ctx.memStripRecord(strip, { id: "n" }, 600, false, "1");
  assert.match(ctx.memStripCaption(strip), /^memstrip\.first/);
  ctx.memStripRecord(strip, { id: "r", srs_due_at: 1000 + 3 * DAY, fsrs_last_review_at: 1000 }, 21 * DAY, false, "2");
  assert.equal(ctx.memStripCaption(strip), 'memstrip.moved{"now":"21d","prev":"3d"}');
  strip.lastNotDue = true;
  assert.equal(ctx.memStripCaption(strip), "memstrip.notDue");
});

test("cards past the one-month mark are counted", () => {
  const strip = newStrip();
  ctx.memStripRecord(strip, { id: "a" }, 29 * DAY, false, "1");
  ctx.memStripRecord(strip, { id: "b" }, 30 * DAY, false, "2");
  ctx.memStripRecord(strip, { id: "c" }, 200 * DAY, false, "3");
  assert.equal(ctx.memStripPastMonth(strip.entries), 2);
});

test("both study screens carry the strip, and cram hides it", () => {
  for (const px of ["fc", "quiz"]) {
    for (const id of ["memstrip", "memstrip-cols", "memstrip-ghost", "memstrip-trail", "memstrip-caption", "memstrip-count"]) {
      assert.ok(indexHtml.includes('id="' + px + "-" + id + '"'), px + "-" + id);
    }
  }
  assert.match(extract("renderMemStrip"), /prefix === "fc" && state\.cram/);
  assert.match(extract("markCard"), /!state\.cram/);
  assert.match(extract("beginStudySession"), /state\.memStrip = \{/);
});

test("every strip string exists in English and Vietnamese", () => {
  const keys = [...new Set(appJs.match(/"memstrip\.[a-zA-Z]+"/g))];
  assert.ok(keys.length >= 6);
  for (const k of keys) assert.equal(appJs.split(k + ":").length - 1, 2, k);
});

test("a late not-due reply takes its own dot back and leaves a later answer's caption alone", () => {
  const strip = newStrip();
  const a = { id: "a" }, b = { id: "b", srs_due_at: 1000 + 3 * DAY, fsrs_last_review_at: 1000 };
  const beforeA = ctx.memStripRecord(strip, a, 5 * DAY, false, "xa");
  ctx.memStripRecord(strip, b, 21 * DAY, false, "xb");
  assert.equal(ctx.memStripSettle(strip, a, "xa", beforeA, { notDue: true, srs_due_at: 99 }), true);
  assert.deepEqual(Object.keys(strip.entries), ["b"]);
  assert.equal(strip.last, "b");
  assert.equal(strip.lastNotDue, false);
  assert.match(ctx.memStripCaption(strip), /^memstrip\.moved/);
});

test("a not-due reply for the latest answer says so", () => {
  const strip = newStrip();
  const a = { id: "a" };
  const before = ctx.memStripRecord(strip, a, 5 * DAY, false, "xa");
  ctx.memStripSettle(strip, a, "xa", before, { notDue: true, srs_due_at: 99 });
  assert.deepEqual(Object.keys(strip.entries), []);
  assert.equal(ctx.memStripCaption(strip), "memstrip.notDue");
});

test("undoing a not-due answer clears its caption", () => {
  const strip = newStrip();
  const a = { id: "a" }, b = { id: "b" };
  ctx.memStripRecord(strip, a, 5 * DAY, false, "xa");
  const before = ctx.memStripNotDue(strip);
  assert.equal(ctx.memStripCaption(strip), "memstrip.notDue");
  ctx.memStripRestore(strip, b, before);
  assert.match(ctx.memStripCaption(strip), /^memstrip\.first/);
  assert.deepEqual(Object.keys(strip.entries), ["a"]);
});

test("a card with no schedule preview, or no server, is not placed", () => {
  ctx.state.memStrip = newStrip();
  assert.equal(ctx.memStripAnswer("fc", { id: "a" }, false, undefined, false, "x"), null);
  assert.deepEqual(Object.keys(ctx.state.memStrip.entries), []);
  ctx.IS_SERVER = false;
  assert.equal(ctx.memStripAnswer("fc", { id: "a" }, false, 3 * DAY, false, "x"), null);
  ctx.IS_SERVER = true;
  const mem = ctx.memStripAnswer("quiz", { id: "a" }, false, 3 * DAY, false, "x");
  assert.ok(mem && ctx.state.memStrip.entries.a);
  mem.settle({ srs_due_at: Math.floor(Date.now() / 1000) + 9 * DAY });
  assert.ok(Math.abs(ctx.state.memStrip.entries.a.now - 9 * DAY) <= 1);
});

test("a quiz answer keeps the card's due date, so a retry in the same quiz is known not to be due", () => {
  assert.match(extract("answerQuiz"), /state\.memStrip\.dueAt\[card\.id\] = res\.srs_due_at/);
  assert.doesNotMatch(extract("answerQuiz"), /card\.srs_due_at = /);
  assert.match(extract("answerQuiz"), /quizOutcomeTimes\(card\)/);
});

for (const fn of ["memStripSummary", "memStripEndText", "memStripStartEntries"]) vm.runInContext(extract(fn), ctx);

test("the session end remembers where a card stood when the session began", () => {
  const strip = newStrip();
  const card = { id: "a", srs_due_at: 1000 + 4 * DAY, fsrs_last_review_at: 1000 };
  ctx.memStripRecord(strip, card, 600, true, "1");
  ctx.memStripRecord(strip, card, 3 * DAY, false, "2");
  assert.equal(strip.entries.a.start, 4 * DAY);
  assert.equal(strip.entries.a.prev, 600);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.memStripStartEntries(strip.entries))), { a: { now: 4 * DAY, again: false } });
});

test("the session end headline says the most that is true", () => {
  const strip = newStrip();
  const due = (days) => ({ srs_due_at: 1000 + days * DAY, fsrs_last_review_at: 1000 });
  ctx.memStripRecord(strip, Object.assign({ id: "a" }, due(40)), 90 * DAY, false, "1");
  ctx.memStripRecord(strip, Object.assign({ id: "b" }, due(10)), 35 * DAY, false, "2");
  ctx.memStripRecord(strip, { id: "c" }, 600, false, "3");
  const sum = ctx.memStripSummary(strip.entries);
  assert.deepEqual(JSON.parse(JSON.stringify(sum)), { total: 3, pastNow: 2, pastBefore: 1, further: 2, fresh: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.memStripEndText(sum))),
    { title: 'memend.pastMonth{"n":2}', sub: 'memend.before{"n":1}' });
  assert.equal(ctx.memStripEndText({ pastNow: 0, pastBefore: 0, further: 2 }).title, 'memend.further{"n":2}');
  assert.equal(ctx.memStripEndText({ pastNow: 1, pastBefore: 1, further: 0 }).title, "memend.none");
});

test("both end screens carry the before-and-now view", () => {
  for (const id of ["summary-memend", "results-memend"]) assert.ok(indexHtml.includes('id="' + id + '"'), id);
  assert.match(extract("showFlashcardSummary"), /renderMemEnd\("summary-memend"\)/);
  assert.match(extract("showQuizResults"), /renderMemEnd\("results-memend"\)/);
});

test("a new card is not counted as pushed further, and a studied card without a review time is not new", () => {
  const strip = newStrip();
  ctx.memStripRecord(strip, { id: "n" }, 3 * DAY, false, "1");
  ctx.memStripRecord(strip, { id: "old", srs_due_at: 1000 + 9 * DAY, fsrs_last_review_at: null }, 20 * DAY, false, "2");
  const sum = ctx.memStripSummary(strip.entries);
  assert.equal(sum.further, 0);
  assert.equal(sum.fresh, 1);
  assert.equal(ctx.memStripEndText(sum).title, "memend.none");
});

test("a graded card's last review time moves with its due date, and undo puts both back", () => {
  assert.match(extract("markCard"), /if \(!res\.notDue\) card\.fsrs_last_review_at = /);
  assert.match(extract("markCard"), /prevLastReview: card\.fsrs_last_review_at/);
  assert.match(extract("restoreGradedCard"), /undo\.card\.fsrs_last_review_at = undo\.prevLastReview/);
});

test("the month mark is one constant", () => {
  assert.equal(appJs.split("30 * 86400").length - 1, 1);
});

test("on a wide screen the strip keeps to the card's 600px column", () => {
  const css = fs.readFileSync(path.join(root, "client", "style.css"), "utf8");
  assert.match(css, /@media \(min-width: 768px\) \{\n  \.memstrip \{[^}]*max-width: 600px;[^}]*margin: 20px auto 16px;/);
});

test("on a phone the study header's sides are equal, so the progress bar is centred", () => {
  const css = fs.readFileSync(path.join(root, "client", "style.css"), "utf8");
  assert.match(css, /#screen-quiz \.app-header, #screen-flashcard \.app-header \{ display: grid; grid-template-columns: 1fr 2fr 1fr; \}/);
  assert.match(indexHtml, /id="btn-fc-shuffle"[^>]*data-i18n-aria="common.shuffle"/);
});
