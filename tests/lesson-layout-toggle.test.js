const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

// The class screen's Chapters | Concepts switch, rendered with the real markup and CSS.
const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");

function extract(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}
// The class screen's bar: the Home screen's sort bar has the same class and comes first.
const barStart = html.lastIndexOf('<div class="lesson-sort-bar">', html.indexOf('for="lesson-sort-select"'));
const bar = html.slice(barStart, html.indexOf('<div id="lesson-slicer-bar"', barStart));

let browser;
before(async function() { browser = await chromium.launch({ headless: true }); });
after(async function() { if (browser) await browser.close(); });

async function render(cls, width) {
  const page = await browser.newPage({ viewport: { width: width || 900, height: 300 } });
  await page.setContent('<div id="screen-class" class="screen active" style="padding:16px">' + bar + "</div>");
  await page.addStyleTag({ path: path.join(root, "client", "style.css") });
  await page.addScriptTag({ content: extract("renderLayoutToggle") });
  await page.evaluate(function(cls) { renderLayoutToggle(cls); }, cls);
  assert.equal(await page.locator(".lesson-sort-bar").count(), 1);
  return page;
}

function look(page) {
  return page.evaluate(function() {
    const el = document.getElementById("lesson-layout-toggle");
    const sel = document.getElementById("lesson-sort-select").getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return { hidden: getComputedStyle(el).display === "none",
      pressed: Array.from(el.querySelectorAll("[data-layout]")).map(function(b) { return b.dataset.layout + ":" + b.getAttribute("aria-pressed"); }),
      sameRow: Math.abs(box.top - sel.top) < 8, right: box.right, width: document.documentElement.clientWidth };
  });
}

test("a class with no by-concept layout shows no switch", async function() {
  const page = await render({ id: "k1" });
  assert.equal((await look(page)).hidden, true);
  await page.close();
});

test("a class shown by concept marks Concepts, beside Sort by, and fits a phone", async function() {
  for (const width of [900, 390]) {
    const page = await render({ id: "k1", lesson_layout: "concept" }, width);
    const got = await look(page);
    assert.equal(got.hidden, false);
    assert.deepEqual(got.pressed, ["chapter:false", "concept:true"]);
    assert.ok(got.right <= got.width, JSON.stringify(got));
    if (width === 900) assert.ok(got.sameRow, JSON.stringify(got));
    await page.close();
  }
});
