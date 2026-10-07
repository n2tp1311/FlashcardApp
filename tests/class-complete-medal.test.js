const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");

function extract(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}

const icons = app.slice(app.indexOf("\nvar CLASS_DONE_ICONS = {"), app.indexOf("\n};\n", app.indexOf("\nvar CLASS_DONE_ICONS = {")) + 4);

let browser;
before(async function() { browser = await chromium.launch({ headless: true }); });
after(async function() { if (browser) await browser.close(); });

async function render(p, width) {
  const page = await browser.newPage({ viewport: { width: width || 900, height: 500 } });
  await page.setContent(
    '<div class="class-grid" style="padding:16px">' +
      '<div class="class-card" id="card"><div class="class-card-actions">' +
        '<button class="icon-btn">A</button><button class="icon-btn">E</button><button class="icon-btn">D</button></div>' +
        '<span class="class-done-medal hidden" id="cls-done-c1" role="img"></span>' +
        '<span class="class-icon" style="width:28px;height:28px"></span>' +
        '<div class="class-name">Linear Algebra</div></div>' +
      '<div class="class-list-row" id="row"><div class="class-list-right">' +
        '<span class="class-done-medal hidden" id="cls-done-c2" role="img"></span></div></div>' +
    '</div>');
  await page.addStyleTag({ path: path.join(root, "client", "style.css") });
  await page.addScriptTag({ content: "function t(k) { return k; }" + icons + ["classDoneLevel", "setClassDoneMedal"].map(extract).join("") });
  await page.evaluate(function(p) { setClassDoneMedal("c1", p); setClassDoneMedal("c2", p); }, p);
  return page;
}

function medal(page, id) {
  return page.evaluate(function(id) {
    const el = document.getElementById(id), cs = getComputedStyle(el), box = el.getBoundingClientRect();
    const card = el.closest(".class-card, .class-list-row").getBoundingClientRect();
    return { display: cs.display, position: cs.position, cls: el.className, label: el.getAttribute("aria-label"),
      paths: el.querySelectorAll("path").length, rightGap: card.right - box.right, topGap: box.top - card.top };
  }, id);
}

const mastery = (mastered, known, learning) => ({ mastered, known, learning, new: 0 });

test("a class still in progress shows no medallion", async function() {
  const page = await render({ known: 200, total: 240, mastery: mastery(60, 170, 10) });
  assert.equal((await medal(page, "cls-done-c1")).display, "none");
  assert.equal((await medal(page, "cls-done-c2")).display, "none");
  await page.close();
});

test("a learned class shows one check in the grid card's top-right corner and in the list row", async function() {
  const page = await render({ known: 3, total: 240, mastery: mastery(60, 180, 0) });
  const grid = await medal(page, "cls-done-c1");
  assert.equal(grid.display, "grid");
  assert.equal(grid.position, "absolute");
  assert.match(grid.cls, /is-learned/);
  assert.equal(grid.label, "class.learnedTooltip");
  assert.ok(grid.rightGap > 0 && grid.rightGap < 20 && grid.topGap > 0 && grid.topGap < 20, JSON.stringify(grid));
  const row = await medal(page, "cls-done-c2");
  assert.equal(row.display, "grid");
  assert.equal(row.position, "static");
  await page.close();
});

test("a mastered class shows the solid double check, which steps aside for the hover buttons", async function() {
  const page = await render({ known: 3, total: 240, mastery: mastery(240, 0, 0) });
  const grid = await medal(page, "cls-done-c1");
  assert.match(grid.cls, /is-mastered/);
  assert.equal(grid.label, "class.masteredTooltip");
  await page.hover("#card");
  await page.waitForFunction(function() { return getComputedStyle(document.getElementById("cls-done-c1")).opacity === "0"; });
  await page.close();
});

test("a card falling back takes the medallion away", async function() {
  const page = await render({ known: 3, total: 240, mastery: mastery(240, 0, 0) });
  await page.evaluate(function() { setClassDoneMedal("c1", { known: 3, total: 240, mastery: { mastered: 239, known: 0, learning: 1, new: 0 } }); });
  const grid = await medal(page, "cls-done-c1");
  assert.equal(grid.display, "none");
  assert.equal(grid.label, null);
  await page.close();
});

test("on a phone, where the card's buttons are always shown, the medallion sits clear of them", async function() {
  for (const width of [375, 600]) {
    const page = await render({ known: 3, total: 240, mastery: mastery(240, 0, 0) }, width);
    const r = await page.evaluate(function() {
      const box = (el) => el.getBoundingClientRect();
      const m = box(document.getElementById("cls-done-c1")), a = box(document.querySelector(".class-card-actions")), i = box(document.querySelector(".class-icon"));
      return { gapToActions: a.left - m.right, gapToIcon: m.left - i.right, opacity: getComputedStyle(document.querySelector(".class-card-actions")).opacity };
    });
    assert.equal(r.opacity, "1", "buttons always visible at " + width);
    assert.ok(r.gapToActions > 0 && r.gapToIcon > 0, width + ": " + JSON.stringify(r));
    await page.hover("#card");
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("cls-done-c1")).opacity), "1");
    await page.close();
  }
});
