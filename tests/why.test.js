"use strict";
// "Why?" on a flashcard with a book passage: your own reason first, then the passage under it.
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

async function withPanel(card, fn, open) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 640 }, isMobile: true, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.whyPanel === "function");
    const made = await page.evaluate(([c, open]) => {
      const el = whyPanel(c, open);
      if (!el) return false;
      document.body.prepend(el);
      return true;
    }, [card, !!open]);
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

test("you write a reason first; Check shows it above the passage, as text", async function() {
  const passage = "A set C is affine if for any x, y in C and θ in R, θx + (1 − θ)y is in C. It costs $5 <b>not</b> bold.";
  await withPanel({ source: passage }, async (page, made) => {
    assert.equal(made, true);
    assert.equal(await shown(page, "#fc-why-source"), false, "the passage waits for your reason");
    await page.click("#btn-fc-why");
    assert.equal(await page.evaluate(() => document.activeElement.id), "fc-why-input");
    await page.fill("#fc-why-input", "the <i>whole</i> line, not just the segment");
    await page.click("#btn-fc-why-check");
    assert.equal(await shown(page, "#fc-why-ask"), false);
    assert.equal(await page.textContent("#fc-why-yours"), "You: the <i>whole</i> line, not just the segment");
    assert.equal(await page.textContent("#fc-why-source"), passage);
    assert.equal(await page.evaluate(() => document.querySelector("#fc-why b, #fc-why i")), null, "nothing from the card or reason becomes markup");
    const fits = await page.evaluate(() => Array.from(document.querySelectorAll("#fc-why *")).every((el) => el.getBoundingClientRect().right <= innerWidth + 0.5));
    assert.ok(fits, "fits a 320px phone");
  });
});

test("Skip, or Enter with nothing typed, shows the passage without a reason line", async function() {
  await withPanel({ source: "Passage." }, async (page) => {
    await page.click("#btn-fc-why");
    await page.click("#btn-fc-why-skip");
    assert.equal(await shown(page, "#fc-why-source"), true);
    assert.equal(await shown(page, "#fc-why-yours"), false);
  });
  await withPanel({ source: "Passage." }, async (page) => {
    await page.click("#btn-fc-why");
    await page.keyboard.press("Enter");
    assert.equal(await shown(page, "#fc-why-source"), true);
  });
});

test("a card missed earlier opens straight to the passage; the retype drill opens it too", async function() {
  await withPanel({ source: "Passage." }, async (page) => {
    assert.equal(await shown(page, "#fc-why-source"), true);
    assert.equal(await shown(page, "#btn-fc-why"), false);
    assert.equal(await shown(page, "#fc-why-ask"), false);
    assert.equal(await shown(page, "#fc-why-yours"), false);
  }, true);
  await withPanel({ source: "Passage." }, async (page) => {
    assert.equal(await shown(page, "#fc-why-source"), false);
    await page.evaluate(() => document.getElementById("fc-why").openPassage());
    assert.equal(await shown(page, "#fc-why-source"), true);
  });
});

test("after a miss the passage is already open: a wrong quiz answer, a missed card coming back, the drill", function() {
  const fn = (name) => { const i = app.indexOf("\nfunction " + name + "("); return app.slice(i, app.indexOf("\n}\n", i)); };
  assert.match(fn("answerQuiz"), /if \(answerSource && !isCorrect\) answerSource\.open = true;/);
  assert.match(fn("renderQuizCard"), /if \(replaySource && !priorResult\.correct\) replaySource\.open = true;/);
  assert.match(fn("renderFlashcard"), /whyPanel\(card, !!\(state\.sessionMissed && state\.sessionMissed\[card\.id\]\)\)/);
  assert.match(fn("markCard"), /if \(!known && state\.sessionMissed && !state\.sessionMissed\[card\.id\]\)/);
  assert.match(fn("restoreGradedCard"), /if \(undo\.addedMissed && state\.sessionMissed\) delete state\.sessionMissed\[id\];/);
  assert.match(fn("beginForcedRetype"), /why\.openPassage\(\)/);
  // the set survives "Retry missed" (which does not go through launchStudy) and starts empty per session
  assert.match(fn("launchStudy"), /state\.sessionMissed = \{\};/);
  // every other way into a flashcard session sets it too: a cram round, and a resumed session from its log
  assert.equal(app.split("state.sessionMissed = {};").length - 1, 3);
  assert.match(app, /if \(log\[id\] === "learning"\) state\.sessionMissed\[id\] = true;/);
  const retry = app.slice(app.indexOf('getElementById("btn-summary-missed").addEventListener'));
  assert.doesNotMatch(retry.slice(0, retry.indexOf("\n});")), /sessionMissed/);
});

test("strings exist in English and Vietnamese", function() {
  for (const k of ["study.why", "study.whyPrompt", "study.whyHint", "study.whySkip", "study.whyCheck", "study.whyYou"]) {
    assert.equal(app.split('"' + k + '":').length - 1, 2, k);
  }
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
  }, true);
});

test("no buttons without another book, or when what arrived is not a list of passages", async function() {
  for (const related of [undefined, "[]", "not json", JSON.stringify([{ book: "X" }])])
    await withPanel({ source: "Passage.", source_related: related }, async (page) => {
      assert.equal(await page.evaluate(() => document.querySelectorAll(".source-tab").length), 0);
    }, true);
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
