"use strict";
// Flashcards asked backwards: the blanked definition on the front, the term then the full
// definition on the back. Their own setting, Term → definition by default.
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

const CARDS = [
  { id: "p", lesson_id: "l", format: "term-def", data: { term: "Early Stopping — patience", def: "Patience defines how many checks may get worse." } },
  { id: "w", lesson_id: "l", format: "term-def", data: { term: "resilient /rɪˈzɪliənt/", def: "Resilient things recover quickly." } },
  { id: "m", lesson_id: "l", format: "mcq", data: { question: "Q?", correct: "yes", distractors: ["no"] } },
];

async function open(fcDir, quizDir) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/");
  await page.waitForFunction(() => typeof window.startFlashcards === "function");
  await page.evaluate(({ fcDir, quizDir, cards }) => {
    for (const [k, v] of [["fc-card-direction", fcDir], ["fc-quiz-direction", quizDir]]) {
      if (v) localStorage.setItem(k, v); else localStorage.removeItem(k);
    }
    state.studyCards = cards.slice(); state.studyIndex = 0;
    startFlashcards();
  }, { fcDir, quizDir, cards: CARDS });
  return { page, errors };
}
const sides = (page) => page.evaluate(() => ({
  front: document.getElementById("fc-front-content").textContent,
  back: document.getElementById("fc-back-content").textContent,
  frontText: state.studyFrontText, backText: state.studyBackText,
}));

test("forward by default, whatever the quiz is set to", async () => {
  const { page, errors } = await open(null, "reverse");
  try {
    const s = await sides(page);
    assert.equal(s.frontText, "Early Stopping — patience");
    assert.equal(s.backText, "Patience defines how many checks may get worse.");
    assert.equal(await page.evaluate(() => document.querySelector('#fc-card-menu .quiz-dir-item[aria-checked="true"]').dataset.dir), "forward");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("backwards: blanked definition in front; term, then the full definition, behind", async () => {
  const { page, errors } = await open("reverse");
  try {
    const s = await sides(page);
    assert.equal(s.front, "Which term?____ defines how many checks may get worse.");
    assert.equal(s.frontText, "… defines how many checks may get worse.");
    assert.equal(s.backText, "Early Stopping — patience", "what Flashcard & Write checks and the speaker reads");
    assert.ok(s.back.startsWith("Early Stopping — patience") && s.back.endsWith("Patience defines how many checks may get worse."));
    await page.evaluate(() => { state.studyIndex = 1; renderFlashcard(); });
    assert.equal((await sides(page)).backText, "resilient", "a vocabulary term is typed back without its IPA");
    await page.evaluate(() => { state.studyIndex = 2; renderFlashcard(); });
    assert.equal((await sides(page)).frontText, "Q?", "other formats are never reversed");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("a new direction applies from the next card, and leaves the quiz's alone", async () => {
  const { page } = await open("forward", "mixed");
  try {
    await page.click("#btn-fc-menu");
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#fc-card-menu .quiz-dir-item")).paddingLeft), "40px");
    await page.click('#fc-card-menu .quiz-dir-item[data-dir="reverse"]');
    const r = await page.evaluate(() => ({
      fc: localStorage.getItem("fc-card-direction"), quiz: localStorage.getItem("fc-quiz-direction"),
      current: state.studyFrontText,
    }));
    assert.deepEqual(r, { fc: "reverse", quiz: "mixed", current: "Early Stopping — patience" });
    await page.evaluate(() => { state.studyIndex = 1; renderFlashcard(); });
    assert.equal((await sides(page)).frontText, "… things recover quickly.");
  } finally { await page.close(); }
});
