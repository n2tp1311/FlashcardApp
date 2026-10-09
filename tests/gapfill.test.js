"use strict";
// Gap-fill passages in the app: every gap hidden at once, filled from a word bank of the
// answers and a few wrong words; Check (Show answer's place, and Space) marks each gap and
// outlines the grade the mistakes point to. Runs the real app in offline mode.
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

const PASSAGE = {
  id: "g1", lesson_id: "l1", format: "gapfill",
  data: {
    title: "Dropout",
    text: "Dropout trains an {{c1::ensemble}} of subnetworks by removing {{c2::units}}; it prevents {{c3::co-adaptation}}.",
    distractors: ["batch norm", "learning rate"]
  }
};

async function withApp(fn, viewport) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: viewport || { width: 375, height: 760 }, isMobile: !viewport, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.renderGapfill === "function" && typeof katex !== "undefined");
    await page.evaluate((card) => {
      state.currentLesson = { id: "l1", title: "7. Regularization", format: "term-def" };
      state.studyCards = [card];
      state.studyIndex = 0;
      startFlashcards();
    }, PASSAGE);
    await fn(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

const bankIndex = (page, word) => page.evaluate((w) => state.gf.bank.indexOf(w), word);

test("every string the passage uses exists in English and Vietnamese", function() {
  for (const k of ["format.gapfill", "gapfill.title", "gapfill.gaps", "gapfill.check", "gapfill.progress", "gapfill.result",
                   "gapfill.suggested", "gapfill.empty", "gapfill.filled", "gapfill.right", "gapfill.wrong", "gapfill.help",
                   "gapfill.notInQuiz", "card.editGapfill", "validate.gapfillGaps"])
    assert.equal(app.split('"' + k + '":').length - 1, 2, k);
});

test("every gap number is hidden in a passage, only c1 in a cloze card", async function() {
  await withApp(async (page) => {
    const r = await page.evaluate((text) => ({
      passage: clozeAnswer(text, true), cloze: clozeAnswer(text), hidden: clozePlain(text, true, true)
    }), PASSAGE.data.text);
    assert.equal(r.passage, "ensemble … units … co-adaptation");
    assert.equal(r.cloze, "ensemble");
    assert.equal(r.hidden, "Dropout trains an […] of subnetworks by removing […]; it prevents […].");
  });
});

test("the passage replaces the flip card; the bank holds the answers and the wrong words", async function() {
  await withApp(async (page) => {
    const r = await page.evaluate(() => ({
      scene: document.getElementById("fc-scene").classList.contains("hidden"),
      gaps: [...document.querySelectorAll("#fc-gapfill .gf-blank")].map((g) => g.textContent),
      next: document.querySelector("#fc-gapfill .gf-blank.is-next").textContent,
      bank: [...document.querySelectorAll("#fc-gapfill .gf-chip")].map((c) => c.textContent).sort(),
      meta: document.querySelector("#fc-gapfill .gf-head").textContent,
      reveal: document.getElementById("fc-reveal-label").textContent,
      disabled: document.getElementById("btn-fc-reveal").disabled,
      typeHidden: document.getElementById("fc-type-input").classList.contains("hidden")
    }));
    assert.equal(r.scene, true);
    assert.deepEqual(r.gaps, ["1", "2", "3"]);
    assert.equal(r.next, "1");
    assert.deepEqual(r.bank, ["batch norm", "co-adaptation", "ensemble", "learning rate", "units"]);
    assert.equal(r.meta, "Fill the gapsDropout · 3 gaps");
    assert.equal(r.reveal, "Check");
    assert.equal(r.disabled, true, "Check waits until every gap is filled");
    assert.equal(r.typeHidden, true);
  });
});

test("tapping a word fills the next gap; tapping a filled gap gives the word back", async function() {
  await withApp(async (page) => {
    await page.click(`#fc-gapfill .gf-chip[data-word="${await bankIndex(page, "units")}"]`);
    let r = await page.evaluate(() => ({ fill: document.querySelector(".gf-blank").textContent, used: document.querySelectorAll(".gf-chip.is-used").length }));
    assert.deepEqual(r, { fill: "units", used: 1 });
    await page.click(".gf-blank.is-filled");
    r = await page.evaluate(() => ({ fill: document.querySelector(".gf-blank").textContent, used: document.querySelectorAll(".gf-chip.is-used").length }));
    assert.deepEqual(r, { fill: "1", used: 0 });
  });
});

test("Check marks each gap, shows the right word beside a wrong one, and outlines Hard for one mistake", async function() {
  await withApp(async (page) => {
    for (const w of ["ensemble", "learning rate", "co-adaptation"])
      await page.click(`#fc-gapfill .gf-chip[data-word="${await bankIndex(page, w)}"]`);
    assert.equal(await page.evaluate(() => document.getElementById("btn-fc-reveal").disabled), false);
    await page.keyboard.press("Space");
    const r = await page.evaluate(() => ({
      right: document.querySelectorAll(".gf-blank.is-right").length,
      wrong: document.querySelector(".gf-blank.is-wrong").textContent,
      bank: document.querySelectorAll(".gf-chip").length,
      result: document.querySelector(".gf-result").textContent,
      suggest: [...document.querySelectorAll(".rate-suggest")].map((b) => b.id),
      awaiting: document.getElementById("fc-mark-btns").classList.contains("awaiting-reveal"),
      enabled: !document.getElementById("btn-fc-hard").disabled
    }));
    assert.deepEqual(r, { right: 2, wrong: "learning rateunits", bank: 0, result: "2 of 3 right",
                          suggest: ["btn-fc-hard"], awaiting: false, enabled: true });
  });
});

test("keys: digits pick bank words, Backspace takes the last one back", async function() {
  await withApp(async (page) => {
    await page.keyboard.press("2");
    await page.keyboard.press("4");
    assert.equal(await page.evaluate(() => state.gf.fill.filter((b) => b !== -1).length), 2);
    await page.keyboard.press("Backspace");
    assert.deepEqual(await page.evaluate(() => state.gf.fill), [1, -1, -1]);
  });
});

test("all right suggests Know It, two wrong suggests Learning", async function() {
  await withApp(async (page) => {
    const r = await page.evaluate(() => [gapfillSuggestion(0), gapfillSuggestion(1), gapfillSuggestion(2), gapfillSuggestion(3)]);
    assert.deepEqual(r, ["btn-fc-known", "btn-fc-hard", "btn-fc-learning", "btn-fc-learning"]);
  });
});

test("the next card is a plain flip card again", async function() {
  await withApp(async (page) => {
    await page.evaluate(() => {
      state.studyCards.push({ id: "t1", lesson_id: "l1", format: "term-def", data: { term: "Dropout", def: "Disables units." } });
      state.studyIndex = 1;
      renderFlashcard();
    });
    const r = await page.evaluate(() => ({
      scene: document.getElementById("fc-scene").classList.contains("hidden"),
      gf: document.getElementById("fc-gapfill").classList.contains("hidden"),
      reveal: document.getElementById("fc-reveal-label").textContent,
      disabled: document.getElementById("btn-fc-reveal").disabled,
      state: state.gf
    }));
    assert.deepEqual(r, { scene: false, gf: true, reveal: "Show answer", disabled: false, state: null });
  });
});

test("the quiz leaves passages out", async function() {
  await withApp(async (page) => {
    await page.evaluate((card) => { state.quizCards = [card]; startQuiz(); }, PASSAGE);
    assert.match(await page.evaluate(() => document.body.innerText), /studied as flashcards/);
  });
});

test("edit: the dialog keeps the wrong words and refuses a passage with one gap", async function() {
  await withApp(async (page) => {
    await page.evaluate((card) => { openEditCard(card.id, card); }, PASSAGE);
    await page.waitForSelector("#modal-card-cloze:not(.hidden)");
    assert.equal(await page.textContent("#modal-card-cloze-title"), "Edit passage");
    assert.equal(await page.evaluate(() => document.querySelectorAll("#card-cloze-preview .cloze-gap.revealed").length), 3);
    await page.fill("#card-cloze-input", "Dropout prevents {{c1::co-adaptation}}.");
    await page.click("#btn-save-card-cloze");
    assert.match(await page.evaluate(() => document.body.innerText), /2 to 8 gaps/);
  });
});

test("screenshots of a passage, phone and desktop", async function() {
  fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
  for (const [name, viewport] of [["phone", null], ["desktop", { width: 1260, height: 820 }]]) {
    await withApp(async (page) => {
      await page.click(`#fc-gapfill .gf-chip[data-word="${await bankIndex(page, "ensemble")}"]`);
      await page.screenshot({ path: path.join(root, "test-results", "gapfill-" + name + ".png") });
    }, viewport);
  }
});
