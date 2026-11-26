"use strict";
// Term-def cards asked backwards: the definition shown with the term's words blanked, the
// terms as options. The direction is a per-device setting, "mixed" by default.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const express = require("express");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
let base, listener, browser;
test.before(async () => {
  await new Promise((ok) => {
    const app = express();
    app.use(express.static(path.join(root, "client")));
    listener = app.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); });
  });
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { if (browser) await browser.close(); listener.close(); });

async function open(direction) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/");
  await page.waitForFunction(() => typeof window.startQuiz === "function");
  await page.evaluate((direction) => {
    if (direction) localStorage.setItem("fc-quiz-direction", direction); else localStorage.removeItem("fc-quiz-direction");
    window.__sent = [];
    store.recordAttempt = (f) => { window.__sent.push(f); return Promise.resolve({ ok: true, notDue: false, srs_due_at: 1, picked: f.pickedCardId ? { cardId: f.pickedCardId, srs_due_at: 2 } : null }); };
  }, direction);
  return { page, errors };
}
const CARDS = [
  { id: "p", lesson_id: "l", format: "term-def", data: { term: "Early Stopping — patience", def: "Patience defines how many checks may get worse before training stops." } },
  { id: "r", lesson_id: "l", format: "term-def", data: { term: "Retraining", def: "Training again on all the data for the same number of steps." } },
  { id: "v", lesson_id: "l", format: "term-def", data: { term: "Variance", def: "Variance is $\\text{Variance} = E[(X-\\mu)^2]$, the spread." } },
  { id: "m", lesson_id: "l", format: "mcq", data: { question: "Q?", correct: "yes", distractors: ["no"] } },
];

test("backwards: the definition with its term blanked, the terms as options, the picked term explained", async () => {
  const { page, errors } = await open("reverse");
  try {
    await page.evaluate((cards) => {
      state.quizCards = cards.slice(0, 1); state.quizPool = cards; state.currentLessonCards = [];
      startQuiz();
    }, CARDS);
    const q = await page.evaluate(() => ({
      ask: document.querySelector("#quiz-question .quiz-ask").textContent,
      def: document.querySelector("#quiz-question .quiz-reverse-def").textContent,
      opts: state.quizOptions.slice().sort(),
      speech: quizSpeechText(state.quizCards[0]),
      checked: [...document.querySelectorAll(".quiz-dir-item")].filter((b) => b.getAttribute("aria-checked") === "true").map((b) => b.dataset.dir),
    }));
    assert.equal(q.ask, "Which term?");
    assert.equal(q.def, "____ defines how many checks may get worse before training stops.");
    assert.deepEqual(q.opts, ["Early Stopping — patience", "Retraining", "Variance"], "terms of term-def cards only");
    assert.equal(q.speech, "… defines how many checks may get worse before training stops.");
    assert.deepEqual(q.checked, ["reverse"]);
    await page.evaluate(() => answerQuiz(state.quizOptions.indexOf("Retraining")));
    await page.waitForFunction(() => /which means/.test((document.getElementById("quiz-picked-note") || {}).textContent || ""));
    const after = await page.evaluate(() => ({ sent: window.__sent[0], note: document.getElementById("quiz-picked-note").textContent }));
    assert.equal(after.sent.correct, false);
    assert.equal(after.sent.pickedCardId, "r", "the card whose term was picked");
    assert.equal(after.note, "You picked Retraining, which means: Training again on all the data for the same number of steps. That card is back in today's reviews too.");

    await page.evaluate(() => { state.quizResults = []; state.quizAnswered = false; renderQuizCard(); answerQuiz(state.quizOptions.indexOf("Early Stopping — patience")); });
    assert.equal(await page.evaluate(() => window.__sent[1].correct), true, "the term is the right answer");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("the term's words are blanked outside LaTeX only", async () => {
  const { page } = await open("reverse");
  try {
    const masked = await page.evaluate((card) => quizMaskTerm(card), CARDS[2]);
    assert.equal(masked, "____ is $\\text{Variance} = E[(X-\\mu)^2]$, the spread.");
  } finally { await page.close(); }
});

test("forward asks the term; mixed, the default, asks both ways; other formats never reverse", async () => {
  const { page } = await open("forward");
  try {
    await page.evaluate((cards) => { state.quizCards = cards.slice(0, 1); state.quizPool = cards; startQuiz(); }, CARDS);
    assert.equal(await page.evaluate(() => document.getElementById("quiz-question").textContent), "Early Stopping — patience");
    const mixed = await page.evaluate(() => {
      localStorage.removeItem("fc-quiz-direction");
      state.quizReverse = {};
      const ways = new Set();
      for (let i = 0; i < 60; i++) ways.add(quizIsReversed({ id: "c" + i, format: "term-def", data: { term: "t", def: "d" } }));
      const again = quizIsReversed({ id: "c0", format: "term-def", data: { term: "t", def: "d" } }) === state.quizReverse.c0;
      return { ways: [...ways].sort(), again, mcq: quizIsReversed({ id: "m", format: "mcq", data: {} }), image: quizIsReversed({ id: "i", format: "image-def", data: { def: "d" } }) };
    });
    assert.deepEqual(mixed.ways, [false, true]);
    assert.ok(mixed.again, "drawn once per card, so a replay asks the same way");
    assert.equal(mixed.mcq, false);
    assert.equal(mixed.image, false);
  } finally { await page.close(); }
});

test("a new direction applies from the next question, never the one on screen", async () => {
  const { page } = await open("forward");
  try {
    await page.evaluate((cards) => { state.quizCards = cards.slice(0, 3); state.quizPool = cards; startQuiz(); }, CARDS);
    await page.click("#btn-quiz-settings");
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".quiz-dir-item")).paddingLeft), "40px",
      "room for the tick, not under it");
    await page.click('.quiz-dir-item[data-dir="reverse"]');
    const r = await page.evaluate(() => ({
      stored: localStorage.getItem("fc-quiz-direction"),
      current: state.quizReverse[state.quizCards[0].id],
      checked: document.querySelector('.quiz-dir-item[data-dir="reverse"]').getAttribute("aria-checked"),
    }));
    assert.deepEqual(r, { stored: "reverse", current: false, checked: "true" });
    await page.evaluate(() => { answerQuiz(0); state.quizIndex++; renderQuizCard(); });
    assert.equal(await page.evaluate(() => !!document.querySelector("#quiz-question .quiz-reverse-def")), true);
  } finally { await page.close(); }
});
