"use strict";
// Mixed-up pairs: a wrong term-def pick pairs the two cards; two right quiz answers on them
// since the latest mix-up retire the pair. Study Setup filters on them, the Mixed up quiz
// offers only the two, and a wrong pick shows them side by side.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const express = require("express");

const root = path.join(__dirname, "..");
const dbFile = path.join(root, "server", "db.js");

// The real schema and migrations, in memory (as in quiz-picked.test.js).
const realLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent && parent.filename === dbFile) {
    if (request === "node-sqlite3-wasm") {
      const { Database } = realLoad.call(this, request, parent, isMain);
      return { Database: class extends Database { constructor() { super(); } } };
    }
    if (request === "fs") return { ...fs, rmSync() {}, mkdirSync() {}, existsSync: () => true };
    if (request === "./lib/dbLock") return { claim() {}, hold() { return function() {}; } };
  }
  return realLoad.call(this, request, parent, isMain);
};
const db = require(dbFile);
Module._load = realLoad;
const { mixedWith } = require(path.join(root, "server/lib/mixups.js"));

db.exec("INSERT INTO users (id, email, name) VALUES ('u1', 'a@x', 'A'), ('u2', 'b@x', 'B')");
let n = 0;
const attempt = (user, card, correct, picked, source = "quiz") => db.prepare(
  "INSERT INTO attempts (id, card_id, user_id, correct, source, picked_card_id) VALUES (?, ?, ?, ?, ?, ?)"
).run("a" + ++n, card, user, correct ? 1 : 0, source, picked || null);

test("a pair enters on one mix-up either way round, and leaves after two right answers since the last", () => {
  assert.deepEqual(mixedWith(db, "u1", ["x", "y"]), {});
  attempt("u1", "x", false, "y");
  assert.deepEqual(mixedWith(db, "u1", ["x"]), { x: [{ id: "y", n: 1 }], y: [{ id: "x", n: 1 }] }, "asked either card, both sides know");
  attempt("u1", "y", false, "x");
  assert.deepEqual(mixedWith(db, "u1", ["y"]).y, [{ id: "x", n: 2 }], "both directions count as one pair");
  assert.deepEqual(mixedWith(db, "u2", ["x"]), {}, "another user's mix-ups are theirs");
  assert.deepEqual(mixedWith(db, "u1", ["z"]), {}, "only pairs touching the asked cards");

  attempt("u1", "x", true);
  attempt("u1", "y", true, null, "flashcard");
  assert.equal(mixedWith(db, "u1", ["x"]).x.length, 1, "a flashcard answer is not telling them apart");
  attempt("u1", "y", false);
  attempt("u1", "x", true);
  assert.equal(mixedWith(db, "u1", ["x"]).x.length, 1, "the last two must both be right");
  attempt("u1", "y", true);
  assert.deepEqual(mixedWith(db, "u1", ["x", "y"]), {}, "two right in a row retires it");

  attempt("u1", "x", false, "y");
  assert.deepEqual(mixedWith(db, "u1", ["x"]).x, [{ id: "y", n: 3 }], "a new mix-up brings it back, with its history");
});

test("both card lists carry each card's partners", () => {
  const src = fs.readFileSync(path.join(root, "server/routes/cards.js"), "utf8");
  assert.equal((src.match(/mixed_with: mixed\[c\.id\] \|\| \[\]/g) || []).length, 2, "lesson cards and cards by lessons");
});

test("Setup's Mixed up pill, the two-option drill and the compare panel, in the real page", async () => {
  const { chromium } = require("playwright");
  const app = express();
  app.use(express.static(path.join(root, "client")));
  const l = await new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => { try { localStorage.setItem("fc-quiz-direction", "forward"); } catch (_) {} });
    await page.goto("http://127.0.0.1:" + l.address().port + "/");
    await page.waitForFunction(() => typeof window.quizComparePanel === "function");
    const r = await page.evaluate(() => {
      const c = (id, term, def, mixed) => ({ id, format: "term-def", data: { term, def }, mixed_with: mixed || [] });
      const cards = [
        c("a", "Recall", "share of real positives the model finds", [{ id: "b", n: 2 }]),
        c("b", "Precision", "share of predicted positives that are real", [{ id: "a", n: 2 }, { id: "gone", n: 5 }]),
        c("c", "F1", "harmonic mean of precision and recall"),
        c("d", "Accuracy", "share of all predictions that are right"),
      ];
      const out = {};
      out.filtered = filterCardsBySetup(cards, "mixedUp", {}, {}, 0).map((x) => x.id);
      updateSetupMixedPill(cards);
      const pill = document.getElementById("setup-filter-mixedup");
      out.pill = { hidden: pill.classList.contains("hidden"), count: pill.textContent.trim() };
      updateSetupMixedPill([cards[2]]);
      out.hiddenWithout = pill.classList.contains("hidden");

      state.quizCards = cards; state.quizPool = null; state.quizReverse = {};
      state.quizMixedUp = false;
      out.normal = buildQuizOptions(cards[0]).length;
      state.quizMixedUp = true;
      out.drill = buildQuizOptions(cards[0]).sort();
      out.loner = buildQuizOptions(cards[2]).length;

      const panel = quizComparePanel({ own: cards[0].data, other: cards[1].data, n: 2 });
      out.head = panel.querySelector(".quiz-compare-head").textContent;
      out.terms = [...panel.querySelectorAll(".quiz-compare-term")].map((e) => e.textContent);
      out.marks = [...panel.querySelectorAll(".quiz-compare-col")].map((col) => [...col.querySelectorAll("mark")].map((m) => m.textContent));
      out.text = panel.querySelector(".quiz-compare-def").textContent;
      out.once = quizComparePanel({ own: cards[0].data, other: cards[1].data, n: 1 }).querySelector(".quiz-compare-head").textContent;
      return out;
    });
    assert.deepEqual(r.filtered, ["a", "b"], "only cards whose partner is in the chosen lessons");
    assert.deepEqual(r.pill, { hidden: false, count: "Mixed up 1" }, "one pair, counted once");
    assert.equal(r.hiddenWithout, true, "no pair, no pill");
    assert.ok(r.normal > 2, "an ordinary quiz still has its distractors");
    assert.deepEqual(r.drill, ["share of predicted positives that are real", "share of real positives the model finds"]);
    assert.equal(r.loner, 4, "a card with no partner in the session asks as usual");
    assert.equal(r.head, "Mixed up 2 times");
    assert.equal(r.once, "Tell them apart");
    assert.deepEqual(r.terms, ["Recall", "Precision"], "the asked card first");
    assert.deepEqual(r.marks, [["model", "finds"], ["predicted", "that"]], "the words only one definition has");
    assert.equal(r.text, "share of real positives the model finds", "marking keeps the text whole");
  } finally { await browser.close(); l.close(); }
});

test("the drill flag comes only from Setup's Mixed up filter, for a quiz", () => {
  const appJs = fs.readFileSync(path.join(root, "client/app.js"), "utf8");
  assert.match(appJs, /state\.pendingMixedUp = filter === "mixedUp";\n    launchStudy\(filtered, mode, order\);/);
  assert.match(appJs, /state\.quizMixedUp = !!state\.pendingMixedUp && mode === "quiz";\n  state\.pendingMixedUp = false;/);
  assert.match(appJs, /resultEntry\.picked\.compare = \{ own: card\.data, other: pickedCard\.data/);
});
