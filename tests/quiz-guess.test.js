"use strict";
// The Guessing switch in a quiz: a right answer is Good, a right guess Hard; a sure wrong
// answer is named. The switch is off on every new question and absent on a replay.
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

test("a guess is sent as Hard and noted; a sure answer as Good; a sure miss is named", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.startQuiz === "function");
    await page.evaluate(() => {
      // Backwards questions would ask for the term; this test reads the definition.
      localStorage.setItem("fc-quiz-direction", "forward");
      window.__sent = []; window.__known = [];
      store.recordAttempt = (f) => { window.__sent.push(f); return Promise.resolve({ ok: true, notDue: false, srs_due_at: 1 }); };
      store.setCardKnown = (id, k) => { window.__known.push([id, k]); return Promise.resolve(); };
      const c = (id, term, def) => ({ id, lesson_id: "l", format: "term-def", data: { term, def } });
      state.quizCards = [c("a", "Alpha", "first letter"), c("b", "Beta", "second letter"), c("g", "Gamma", "third letter")];
      state.quizPool = state.quizCards.slice(); state.currentLessonCards = [];
      startQuiz();
    });
    const right = () => page.evaluate(() => state.quizOptions.indexOf(state.quizCards[state.quizIndex].data.def));
    const next = () => page.evaluate(() => { clearTimeout(state.quizAdvanceTimer); state.quizIndex++; renderQuizCard(); });
    const note = () => page.evaluate(() => { const n = document.getElementById("quiz-confidence-note"); return n && n.textContent; });

    assert.equal(await page.locator("#quiz-guess-btn").getAttribute("aria-pressed"), "false", "off by default");
    await page.keyboard.press("g");
    assert.equal(await page.locator("#quiz-guess-btn").getAttribute("aria-pressed"), "true", "G turns it on");
    await page.keyboard.press(String((await right()) + 1));
    assert.equal(await page.locator("#quiz-guess-btn").count(), 0, "gone once answered");
    assert.match(await note(), /a guess/);

    await next();
    assert.equal(await page.locator("#quiz-guess-btn").getAttribute("aria-pressed"), "false", "off again on the next question");
    await page.keyboard.press(String((await right()) + 1));
    assert.equal(await note(), null, "a sure right answer needs no note");

    await next();
    const wrong = await page.evaluate(() => state.quizOptions.findIndex((o) => o !== state.quizCards[state.quizIndex].data.def));
    await page.keyboard.press(String(wrong + 1));
    assert.match(await note(), /You were sure/);

    const r = await page.evaluate(() => ({ sent: window.__sent, known: window.__known }));
    assert.deepEqual(r.sent.map((f) => [f.cardId, f.correct, f.grade, f.guessed]),
      [["a", true, "hard", true], ["b", true, "medium", undefined], ["g", false, undefined, undefined]]);
    assert.deepEqual(r.known, [["a", false], ["b", true], ["g", false]], "a right guess is not Know It");

    await page.evaluate(() => { state.quizIndex = 0; renderQuizCard(); });
    assert.equal(await page.locator("#quiz-guess-btn").count(), 0, "not on a replay");
    assert.match(await note(), /a guess/, "the replay keeps its note");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
