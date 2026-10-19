const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const path = require("node:path");
const { chromium } = require("playwright");

// Fixes from the 2026-10-19 mobile UX audit, each run in the real client on a phone-sized
// page (no server: the store is stubbed where a test needs it).
const root = path.join(__dirname, "..");
let listener, base, browser;
test.before(async function() {
  await new Promise((ok) => {
    const server = express();
    server.use(express.static(path.join(root, "client")));
    listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); });
  });
  browser = await chromium.launch({ headless: true });
});
test.after(async function() { if (browser) await browser.close(); listener.close(); });

async function withApp(fn, opts) {
  const page = await browser.newPage(Object.assign({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" }, opts));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.showScreen === "function" && typeof window.openModal === "function");
    await fn(page);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

// A finger from the left edge to the middle of the screen.
function edgeSwipe(page) {
  return page.evaluate(function() {
    function touch(x) { return new Touch({ identifier: 1, target: document.body, clientX: x, clientY: 400 }); }
    document.dispatchEvent(new TouchEvent("touchstart", { touches: [touch(5)], changedTouches: [touch(5)], bubbles: true }));
    document.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [touch(200)], bubbles: true }));
  });
}

test("an edge swipe with a dialog open closes the dialog and leaves the screen behind it", async function() {
  await withApp(async function(page) {
    await page.evaluate(function() {
      showScreen("lesson");
      openModal("card-cloze");
    });
    await edgeSwipe(page);
    const r = await page.evaluate(() => ({ screen: getActiveScreen(), open: !document.getElementById("modal-overlay").classList.contains("hidden") }));
    assert.deepEqual(r, { screen: "lesson", open: false });
    // With no dialog the same swipe is Back.
    await edgeSwipe(page);
    assert.equal(await page.evaluate(() => getActiveScreen()), "class");
  });
});

test("an edge swipe over an edited dialog asks before discarding", async function() {
  await withApp(async function(page) {
    await page.evaluate(function() {
      showScreen("lesson");
      openModal("card-cloze");
      document.getElementById("card-cloze-input").value = "typed, not saved";
    });
    await edgeSwipe(page);
    const r = await page.evaluate(() => ({ screen: getActiveScreen(), cloze: !document.getElementById("modal-card-cloze").classList.contains("hidden") }));
    assert.deepEqual(r, { screen: "lesson", cloze: true });
  });
});

test("Home that cannot load its classes says why, offers Try again, and loads once back online", async function() {
  await withApp(async function(page) {
    await page.evaluate(function() {
      window.__fail = true;
      store.getClasses = function() { return window.__fail ? Promise.reject(new Error("offline")) : Promise.resolve([]); };
      showScreen("home");
      renderHome();
    });
    await page.waitForSelector("#home-load-failed:not(.hidden)");
    assert.match(await page.textContent("#home-load-failed"), /Couldn't load your classes\.\s*Try again/);
    await page.evaluate(function() { window.__fail = false; window.dispatchEvent(new Event("online")); });
    await page.waitForSelector("#home-load-failed.hidden", { state: "attached" });
    assert.equal(await page.isVisible("#empty-home"), true);
  });
});

test("a list already on Home stays when a later reload fails", async function() {
  await withApp(async function(page) {
    await page.evaluate(function() {
      store.getClasses = function() { return Promise.resolve([{ id: "c1", name: "Statistics", archived: 0 }]); };
      showScreen("home");
      renderHome();
    });
    await page.waitForFunction(() => document.querySelector("#class-list > *"));
    await page.evaluate(function() {
      store.getClasses = function() { return Promise.reject(new Error("offline")); };
      renderHome();
    });
    await page.waitForTimeout(100);
    assert.equal(await page.isVisible("#home-load-failed"), false);
    assert.match(await page.textContent("#class-list"), /Statistics/);
  });
});
