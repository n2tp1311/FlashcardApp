"use strict";
// Class cards, class list rows and a lesson's cards show Edit and a ⋯; pin, archive, flag and
// delete are in the menu, so the trash can is no longer under the thumb on every card.
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
  // A touchscreen: Chromium's hasTouch alone does not make (pointer: coarse) match.
  browser = await chromium.launch({ headless: true, args: ["--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"] });
});
test.after(async () => { if (browser) await browser.close(); listener.close(); });

async function setup(page) {
  await page.goto(base + "/");
  await page.waitForFunction(() => typeof window.showPrefsPage === "function");
  const ids = await page.evaluate(async () => {
    localStorage.setItem("fc-preferences", JSON.stringify({ tutorialSeen: true }));
    const out = {};
    for (const name of ["Stats", "Forecasting", "Algebra"]) {
      const c = await store.createClass({ name: name, color: "#7c3aed" });
      const l = await store.createLesson({ classId: c.id, title: "Week 1", format: "term-def", sort_order: 0 });
      await store.createCards([{ lessonId: l.id, format: "term-def", data: { term: "Bias", def: "Error from wrong assumptions" } },
        { lessonId: l.id, format: "term-def", data: { term: "Variance", def: "Error from sensitivity" } }]);
      if (!out.cls) { out.cls = c.id; out.lesson = l.id; }
    }
    return out;
  });
  await page.reload();
  await page.waitForFunction(() => typeof window.showPrefsPage === "function");
  await page.keyboard.press("Escape");
  return ids;
}

// The visible buttons of a row, and whether the open menu's last item is what a tap there hits.
function inspect(page, rowSel) {
  return page.evaluate((rowSel) => {
    const row = document.querySelector(rowSel);
    const shown = [...row.querySelectorAll(":is(.class-card-actions, .card-actions) > button, .row-menu > button")]
      .filter((b) => b.getBoundingClientRect().width > 0 && getComputedStyle(b).opacity !== "0")
      .map((b) => b.getAttribute("aria-label"));
    const menu = row.querySelector(".row-menu .dropdown-menu");
    const items = [...menu.querySelectorAll(".dropdown-item")];
    const last = items[items.length - 1];
    let onTop = null;
    if (!menu.classList.contains("hidden")) {
      last.scrollIntoView({ block: "center" });
      const r = last.getBoundingClientRect();
      onTop = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === last ||
        last.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    }
    return { shown: shown, open: !menu.classList.contains("hidden"), items: items.map((i) => i.textContent), onTop: onTop,
      trashVisible: [...row.querySelectorAll("[data-cls-del], [data-card-del]")].some((b) => b.getBoundingClientRect().width > 0 && !b.closest(".dropdown-menu.hidden")) };
  }, rowSel);
}

test("a phone's class card shows Edit and ⋯; the menu holds pin, archive and delete, on top", async function() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    const ids = await setup(page);
    await page.waitForSelector("#class-list .class-card");
    const row = '#class-list .class-card:first-child';
    let r = await inspect(page, row);
    assert.deepEqual(r.shown, ["Edit", "More options"]);
    assert.equal(r.trashVisible, false);
    await page.tap(row + " [data-row-menu]");
    r = await inspect(page, row);
    assert.equal(r.open, true);
    assert.deepEqual(r.items, ["Pin to top", "Archive", "Delete"]);
    assert.equal(r.onTop, true, "the next card must not cover the menu");
    assert.equal(await page.evaluate(() => document.getElementById("screen-home").classList.contains("active")), true, "⋯ does not open the class");
    await page.tap(row + " [data-cls-del]");
    await page.waitForSelector("#modal-confirm:not(.hidden), .modal-overlay:not(.hidden)");
    assert.equal((await inspect(page, row)).open, false, "the menu closes behind the confirm");

    await page.keyboard.press("Escape");
    await page.evaluate((id) => { openClass(id); }, ids.cls);
    await page.waitForSelector("#lesson-list .lesson-item");
    await page.evaluate((id) => openLesson(id), ids.lesson);
    await page.waitForSelector("#card-list .card-item, .card-item");
    const card = ".card-item:first-of-type";
    r = await inspect(page, card);
    assert.deepEqual(r.shown, ["Edit", "More options"]);
    assert.equal(r.trashVisible, false);
    await page.tap(card + " [data-row-menu]");
    r = await inspect(page, card);
    assert.deepEqual(r.items, ["Delete"], "no flag for a card not from KnowledgeApp");
    assert.equal(r.onTop, true);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("on a desktop the class actions appear on hover and stay while the menu is open", async function() {
  const fine = await chromium.launch({ headless: true });
  const page = await fine.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  try {
    await setup(page);
    await page.waitForSelector("#class-list .class-card");
    const row = "#class-list .class-card:first-child";
    const opacity = () => page.$eval(row + " .class-card-actions", (a) => getComputedStyle(a).opacity);
    await page.mouse.move(5, 5);
    assert.equal(await opacity(), "0");
    await page.hover(row);
    await page.click(row + " [data-row-menu]");
    await page.mouse.move(5, 790);
    assert.equal(await opacity(), "1", "moving to the menu must not hide it");
    assert.equal((await inspect(page, row)).onTop, true);
  } finally {
    await fine.close();
  }
});
