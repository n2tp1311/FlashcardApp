"use strict";
// A due lesson row shows its "N due" badge and no line repeating it (that line was amber at
// 3:1 contrast); a lesson not due yet still says when it comes back.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const express = require("express");

const root = path.join(__dirname, "..");
let base, listener;
test.before(() => new Promise((ok) => {
  const server = express();
  server.use(express.static(path.join(root, "client")));
  listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); });
}));
test.after(() => listener.close());

test("a due lesson has the badge only; a scheduled one says when it is next due", async function() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.showPrefsPage === "function");
    const ids = await page.evaluate(async () => {
      localStorage.setItem("fc-preferences", JSON.stringify({ tutorialSeen: true }));
      const c = await store.createClass({ name: "Stats", color: "#7c3aed" });
      const a = await store.createLesson({ classId: c.id, title: "Due lesson", format: "term-def", sort_order: 0 });
      const b = await store.createLesson({ classId: c.id, title: "Later lesson", format: "term-def", sort_order: 1 });
      return { cls: c.id, due: a.id, later: b.id };
    });
    await page.reload();
    await page.waitForFunction(() => typeof window.showPrefsPage === "function");
    await page.keyboard.press("Escape");
    await page.evaluate((ids) => {
      store.getDueLessons = function() {
        const dueCounts = {}, schedule = {};
        dueCounts[ids.due] = 2;
        schedule[ids.later] = Math.floor(Date.now() / 1000) + 3 * 86400;
        return Promise.resolve({ due: [ids.due], dueCounts: dueCounts, schedule: schedule });
      };
      openClass(ids.cls);
    }, ids);
    await page.waitForSelector("#lesson-list .lesson-item.lesson-due .due-badge");
    const rows = await page.$$eval("#lesson-list .lesson-item", (els) => els.map((e) => ({
      title: e.querySelector(".lesson-title").textContent,
      badge: (e.querySelector(".due-badge") || {}).textContent || "",
      label: (e.querySelector(".lesson-due-label") || {}).textContent || ""
    })));
    const due = rows.find((r) => r.title === "Due lesson"), later = rows.find((r) => r.title === "Later lesson");
    assert.match(due.badge, /2/);
    assert.equal(due.label, "", "no line repeating the badge");
    assert.match(later.label, /3d/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("the amber due line and the unused accuracy colours are gone from the stylesheet", function() {
  const css = fs.readFileSync(path.join(root, "client", "style.css"), "utf8");
  const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
  assert.doesNotMatch(css, /lesson-due-label\.is-due|\.acc-(good|bad)\b|#d97706; \}/);
  assert.doesNotMatch(app, /cardsDueForReview/);
});
