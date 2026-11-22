"use strict";
// The small text under lessons and cards on a phone: 12px, not 11; a lesson with nothing learned
// shows no "0% mastered" bar and a moving one has "% mastered" on the bar's line; a card says only
// what has happened to it, on one line, and a new card says nothing beside its New pill.
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

test("lesson bars hide at no progress and keep % on their line; card meta is one line of facts", async function() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.showPrefsPage === "function");
    const ids = await page.evaluate(async () => {
      localStorage.setItem("fc-preferences", JSON.stringify({ tutorialSeen: true }));
      const c = await store.createClass({ name: "Stats", color: "#7c3aed" });
      const a = await store.createLesson({ classId: c.id, title: "Untouched", format: "term-def", sort_order: 0 });
      const b = await store.createLesson({ classId: c.id, title: "Moving", format: "term-def", sort_order: 1 });
      return { cls: c.id, a: a.id, b: b.id };
    });
    await page.reload();
    await page.waitForFunction(() => typeof window.showPrefsPage === "function");
    await page.keyboard.press("Escape");
    await page.evaluate((id) => openClass(id), ids.cls);
    await page.waitForSelector("#lesson-list .lesson-item");
    const rows = await page.evaluate((ids) => {
      setLessonProgress(ids.a, { total: 10, known: 0, mastery: { mastered: 0, known: 0, learning: 0, new: 10 } });
      setLessonProgress(ids.b, { total: 10, known: 3, mastery: { mastered: 3, known: 2, learning: 1, new: 4 } });
      const row = (id) => {
        const wrap = document.getElementById("les-prog-wrap-" + id), text = wrap.querySelector(".progress-mini-text");
        const bar = wrap.querySelector(".mastery-bar");
        return { shown: wrap.getBoundingClientRect().height > 0, text: text ? text.textContent : "",
          sameLine: !!(bar && text) && Math.abs(bar.getBoundingClientRect().top + 3 - (text.getBoundingClientRect().top + text.getBoundingClientRect().height / 2)) < 8,
          size: text ? getComputedStyle(text).fontSize : "" };
      };
      return { a: row(ids.a), b: row(ids.b) };
    }, ids);
    assert.equal(rows.a.shown, false, "no bar for a lesson with nothing learned");
    assert.deepEqual(rows.b, { shown: true, text: "30% mastered", sameLine: true, size: "12px" });

    const now = Math.floor(Date.now() / 1000);
    const cards = await page.evaluate((now) => {
      IS_SERVER = true;
      const card = (id, extra) => Object.assign({ id: id, lesson_id: "L", format: "term-def", data: { term: "T" + id, def: "D" } }, extra);
      store.getLessonStats = () => Promise.resolve({ statsMap: {}, cards: [
        card("new", { last_seen_at: now - 86400 * 140 }),
        card("both", { last_studied_at: now - 2 * 86400 - 60, srs_due_at: now + 3 * 86400 + 60 }),
        card("dueOnly", { srs_due_at: now + 86400 + 60 })] });
      state.currentLesson = { id: "L", title: "L", format: "term-def" };
      renderCards();
      return new Promise((ok) => setTimeout(() => ok([...document.querySelectorAll("#card-list .card-item")].map((el) => {
        const m = el.querySelectorAll(".card-ts-item");
        return { n: m.length, text: m[0] ? m[0].textContent : "", size: m[0] ? getComputedStyle(m[0]).fontSize : "" };
      })), 300));
    }, now);
    assert.deepEqual(cards, [
      { n: 0, text: "", size: "" },
      { n: 1, text: "Next review in 3d · studied 2d ago", size: "12px" },
      { n: 1, text: "Next review in 1d", size: "12px" }]);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
