"use strict";
// Study Setup with no presets starts at Card Count: the Presets section (an empty row and a gear
// with nothing to manage) is hidden, and saving the current choices comes after Card Order.
const test = require("node:test");
const assert = require("node:assert/strict");
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

test("no presets: no section and Save after Card Order; one preset: the section is back on top", async function() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.showPrefsPage === "function");
    const ids = await page.evaluate(async () => {
      localStorage.setItem("fc-preferences", JSON.stringify({ tutorialSeen: true }));
      const c = await store.createClass({ name: "Stats", color: "#7c3aed" });
      const l = await store.createLesson({ classId: c.id, title: "Week 1", format: "term-def", sort_order: 0 });
      await store.createCards([{ lessonId: l.id, format: "term-def", data: { term: "t", def: "d" } }]);
      return { cls: c.id, lesson: l.id };
    });
    await page.reload();
    await page.waitForFunction(() => typeof window.showPrefsPage === "function");
    await page.keyboard.press("Escape");
    await page.evaluate((id) => openLesson(id), ids.lesson);
    await page.waitForSelector("#screen-lesson.active");
    await page.tap("#btn-study-lesson");
    await page.waitForSelector("#screen-setup.active");

    const empty = await page.evaluate(() => {
      const sec = document.getElementById("setup-presets-section"), save = document.getElementById("btn-setup-save-preset");
      const order = document.getElementById("setup-order-section");
      const firstShown = [...document.querySelectorAll("#screen-setup .setup-container > .setup-section")].find((e) => e.getBoundingClientRect().height > 0);
      return { hidden: sec.getBoundingClientRect().height === 0, first: firstShown.querySelector(".setup-label").textContent,
        saveAfterOrder: !!(order.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING), label: save.textContent.trim() };
    });
    assert.deepEqual(empty, { hidden: true, first: "Card Count", saveAfterOrder: true, label: "+ Save these settings as a preset" });

    await page.tap("#btn-setup-save-preset");
    assert.equal(await page.$eval("#setup-preset-name-input", (i) => !i.classList.contains("hidden")), true, "naming happens where Save was tapped");

    await page.evaluate(() => {
      state.studyPresets = [{ id: "p1", name: "Quick review", values: { "setup-count": "10", "setup-filter": "due", "setup-mode": "flashcard", "setup-order": "shuffle" } }];
      renderSetupPresets();
    });
    const one = await page.evaluate(() => ({
      shown: document.getElementById("setup-presets-section").getBoundingClientRect().height > 0,
      chips: [...document.querySelectorAll("#setup-presets-list .setup-preset-chip-name")].map((c) => c.textContent) }));
    assert.deepEqual(one, { shown: true, chips: ["Quick review"] });
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
