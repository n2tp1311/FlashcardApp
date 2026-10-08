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

test("strings exist in English and Vietnamese", function() {
  for (const k of ["study.why", "study.whyPrompt", "study.whyHint", "study.whySkip", "study.whyCheck", "study.whyYou"]) {
    assert.equal(app.split('"' + k + '":').length - 1, 2, k);
  }
});
