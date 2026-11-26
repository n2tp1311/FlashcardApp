"use strict";
// "I don't know" in a quiz: counted as a wrong answer on the asked card, but no option was
// chosen, so none is marked wrong and no other card is named as picked.
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

test("I don't know reveals the answer, marks nothing wrong, and is sent as a wrong answer", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.startQuiz === "function");
    await page.evaluate(() => {
      window.__sent = [];
      store.recordAttempt = (f) => { window.__sent.push(f); return Promise.resolve({ ok: true, notDue: false, srs_due_at: 1 }); };
      const c = (id, term, def) => ({ id, lesson_id: "l", format: "term-def", data: { term, def } });
      state.quizCards = [c("a", "Alpha", "first letter"), c("b", "Beta", "second letter"), c("g", "Gamma", "third letter")];
      state.quizPool = state.quizCards.slice(); state.currentLessonCards = [];
      startQuiz();
      state.quizStreak = 2;
    });
    assert.ok(await page.locator("#quiz-idk-btn").isVisible(), "offered before answering");
    assert.equal(await page.evaluate(() => document.getElementById("quiz-options").nextElementSibling.id), "quiz-idk-btn");
    await page.keyboard.press("0");
    const after = await page.evaluate(() => ({
      classes: [...document.querySelectorAll("#quiz-options .quiz-opt")].map((o) => o.className.replace("quiz-opt answered ", "")),
      button: !!document.getElementById("quiz-idk-btn"),
      title: document.getElementById("quiz-sheet-title").textContent,
      sent: window.__sent,
      result: { correct: state.quizResults[0].correct, dontKnow: state.quizResults[0].dontKnow },
      streak: state.quizStreak,
      note: !!document.getElementById("quiz-picked-note"),
    }));
    assert.deepEqual(after.classes.slice().sort(), ["correct", "dimmed", "dimmed"]);
    assert.equal(after.button, false, "gone once answered");
    assert.equal(after.title, "Here's the answer");
    assert.equal(after.sent.length, 1);
    assert.equal(after.sent[0].correct, false);
    assert.equal(after.sent[0].pickedCardId, undefined, "no other card is named");
    assert.deepEqual(after.result, { correct: false, dontKnow: true });
    assert.equal(after.streak, 0);
    assert.equal(after.note, false);
    assert.ok(await page.locator("#quiz-next-btn").isVisible(), "waits for Next, as a wrong answer does");

    await page.evaluate(() => { state.quizIndex++; renderQuizCard(); });
    assert.ok(await page.locator("#quiz-idk-btn").isVisible(), "offered again on the next question");
    await page.evaluate(() => { state.quizIndex--; renderQuizCard(); });
    assert.equal(await page.locator("#quiz-idk-btn").count(), 0, "not on a replay of an answered question");
    assert.equal(await page.evaluate(() => document.querySelectorAll("#quiz-options .quiz-opt.wrong").length), 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
