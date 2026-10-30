"use strict";
// The book passage under a flashcard's answer, shown at once: no "Why?" button, no reason box.
// Runs the real whyPanel() in the offline app at phone width.
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

async function withPanel(card, fn) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 640 }, isMobile: true, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.whyPanel === "function");
    const made = await page.evaluate((c) => {
      const el = whyPanel(c);
      if (!el) return false;
      document.body.prepend(el);
      return true;
    }, card);
    await fn(page, made);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

const shown = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && el.getClientRects().length > 0; }, sel);

test("only cards with a book passage get Why?", async function() {
  await withPanel({ source: "  " }, async (page, made) => assert.equal(made, false));
  await withPanel({}, async (page, made) => assert.equal(made, false));
});

test("the passage shows at once, as text, with no Why? button or reason box", async function() {
  const passage = "A set C is affine if for any x, y in C and θ in R, θx + (1 − θ)y is in C. It costs $5 <b>not</b> bold.";
  await withPanel({ source: passage }, async (page, made) => {
    assert.equal(made, true);
    assert.equal(await shown(page, "#fc-why-source"), true);
    assert.equal(await page.textContent("#fc-why-source"), passage);
    assert.equal(await page.evaluate(() => document.querySelectorAll("#fc-why button.why-btn, #fc-why textarea").length), 0);
    assert.equal(await page.evaluate(() => document.querySelector("#fc-why b")), null, "book text never becomes markup");
    const fits = await page.evaluate(() => Array.from(document.querySelectorAll("#fc-why *")).every((el) => el.getBoundingClientRect().right <= innerWidth + 0.5));
    assert.ok(fits, "fits a 320px phone");
  });
});

test("a flashcard's passage is open at once; the quiz still opens it only after a miss, so a right answer moves on", function() {
  const fn = (name) => { const i = app.indexOf("\nfunction " + name + "("); return app.slice(i, app.indexOf("\n}\n", i)); };
  assert.match(fn("answerQuiz"), /if \(answerSource && !isCorrect\) answerSource\.open = true;/);
  assert.match(fn("renderQuizCard"), /if \(replaySource && !priorResult\.correct\) replaySource\.open = true;/);
  assert.match(fn("renderFlashcard"), /var fcWhy = whyPanel\(card\);/);
  assert.doesNotMatch(app, /sessionMissed|openPassage/, "nothing is left that waited to open the passage");
});

test("the Why? prompt's strings are gone in both languages", function() {
  for (const k of ["study.why", "study.whyPrompt", "study.whyHint", "study.whySkip", "study.whyCheck", "study.whyYou"])
    assert.equal(app.split('"' + k + '":').length - 1, 0, k);
});

test("another book's passage on the same concept is a button above the passage; Read more and the question are this card's", async function() {
  const card = { id: "c1", data: { term: "Critical path" }, source: "The critical path is the longest path.",
    source_after: "Its activities are critical.",
    source_related: JSON.stringify([{ book: "Operations Research", text: "Delaying the critical path <b>delays</b> the project." }]) };
  await withPanel(card, async (page) => {
    const tabs = () => page.evaluate(() => Array.from(document.querySelectorAll("#fc-why .source-tab")).map((b) => [b.textContent, b.getAttribute("aria-pressed")]));
    assert.deepEqual(await tabs(), [["This book", "true"], ["Operations Research", "false"]]);
    assert.match(await page.textContent("#fc-why-source"), /longest path/);
    await page.click("#fc-why .source-tab:nth-child(2)");
    assert.deepEqual(await tabs(), [["This book", "false"], ["Operations Research", "true"]]);
    assert.equal(await page.textContent("#fc-why-source"), "Delaying the critical path <b>delays</b> the project.");
    assert.equal(await page.evaluate(() => document.querySelectorAll("#fc-why-source mark").length), 2, "the card's words marked here too");
    assert.equal(await page.evaluate(() => document.querySelector("#fc-why-source b")), null, "book text never becomes markup");
    assert.equal(await shown(page, "#fc-why-source .source-more"), false, "Read more belongs to this card's passage");
    await page.click("#fc-why .source-tab:nth-child(1)");
    assert.match(await page.textContent("#fc-why-source"), /longest path/);
    assert.equal(await shown(page, "#fc-why-source .source-more"), true);
    const fits = await page.evaluate(() => Array.from(document.querySelectorAll("#fc-why *")).every((el) => el.getBoundingClientRect().right <= innerWidth + 0.5));
    assert.ok(fits, "fits a 320px phone");
  });
});

test("no buttons without another book, or when what arrived is not a list of passages", async function() {
  for (const related of [undefined, "[]", "not json", JSON.stringify([{ book: "X" }])])
    await withPanel({ source: "Passage.", source_related: related }, async (page) => {
      assert.equal(await page.evaluate(() => document.querySelectorAll(".source-tab").length), 0);
    });
});

test("the collapsed panel under a quiz answer gets the same buttons", async function() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.sourcePanel === "function");
    const got = await page.evaluate(() => {
      const el = sourcePanel({ source: "Own.", source_related: [{ book: "B", text: "Theirs." }] });
      document.body.prepend(el);
      el.open = true;
      const tabs = el.querySelector(".source-tabs");
      return [tabs.nextElementSibling.classList.contains("source-body"), tabs.textContent];
    });
    assert.deepEqual(got, [true, "This bookB"]);
  } finally {
    await browser.close();
  }
});
