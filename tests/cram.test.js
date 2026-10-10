"use strict";
// Cram mode: the round's queue (missed cards come back sooner than recalled ones, a card
// leaves at its goal), undo, progress, and the Study Setup wiring.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");

function extract(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext("var CRAM_MISS_GAP = 3; var CRAM_HIT_GAP = 8;" +
  ["cramTarget", "newCram", "cramRequeueAt", "cramAnswered", "cramUndo", "cramProgress", "uniqueCards"]
    .map(extract).join(""), ctx);

const cards = (n) => Array.from({ length: n }, (_, i) => ({ id: "c" + i }));

// Answers the queue front to back until it is empty; `answer(card, k)` says whether the
// k-th showing of that card was recalled.
function run(cram, queue, answer) {
  const shown = {};
  const order = [];
  for (let i = 0; i < queue.length; i++) {
    const card = queue[i];
    shown[card.id] = (shown[card.id] || 0) + 1;
    order.push(card.id);
    ctx.cramAnswered(cram, queue, i, card, answer(card, shown[card.id]));
    assert.ok(queue.length < 500, "queue never ends");
  }
  return order;
}

test("the first round asks three correct recalls; later rounds one, two after a miss", () => {
  assert.equal(ctx.cramTarget(1, false), 3);
  assert.equal(ctx.cramTarget(2, false), 1);
  assert.equal(ctx.cramTarget(2, true), 2);
});

test("every card leaves after three correct answers, missed or not", () => {
  const deck = cards(12);
  const cram = ctx.newCram(deck);
  const queue = deck.slice();
  const order = run(cram, queue, (c, k) => !(c.id === "c0" && k <= 2));     // c0 missed twice
  const p = ctx.cramProgress(cram);
  assert.equal(p.done, 12);
  assert.equal(p.answersLeft, 0);
  assert.equal(p.misses, 2);
  assert.equal(order.filter((id) => id === "c0").length, 5);
  assert.equal(order.filter((id) => id === "c5").length, 3);
});

test("a missed card comes back three cards later, a recalled one eight", () => {
  const deck = cards(20);
  const cram = ctx.newCram(deck);
  const queue = deck.slice();
  ctx.cramAnswered(cram, queue, 0, deck[0], false);
  assert.equal(queue.indexOf(deck[0], 1), 4);
  ctx.cramAnswered(cram, queue, 1, deck[1], true);
  assert.equal(queue.indexOf(deck[1], 2), 10);
});

test("near the end of the queue a card goes last, and alone it comes straight back", () => {
  const deck = cards(1);
  const cram = ctx.newCram(deck);
  const queue = deck.slice();
  assert.deepEqual(run(cram, queue, () => true), ["c0", "c0", "c0"]);
});

test("undo takes the card back out and restores its counts", () => {
  const deck = cards(10);
  const cram = ctx.newCram(deck);
  const queue = deck.slice();
  const prev = ctx.cramAnswered(cram, queue, 0, deck[0], false);
  assert.equal(queue.length, 11);
  ctx.cramUndo(cram, queue, deck[0], prev);
  assert.equal(queue.length, 10);
  assert.equal(cram.misses.c0, 0);
  assert.equal(ctx.cramProgress(cram).answersLeft, 30);
});

test("a later round's goals follow what was missed in the last one", () => {
  const cram = ctx.newCram(cards(3), { round: 2, missedLast: { c1: true }, cramId: "k" });
  assert.deepEqual({ ...cram.targets }, { c0: 1, c1: 2, c2: 1 });
  assert.equal(cram.cramId, "k");
  assert.equal(ctx.uniqueCards([{ id: "a" }, { id: "b" }, { id: "a" }]).length, 2);
});

test("Study Setup offers Cram as a card order, flashcards only, and the summary dedupes", () => {
  assert.match(html, /<button class="pill" data-value="cram" data-i18n="setup.cram">Cram<\/button>/);
  assert.match(html, /id="setup-order-hint"/);
  assert.match(html, /id="summary-cram-note"/);
  assert.match(app, /state\.cram = order === "cram" && mode !== "quiz" \? newCram\(filtered\) : null;/);
  assert.match(app, /if \(state\.cram\) state\.studyCards = uniqueCards\(state\.studyCards\);/);
  assert.match(app, /if \(state\.cram\) undo\.cram = cramAnswered\(/);
  for (const lang of ["en", "vi"]) {
    const block = app.slice(app.indexOf("Object.assign(TRANSLATIONS." + lang));
    for (const key of ["setup.cram", "setup.hintCram", "summary.cramNote"])
      assert.ok(block.includes('"' + key + '"'), lang + " " + key);
  }
});

// --- Saved crams: round planning ---
const plan = {
  t: (k, v) => k + (v ? JSON.stringify(v) : ""),
  shuffle: (a) => a.slice(),
  state: { language: "en" }
};
vm.createContext(plan);
vm.runInContext(
  "var CRAM_GAP_SHARE = 0.15, CRAM_MIN_GAP_S = 1200, CRAM_MAX_GAP_S = 86400, CRAM_FINAL_S = 43200," +
  " CRAM_FINAL_CARDS = 20, CRAM_SLEEP_HOUR = 22, CRAM_WAKE_HOUR = 5;" +
  ["cramGap", "cramPlan", "cramRoundOrder", "cramCountdown", "roundRobinMerge", "cramLocalInput", "cramFromLocalInput"]
    .map(extract).join(""), plan);

const H = 3600, D = 86400, NOW = 1_800_000_000;
const deck = [{ id: "a", lesson_id: "L1" }, { id: "b", lesson_id: "L1" }, { id: "c", lesson_id: "L2" }, { id: "d", lesson_id: "L2" }];

test("rounds are spaced at 15% of the time left, between 20 minutes and a day", () => {
  assert.equal(plan.cramGap(NOW, NOW + 3 * D), Math.round(3 * D * 0.15));   // about 11 hours
  assert.equal(plan.cramGap(NOW, NOW + 10 * D), D);
  assert.equal(plan.cramGap(NOW, NOW + 8 * H), Math.round(8 * H * 0.15));
  assert.equal(plan.cramGap(NOW, NOW + H), 1200);
});

test("a new cram has round 1 ready with every card; nothing is ready yet", () => {
  const p = plan.cramPlan({ test_at: NOW + 3 * D, rounds: 0 }, deck, {}, NOW, 10);
  assert.equal(p.phase, "rounds");
  assert.equal(p.round, 1);
  assert.equal(p.cards.length, 4);
  assert.equal(p.ready, 0);
  assert.equal(p.nextAt, null);
  assert.equal(p.sleep, false);
});

test("after a round the next waits for the gap, and a card missed in it is not ready", () => {
  const cram = { test_at: NOW + 2 * D, rounds: 1, last_round_at: NOW - H, last_missed: ["b"] };
  const progress = { a: { correct: 3, wrong: 0 }, b: { correct: 3, wrong: 2 }, c: { correct: 3, wrong: 0 } };
  const p = plan.cramPlan(cram, deck, progress, NOW, 10);
  assert.equal(p.round, 2);
  assert.equal(p.ready, 2);                                          // a and c; b missed, d unseen
  assert.equal(p.nextAt, NOW - H + plan.cramGap(NOW - H, NOW + 2 * D));
  assert.equal(p.missedLast.b, true);
  assert.equal(plan.cramPlan({ ...cram, last_round_at: NOW - 2 * D }, deck, progress, NOW, 10).nextAt, null);
});

test("within 12 hours the round is the most-missed cards seen so far, and nothing new", () => {
  const progress = { a: { correct: 3, wrong: 0 }, b: { correct: 3, wrong: 4 }, c: { correct: 1, wrong: 1 } };
  const p = plan.cramPlan({ test_at: NOW + 6 * H, rounds: 3 }, deck, progress, NOW, 8);
  assert.equal(p.phase, "final");
  assert.deepEqual(p.cards.map((c) => c.id), ["b", "c", "a"]);
  // Nothing studied yet: an ordinary round is still better than none.
  assert.equal(plan.cramPlan({ test_at: NOW + 6 * H, rounds: 0 }, deck, {}, NOW, 8).phase, "rounds");
});

test("late on the eve the screen says to sleep; after the test there is no round", () => {
  assert.equal(plan.cramPlan({ test_at: NOW + 11 * H, rounds: 1 }, deck, {}, NOW, 23).sleep, true);
  assert.equal(plan.cramPlan({ test_at: NOW + 11 * H, rounds: 1 }, deck, {}, NOW, 1).sleep, true);
  assert.equal(plan.cramPlan({ test_at: NOW + 30 * H, rounds: 1 }, deck, {}, NOW, 23).sleep, false);
  const over = plan.cramPlan({ test_at: NOW - 60, rounds: 4 }, deck, {}, NOW, 10);
  assert.equal(over.phase, "over");
  assert.equal(over.cards.length, 0);
});

test("a round interleaves the cram's lessons in order", () => {
  assert.equal(plan.cramRoundOrder(deck, ["L2", "L1"]).map((c) => c.id).join(), "c,a,d,b");
});

test("the countdown reads days, hours or minutes", () => {
  assert.equal(plan.cramCountdown(2 * D + 5 * H), 'cram.inDays{"d":2,"h":5}');
  assert.equal(plan.cramCountdown(3 * H + 120), 'cram.inHours{"h":3,"m":2}');
  assert.equal(plan.cramCountdown(30), 'cram.inMinutes{"m":1}');
  assert.equal(plan.cramCountdown(0), "cram.over");
});

test("a test time round-trips through the date field in local time", () => {
  const ts = 1_800_000_000 - (1_800_000_000 % 60);
  assert.equal(plan.cramFromLocalInput(plan.cramLocalInput(ts)), ts);
  assert.ok(Number.isNaN(plan.cramFromLocalInput("")));
});

test("only a finished round of a saved cram is recorded, once", () => {
  const calls = [];
  const rec = { state: {}, store: { updateCram: (id, body) => { calls.push([id, body]); return Promise.resolve(); } },
    showToast() {}, t: (k) => k };
  vm.createContext(rec);
  vm.runInContext(extract("recordCramRound"), rec);
  const cram = { cramId: "k", ids: ["a", "b"], misses: { b: 2 } };
  rec.recordCramRound(cram, { done: 1, total: 2 });
  assert.equal(calls.length, 0);
  rec.recordCramRound(cram, { done: 2, total: 2 });
  rec.recordCramRound(cram, { done: 2, total: 2 });
  assert.equal(JSON.stringify(calls), JSON.stringify([["k", { round: { missed: ["b"] } }]]));
  rec.recordCramRound({ cramId: null, ids: [], misses: {} }, { done: 0, total: 0 });
  assert.equal(calls.length, 1);
});

test("saved crams are wired: screen, modal, Home, server-only, every string translated", () => {
  for (const id of ["screen-cram", "modal-cram", "home-crams", "btn-cram-start", "cram-date"])
    assert.ok(html.includes('id="' + id + '"'), id);
  // The learner took "Cram for a test" off the lesson select bar.
  assert.ok(!html.includes('id="btn-cram-selected"') && !app.includes("btn-cram-selected"));
  assert.match(app, /if \(!IS_SERVER \|\| !store\.getCrams\)/);
  assert.match(app, /cram: "results\.backToCram"/);
  assert.match(app, /else if \(target === "cram"\) renderCram\(\);/);
  // Card names and test names reach innerHTML only through escHtml.
  const home = extract("renderHomeCrams");
  assert.match(home, /escHtml\(c\.name\)/);
  assert.match(home, /escHtml\(c\.id\)/);
  const keys = [...app.matchAll(/t\("(cram\.[a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 15);
  for (const lang of ["en", "vi"]) {
    const block = app.slice(app.indexOf("Object.assign(TRANSLATIONS." + lang));
    for (const key of new Set(keys)) assert.ok(block.includes('"' + key + '"'), lang + " " + key);
  }
});

test("a modal's close icon is an X, not one line drawn twice", () => {
  assert.ok(!html.includes('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/>'));
});
