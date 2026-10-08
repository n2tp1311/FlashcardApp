"use strict";
// Cloze cards in the app: the gap on the front, the sentence with the answer filled in on the
// back, the hidden words as what Write mode and the quiz check, and an edit dialog that will
// not save a sentence without a gap. Runs the real app in offline mode.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const express = require("express");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");

let base, listener;
test.before(() => new Promise((ok) => {
  const server = express();
  server.use(express.static(path.join(root, "client")));
  listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); });
}));
test.after(() => listener.close());

const CARDS = [
  { id: "z1", lesson_id: "l1", format: "cloze", data: { text: "Dropout randomly disables units to prevent {{c1::co-adaptation}}." } },
  { id: "z2", lesson_id: "l1", format: "cloze", data: { text: "Early stopping halts when {{c1::validation::which set?}} error stops falling, as in {{c2::bagging}}." } },
  { id: "z3", lesson_id: "l1", format: "cloze", data: { text: "The penalty $\\lambda \\|w\\|^2$ is called {{c1::weight decay}}." } }
];

async function withApp(fn) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 700 }, isMobile: true, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.renderCloze === "function" && typeof katex !== "undefined");
    await fn(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

test("every string the cloze card uses exists in English and Vietnamese", function() {
  for (const k of ["format.cloze", "cloze.blank", "cloze.blankHint", "cloze.sentence", "cloze.help", "card.editCloze", "validate.clozeGap"])
    assert.equal(app.split('"' + k + '":').length - 1, 2, k);
});

test("the sentence splits into text and c1 gaps; other numbers read as text", async function() {
  await withApp(async (page) => {
    const r = await page.evaluate((cards) => ({
      answer: clozeAnswer(cards[1].data.text),
      hidden: clozePlain(cards[1].data.text, true),
      shown: clozePlain(cards[1].data.text, false),
      two: clozeAnswer("{{c1::a}} and {{c1::b}}"),
      none: clozeAnswer("{{c2::only two}}")
    }), CARDS);
    assert.deepEqual(r, {
      answer: "validation",
      hidden: "Early stopping halts when [which set?] error stops falling, as in bagging.",
      shown: "Early stopping halts when validation error stops falling, as in bagging.",
      two: "a … b",
      none: ""
    });
  });
});

test("flashcard: a gap on the front, the answer in place on the back, Write mode checks the hidden word", async function() {
  await withApp(async (page) => {
    await page.evaluate((cards) => {
      state.currentLesson = { id: "l1", title: "7. Regularization", format: "term-def" };
      state.studyCards = cards.slice(0, 1);
      state.studyIndex = 0;
      startFlashcards();
    }, CARDS);
    const front = await page.evaluate(() => {
      const gap = document.querySelector("#fc-front-content .cloze-gap");
      return { text: document.getElementById("fc-front-content").textContent, gap: gap.textContent,
               label: gap.getAttribute("aria-label"), back: state.studyBackText,
               revealed: document.querySelector("#fc-back-content .cloze-gap.revealed").textContent };
    });
    assert.equal(front.text, "Dropout randomly disables units to prevent […].");
    assert.equal(front.gap, "[…]");
    assert.equal(front.label, "blank");
    assert.equal(front.back, "co-adaptation", "Write mode and the hint check the hidden word alone");
    assert.equal(front.revealed, "co-adaptation");
    assert.equal(await page.evaluate(() => quizSpeechText(state.studyCards[0])), "");
  });
});

test("math in the sentence still renders, and the gap sits outside it", async function() {
  await withApp(async (page) => {
    const r = await page.evaluate((card) => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      renderCloze(card.data.text, el, false);
      return { katex: !!el.querySelector(".katex"), gap: el.querySelector(".cloze-gap").textContent };
    }, CARDS[2]);
    assert.deepEqual(r, { katex: true, gap: "[…]" });
  });
});

test("quiz: the question is the sentence with its gap, the choices are what fills the gaps", async function() {
  await withApp(async (page) => {
    await page.evaluate((cards) => {
      state.currentLesson = { id: "l1", title: "7. Regularization", format: "term-def" };
      state.quizCards = cards;
      startQuiz();
    }, CARDS);
    const r = await page.evaluate(() => ({
      q: document.getElementById("quiz-question").textContent,
      opts: state.quizOptions.slice().sort()
    }));
    assert.equal(r.q, "Dropout randomly disables units to prevent […].");
    assert.deepEqual(r.opts, ["co-adaptation", "validation", "weight decay"]);
    const idx = await page.evaluate(() => state.quizOptions.indexOf("co-adaptation"));
    await page.evaluate((i) => answerQuiz(i), idx);
    assert.equal(await page.evaluate(() => state.quizScore), 1);
  });
});

test("edit: the dialog shows the sentence and refuses one with no gap", async function() {
  await withApp(async (page) => {
    await page.evaluate((card) => { openEditCard(card.id, card); }, CARDS[0]);
    await page.waitForSelector("#modal-card-cloze:not(.hidden)");
    assert.equal(await page.inputValue("#card-cloze-input"), CARDS[0].data.text);
    assert.equal(await page.textContent("#card-cloze-preview .cloze-gap.revealed"), "co-adaptation");
    await page.fill("#card-cloze-input", "Dropout prevents co-adaptation.");
    await page.click("#btn-save-card-cloze");
    assert.equal(await page.evaluate(() => !document.getElementById("modal-card-cloze").classList.contains("hidden")), true);
    assert.match(await page.evaluate(() => document.body.innerText), /Hide at least one word/);
    fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
  });
});

test("phone screenshots of a gap card", async function() {
  await withApp(async (page) => {
    await page.evaluate((cards) => {
      state.currentLesson = { id: "l1", title: "7. Regularization", format: "term-def" };
      state.studyCards = cards.slice(0, 1);
      state.studyIndex = 0;
      startFlashcards();
    }, CARDS);
    fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
    await page.screenshot({ path: path.join(root, "test-results", "cloze-front.png") });
    await page.click("#fc-card");
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(root, "test-results", "cloze-back.png") });
  });
});
