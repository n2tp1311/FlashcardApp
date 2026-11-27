"use strict";
// A right quiz answer counts as Know It (Good, marked known); a wrong one as Learning.
// There is no preference to turn this off and no Guessing switch.
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

test("a right answer is sent as Know It and a wrong one as Learning", async () => {
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
      state.quizCards = [c("a", "Alpha", "first letter"), c("b", "Beta", "second letter")];
      state.quizPool = state.quizCards.slice(); state.currentLessonCards = [];
      startQuiz();
    });
    assert.equal(await page.locator("#quiz-guess-btn").count(), 0, "no Guessing switch");
    assert.equal(await page.locator("#pref-quiz-known").count(), 0, "no preference");
    await page.keyboard.press(String((await page.evaluate(() => state.quizOptions.indexOf(state.quizCards[0].data.def))) + 1));
    await page.evaluate(() => { clearTimeout(state.quizAdvanceTimer); state.quizIndex++; renderQuizCard(); });
    await page.keyboard.press(String((await page.evaluate(() => state.quizOptions.findIndex((o) => o !== state.quizCards[1].data.def))) + 1));
    const r = await page.evaluate(() => ({ sent: window.__sent, known: window.__known }));
    assert.deepEqual(r.sent.map((f) => [f.cardId, f.correct, f.grade]), [["a", true, "medium"], ["b", false, undefined]]);
    assert.deepEqual(r.known, [["a", true], ["b", false]]);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
