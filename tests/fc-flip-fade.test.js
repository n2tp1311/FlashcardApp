"use strict";
// The flashcard's faces cross-fade in place. A 3D turn of a card as wide as a desktop window
// swept its edges across the screen and was headache-inducing; a new card shows its front at
// once, so the old back fading out never shows the new answer.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
let base, listener, browser;
test.before(async () => {
  await new Promise((ok) => {
    const server = express();
    server.use(express.static(path.join(root, "client")));
    listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); });
  });
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { if (browser) await browser.close(); listener.close(); });

test("flipping fades the faces and nothing turns, at desktop width", async function() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.setFlashcardFaces === "function");
    const out = await page.evaluate(async () => {
      document.getElementById("screen-flashcard").classList.add("active");
      const card = document.getElementById("fc-card"), front = card.querySelector(".fc-front"), back = card.querySelector(".fc-back");
      const look = () => ({ card: getComputedStyle(card).transform, front: getComputedStyle(front).opacity, back: getComputedStyle(back).opacity,
        frontT: getComputedStyle(front).transform, backT: getComputedStyle(back).transform });
      const before = look();
      setFlashcardFaces(true);
      await new Promise((r) => setTimeout(r, 300));
      const flipped = look();
      const fade = getComputedStyle(back).transitionDuration;
      card.classList.add("fc-no-anim");
      setFlashcardFaces(false);
      void card.offsetHeight;
      card.classList.remove("fc-no-anim");
      const reset = look();
      return { before, flipped, fade, reset };
    });
    assert.deepEqual([out.before.front, out.before.back], ["1", "0"]);
    assert.deepEqual([out.flipped.front, out.flipped.back], ["0", "1"]);
    for (const s of [out.before, out.flipped]) assert.deepEqual([s.card, s.frontT, s.backT], ["none", "none", "none"], "nothing turns");
    assert.equal(out.fade, "0.2s");
    assert.deepEqual([out.reset.front, out.reset.back], ["1", "0"], "a new card shows its front at once");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("the reset of a new card turns the fade off around the un-flip", function() {
  const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
  assert.match(app, /fcCardEl\.classList\.add\("fc-no-anim"\);\n  setFlashcardFaces\(false\);\n  void fcCardEl\.offsetHeight;[^\n]*\n  fcCardEl\.classList\.remove\("fc-no-anim"\);/);
  const css = fs.readFileSync(path.join(root, "client", "style.css"), "utf8");
  assert.doesNotMatch(css, /rotateY|backface-visibility/, "no 3D turn is left behind");
});
