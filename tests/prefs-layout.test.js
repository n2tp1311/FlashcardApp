"use strict";
// Preferences as a list of topics: on a phone the list fits one screen and each topic opens its
// own page, Back returns to the list; on a computer the list stays beside the page. Changes are
// kept as they are made, with no Save button. Runs the real app in offline mode.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");

// The page loads /app.js and /style.css by absolute path, so it needs a server; with no
// APP_CONFIG it runs as the offline app.
const express = require("express");
let base, listener;
test.before(() => new Promise((ok) => {
  const server = express();
  server.use(express.static(path.join(root, "client")));
  listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); });
}));
test.after(() => listener.close());

async function openApp(viewport, fn) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport, isMobile: viewport.width < 600, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.showPrefsPage === "function");
    await page.evaluate(() => document.getElementById("btn-open-preferences").click());
    await fn(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

const shown = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && el.getClientRects().length > 0; }, sel);

test("there is no Save button and nothing asks before closing", function() {
  assert.doesNotMatch(html, /btn-save-preferences/);
  assert.doesNotMatch(app, /"preferences", "dash-metrics"\]|prefsSnapshot|reminderSaveHint/);
  for (const k of ["pref.saved", "pref.groupPlan", "pref.groupMemory", "pref.groupReminders"]) {
    assert.equal(app.split('"' + k + '":').length - 1, 2, k + " needs an English and a Vietnamese string");
  }
});

test("phone: the list fits one screen, a topic opens its page, Back returns to the list", async function() {
  await openApp({ width: 375, height: 667 }, async (page) => {
    const list = await page.evaluate(() => {
      const modal = document.getElementById("modal-preferences");
      const body = modal.querySelector(".modal-body");
      return { page: modal.dataset.page || null, scrolls: body.scrollHeight > body.clientHeight + 1,
               fits: modal.getBoundingClientRect().bottom <= innerHeight };
    });
    assert.equal(list.page, null);
    assert.equal(list.scrolls, false, "the topic list scrolls on a phone");
    assert.ok(list.fits);
    assert.equal(await page.locator(".pref-nav-row small").count(), 0, "rows carry no summary line");
    assert.equal(await shown(page, ".pref-pages"), false);
    // The offline app has no server for these.
    for (const id of ["#pref-nav-memory", "#pref-nav-reminders", "#pref-nav-data"]) assert.equal(await shown(page, id), false, id);

    await page.click("#pref-nav-sound");
    assert.equal(await shown(page, "#pref-home"), false);
    assert.equal(await shown(page, "#pref-sounds"), true);
    assert.equal(await shown(page, "#pref-font-decrease"), false, "only the open topic is shown");
    assert.equal(await shown(page, "#pref-back"), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), "pref-back");

    await page.keyboard.press("Escape");
    assert.equal(await shown(page, "#modal-preferences"), true, "Back from a page closes the dialog");
    assert.equal(await shown(page, "#pref-home"), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), "pref-nav-sound");
    await page.keyboard.press("Escape");
    assert.equal(await shown(page, "#modal-preferences"), false);
  });
});

test("a change is kept straight away and shows Saved; closing keeps it too", async function() {
  await openApp({ width: 375, height: 667 }, async (page) => {
    await page.click("#pref-nav-appearance");
    await page.click("#pref-font-increase");
    await page.click("#pref-font-increase");
    await page.waitForFunction(() => document.getElementById("pref-saved").classList.contains("show"));
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("fc-preferences")));
    assert.equal(stored.fontScale, 1.2);

    await page.click("#pref-back");
    await page.click("#pref-nav-plan");
    await page.fill("#pref-max-reviews", "150");
    // Closed before the typing pause ends: still saved.
    await page.click("#modal-preferences .modal-close");
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem("fc-preferences")));
    assert.equal(after.maxReviewsPerDay, 150);
    assert.equal(after.fontScale, 1.2, "the earlier change survives the merge");
  });
});

test("computer: the list stays beside the open page", async function() {
  await openApp({ width: 1100, height: 800 }, async (page) => {
    const r = await page.evaluate(() => {
      const nav = document.getElementById("pref-home").getBoundingClientRect();
      const pages = document.querySelector(".pref-pages").getBoundingClientRect();
      return { page: document.getElementById("modal-preferences").dataset.page,
               current: document.querySelector('.pref-nav-row[aria-current="page"]').dataset.page,
               side: nav.right <= pages.left && nav.width > 0 && pages.width > 0 };
    });
    assert.deepEqual(r, { page: "appearance", current: "appearance", side: true });
    assert.equal(await shown(page, "#pref-back"), false);
    await page.click("#pref-nav-sound");
    assert.equal(await shown(page, "#pref-home"), true);
    assert.equal(await shown(page, "#pref-sounds"), true);
    fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
    await page.locator("#modal-preferences").screenshot({ path: path.join(root, "test-results", "prefs-desktop.png") });
  });
});

test("phone screenshot of the topic list", async function() {
  await openApp({ width: 375, height: 667 }, async (page) => {
    fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
    await page.locator("#modal-preferences").screenshot({ path: path.join(root, "test-results", "prefs-phone.png") });
    await page.click("#pref-nav-appearance");
    await page.locator("#modal-preferences").screenshot({ path: path.join(root, "test-results", "prefs-phone-page.png") });
  });
});
