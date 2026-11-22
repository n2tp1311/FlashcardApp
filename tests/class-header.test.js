"use strict";
// The class and lesson headers on a phone: each has one filled action (Study class, Study),
// "+ Lesson" sits in the class's ⋮, and a long class name wraps to two lines instead of "Learni…".
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

test("class: Study class is filled and first, + Lesson is in ⋮, the name wraps, and it opens Setup on every lesson", async function() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.showPrefsPage === "function");
    const ids = await page.evaluate(async () => {
      localStorage.setItem("fc-preferences", JSON.stringify({ tutorialSeen: true }));
      const c = await store.createClass({ name: "Elements of Statistical Learning", color: "#2563eb" });
      const empty = await store.createClass({ name: "Empty", color: "#2563eb" });
      const lessons = [];
      for (const title of ["Week 1", "Week 2"]) {
        const l = await store.createLesson({ classId: c.id, title: title, format: "term-def", sort_order: lessons.length });
        await store.createCards([{ lessonId: l.id, format: "term-def", data: { term: "t", def: "d" } }]);
        lessons.push(l.id);
      }
      return { cls: c.id, empty: empty.id, lesson: lessons[0] };
    });
    await page.reload();
    await page.waitForFunction(() => typeof window.showPrefsPage === "function");
    await page.keyboard.press("Escape");
    await page.evaluate((id) => openClass(id), ids.cls);
    await page.waitForSelector("#btn-study-class:not(.hidden)");

    const head = await page.evaluate(() => {
      const actions = [...document.querySelectorAll("#screen-class .header-actions > *")].filter((e) => e.getBoundingClientRect().width > 0);
      const study = document.getElementById("btn-study-class"), name = document.getElementById("class-detail-name");
      const s = getComputedStyle(study);
      return { first: actions[0].id, bg: s.backgroundColor, color: s.color,
        newLessonInMenu: !!document.querySelector("#class-dropdown-menu #btn-new-lesson"),
        clipped: name.scrollWidth > name.clientWidth + 1, lines: Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)) };
    });
    assert.equal(head.first, "btn-study-class");
    assert.equal(head.color, "rgb(255, 255, 255)", "filled: " + head.bg);
    assert.equal(head.newLessonInMenu, true);
    assert.equal(head.clipped, false, "the name is not cut off");
    assert.ok(head.lines <= 2, "at most two lines: " + head.lines);

    await page.tap("#btn-study-class");
    await page.waitForSelector("#screen-setup.active");
    const setup = await page.evaluate(() => ({ lessons: state.studyScope.lessonIds.length, back: state.studyScope.returnScreen,
      interleaved: document.getElementById("pill-order-interleaved").style.display !== "none" }));
    assert.deepEqual(setup, { lessons: 2, back: "class", interleaved: true });

    await page.evaluate((id) => openClass(id), ids.empty);
    await page.waitForSelector("#empty-class:not(.hidden)");
    assert.equal(await page.$eval("#btn-study-class", (b) => b.classList.contains("hidden")), true, "nothing to study in an empty class");

    await page.evaluate((id) => openLesson(id), ids.lesson);
    await page.waitForSelector("#screen-lesson.active");
    const lesson = await page.evaluate(() => {
      const first = [...document.querySelectorAll("#screen-lesson .header-actions > *")].find((e) => e.getBoundingClientRect().width > 0);
      return { first: first.id, color: getComputedStyle(document.getElementById("btn-study-lesson")).color };
    });
    assert.deepEqual(lesson, { first: "btn-study-lesson", color: "rgb(255, 255, 255)" });
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
