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
