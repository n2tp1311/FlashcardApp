const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

// The real study screen markup and stylesheet, without app.js: on a phone the grade row is
// sticky and the card runs under it, which once hid the Save word chip behind the grades.
const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const start = app.indexOf("\nfunction placeVocabularySelectionAction(");
const place = app.slice(start, app.indexOf("\n}\n", start) + 3);

let browser;
before(async function() { browser = await chromium.launch({ headless: true }); });
after(async function() { if (browser) await browser.close(); });

async function studyScreen(width, height) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, isMobile: true });
  await page.route("**/*.js", (r) => r.abort());
  await page.goto("file://" + path.join(root, "client", "index.html"));
  await page.addScriptTag({ content: place });
  await page.evaluate(function() {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    document.getElementById("screen-flashcard").classList.add("active");
    document.getElementById("fc-back-content").textContent =
      "A set of points closed under affine combinations, such as weighted averages whose weights sum to one.";
    document.getElementById("screen-flashcard").scrollIntoView({ block: "end" });
    const action = document.getElementById("fc-selection-action");
    action.classList.remove("hidden");
    placeVocabularySelectionAction(action);
  });
  return page;
}

for (const [w, h] of [[390, 844], [375, 667]]) {
  test("on a " + w + "x" + h + " phone the Save word chip shows above the grade row, not behind it", async function() {
    const page = await studyScreen(w, h);
    const r = await page.evaluate(function() {
      const chip = document.getElementById("btn-save-selected-word").getBoundingClientRect();
      const nav = document.querySelector("#screen-flashcard .fc-nav").getBoundingClientRect();
      const hit = document.elementFromPoint(chip.left + chip.width / 2, chip.top + chip.height / 2);
      return { chipBottom: chip.bottom, chipTop: chip.top, navTop: nav.top, hit: hit && (hit.id || hit.className), onTop: hit && hit.id === "btn-save-selected-word" };
    });
    assert.ok(r.chipBottom <= r.navTop && r.chipTop > 0, JSON.stringify(r));
    assert.equal(r.onTop, true, "the chip is the element a tap lands on: " + JSON.stringify(r));
    await page.close();
  });
}

test("on a desktop the chip stays in the flow under the card", async function() {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.route("**/*.js", (r) => r.abort());
  await page.goto("file://" + path.join(root, "client", "index.html"));
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("fc-selection-action")).position), "static");
  await page.close();
});
