"use strict";
// Home's header on a phone: one + opens New class and Import file (labelled, not an arrow that
// read as share), and Select is on the Your Classes toolbar, not in the sidebar's navigation.
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
  browser = await chromium.launch({ headless: true, args: ["--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"] });
});
test.after(async () => { if (browser) await browser.close(); listener.close(); });

async function home(page) {
  await page.goto(base + "/");
  await page.waitForFunction(() => typeof window.showPrefsPage === "function");
  await page.evaluate(async () => {
    localStorage.setItem("fc-preferences", JSON.stringify({ tutorialSeen: true }));
    await store.createClass({ name: "Stats", color: "#7c3aed" });
  });
  await page.reload();
  await page.waitForFunction(() => typeof window.showPrefsPage === "function");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#class-list .class-card");
  // The header's buttons show once signed in to a server; this static copy has no sign-in.
  await page.evaluate(() => document.getElementById("user-nav").classList.remove("hidden"));
}

test("+ opens New class and Import file; Select sits beside Archived; the sidebar has no Select", async function() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await home(page);
    const header = await page.evaluate(() => [...document.querySelectorAll("#user-nav button")]
      .filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.id));
    assert.deepEqual(header, ["btn-home-add", "btn-user-menu"]);
    assert.equal(await page.evaluate(() => !!document.getElementById("sidebar-select-link")), false);

    // Import is server-only, as before; here it is made visible to see the menu it lives in.
    await page.evaluate(() => document.getElementById("btn-import-flashcards").classList.remove("hidden"));
    await page.tap("#btn-home-add");
    const items = await page.$$eval("#home-add-menu:not(.hidden) .dropdown-item", (els) =>
      els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim()));
    assert.deepEqual(items, ["New Class", "Import file"]);
    await page.tap("#btn-new-class");
    await page.waitForSelector("#modal-class:not(.hidden), .modal-overlay:not(.hidden)");
    assert.equal(await page.$eval("#home-add-menu", (m) => m.classList.contains("hidden")), true, "the menu closes");
    await page.keyboard.press("Escape");

    // Without import (local mode) + creates a class at once instead of a one-item menu.
    await page.evaluate(() => document.getElementById("btn-import-flashcards").classList.add("hidden"));
    await page.tap("#btn-home-add");
    await page.waitForSelector("#modal-class:not(.hidden), .modal-overlay:not(.hidden)");
    assert.equal(await page.$eval("#home-add-menu", (m) => m.classList.contains("hidden")), true);
    await page.keyboard.press("Escape");

    const sel = await page.evaluate(() => {
      const s = document.getElementById("btn-select-classes"), a = document.getElementById("btn-toggle-archived");
      const rs = s.getBoundingClientRect(), ra = a.getBoundingClientRect();
      return { shown: rs.width > 0, sameParent: s.parentElement === a.parentElement, text: s.innerText.trim(), height: rs.height === ra.height };
    });
    assert.deepEqual(sel, { shown: true, sameParent: true, text: "Select", height: true });
    await page.tap("#btn-select-classes");
    assert.equal(await page.$eval("#home-select-bar", (b) => b.classList.contains("hidden")), false, "Select enters select mode");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
