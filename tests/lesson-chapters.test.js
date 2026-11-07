"use strict";
// A class's lesson list on a phone: in book order a KnowledgeApp class ("<chapter> — <topic>")
// shows each chapter once as a heading and each row as its topic; edit and delete sit behind ⋯.
const test = require("node:test");
const assert = require("node:assert/strict");
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

const TITLES = [
  "1. Introduction — Learning Methods and Applications",
  "1. Introduction — Vectors and Matrices",
  "2. Linear Algebra — Foundations And Matrix Operations",
  "4. Numerical Computation"
];

test("book order groups by chapter, other sorts show full names, and ⋯ holds edit and delete", async function() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 760 }, isMobile: true, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.showPrefsPage === "function");
    const ids = await page.evaluate(async (TITLES) => {
      localStorage.setItem("fc-preferences", JSON.stringify({ tutorialSeen: true }));
      const c = await store.createClass({ name: "Deep Learning", color: "#7c3aed" });
      const out = [];
      for (let i = 0; i < TITLES.length; i++) {
        const l = await store.createLesson({ classId: c.id, title: TITLES[i], format: "term-def", sort_order: i });
        await store.createCards([{ lessonId: l.id, format: "term-def", data: { term: "t" + i, def: "d" + i } }]);
        out.push(l.id);
      }
      return { cls: c.id, lessons: out };
    }, TITLES);
    await page.reload();
    await page.waitForFunction(() => typeof window.showPrefsPage === "function");
    await page.keyboard.press("Escape");
    await page.evaluate((id) => openClass(id), ids.cls);
    await page.waitForSelector("#lesson-list .lesson-item");

    const heads = () => page.$$eval("#lesson-list .lesson-chapter-name", (els) => els.map((e) => e.textContent));
    const rows = () => page.$$eval("#lesson-list .lesson-title", (els) => els.map((e) => e.textContent));
    assert.deepEqual(await heads(), ["1. Introduction", "2. Linear Algebra", "4. Numerical Computation"]);
    assert.deepEqual(await rows(), ["Learning Methods and Applications", "Vectors and Matrices",
      "Foundations And Matrix Operations", "Whole chapter"]);
    await page.waitForFunction(() => /1 card/.test(document.getElementById("les-chap-1").textContent));

    // The title has the row: at phone width it is most of the row's width, not a third.
    const share = await page.$eval("#lesson-list .lesson-item", (row) =>
      row.querySelector(".lesson-title").getBoundingClientRect().width / row.getBoundingClientRect().width);
    assert.ok(share > 0.7, "title takes " + share.toFixed(2) + " of the row");

    // ⋯ opens edit and delete; tapping it does not open the lesson.
    const first = '#lesson-list .lesson-item[data-lesson-id="' + ids.lessons[0] + '"]';
    assert.equal(await page.isVisible(first + " [data-les-edit]"), false);
    await page.click(first + " [data-les-menu]");
    assert.equal(await page.isVisible(first + " [data-les-edit]"), true);
    assert.equal(await page.isVisible(first + " [data-les-del]"), true);
    assert.equal(await page.evaluate(() => document.getElementById("screen-class").classList.contains("active")), true);
    await page.click(first + " [data-les-edit]");
    assert.equal(await page.isVisible(first + " [data-les-edit]"), false);
    await page.keyboard.press("Escape");

    // Another sort scatters chapters: no headings, full names.
    await page.evaluate(() => { state.currentLessonSort = "name"; renderLessons(); });
    await page.waitForFunction(() => !document.querySelector("#lesson-list .lesson-chapter-head")
      && document.querySelector("#lesson-list .lesson-title").textContent.indexOf(" — ") > 0);
    assert.equal((await rows()).length, 4);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("a class with no chapter names gets no headings", function() {
  const fs = require("fs");
  const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
  const src = ["splitLessonTitle", "lessonsGroupByChapter"].map((n) => {
    const i = app.indexOf("function " + n + "(");
    return app.slice(i, app.indexOf("\n}\n", i) + 2);
  }).join("\n");
  const ctx = new Function('var LESSON_CHAPTER_SEP = " — ";' + src + "return { splitLessonTitle, lessonsGroupByChapter };")();
  assert.equal(ctx.lessonsGroupByChapter([{ title: "Week 1" }, { title: "Week 2" }], "book_order"), false);
  assert.equal(ctx.lessonsGroupByChapter([{ title: "1. A — b" }], "name"), false);
  assert.equal(ctx.lessonsGroupByChapter([{ title: "1. A — b" }], "book_order"), true);
  assert.deepEqual(ctx.splitLessonTitle("3. P — Q — R"), { chapter: "3. P", topic: "Q — R" });
});
