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
  await page.addScriptTag({ content: "function t(k) { return k; }" + icons + ["classDoneLevel", "classGoalText", "setClassDoneMedal"].map(extract).join("") });
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

test("a class still in progress shows an empty badge that says what earns the check", async function() {
  const page = await render({ known: 200, total: 240, mastery: mastery(60, 170, 10) });
  for (const id of ["cls-done-c1", "cls-done-c2"]) {
    const m = await medal(page, id);
    assert.equal(m.display, "grid");
    assert.match(m.cls, /is-goal/);
    assert.doesNotMatch(m.cls, /is-learned|is-mastered/);
    assert.equal(m.label, "class.goalLearning");
  }
  await page.evaluate(function() { setClassDoneMedal("c1", { known: 0, total: 240, mastery: { mastered: 0, known: 0, learning: 0, new: 0 } }); });
  await page.evaluate(function() { setClassDoneMedal("c2", { known: 0, total: 0 }); });
  assert.equal((await medal(page, "cls-done-c2")).display, "none", "an empty class has nothing to earn");
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

test("a mastered class shows the solid double check, and the hover buttons line up beside it", async function() {
  for (const p of [{ known: 3, total: 240, mastery: mastery(240, 0, 0) }, { known: 3, total: 240, mastery: mastery(60, 170, 10) }]) {
    const page = await render(p);
    await page.hover("#card");
    await page.waitForTimeout(250);
    const r = await page.evaluate(function() {
      const m = document.getElementById("cls-done-c1"), a = document.querySelector(".class-card-actions");
      const mb = m.getBoundingClientRect(), ab = a.getBoundingClientRect();
      const hit = document.elementFromPoint(mb.left + mb.width / 2, mb.top + mb.height / 2);
      return { opacity: getComputedStyle(m).opacity, actions: getComputedStyle(a).opacity, gap: mb.left - ab.right, hitIsMedal: !!hit && !!hit.closest("#cls-done-c1") };
    });
    assert.ok(Number(r.opacity) >= 0.75, "not faded away: " + r.opacity);
    assert.equal(r.actions, "1");
    assert.ok(r.gap >= 4, "buttons end left of the badge: " + JSON.stringify(r));
    assert.ok(r.hitIsMedal, "the pointer reaches the badge, so its tip shows");
    await page.close();
  }
  const page = await render({ known: 3, total: 240, mastery: mastery(240, 0, 0) });
  const grid = await medal(page, "cls-done-c1");
  assert.match(grid.cls, /is-mastered/);
  assert.equal(grid.label, "class.masteredTooltip");
  await page.close();
});

test("a card falling back takes the medallion away", async function() {
  const page = await render({ known: 3, total: 240, mastery: mastery(240, 0, 0) });
  await page.evaluate(function() { setClassDoneMedal("c1", { known: 3, total: 240, mastery: { mastered: 239, known: 0, learning: 1, new: 0 } }); });
  const grid = await medal(page, "cls-done-c1");
  assert.match(grid.cls, /is-goal/);
  assert.equal(grid.paths, 1);
  assert.equal(grid.label, "class.goalLearning");
  await page.close();
});

test("on a phone, where the card's buttons are always shown, the medallion sits on the icon, clear of them", async function() {
  for (const width of [375, 481, 520, 600]) {
    const page = await render({ known: 3, total: 240, mastery: mastery(240, 0, 0) }, width);
    const r = await page.evaluate(function() {
      const box = (el) => el.getBoundingClientRect();
      const m = box(document.getElementById("cls-done-c1")), a = box(document.querySelector(".class-card-actions")), i = box(document.querySelector(".class-icon"));
      return { gapToActions: a.left - m.right, onIcon: m.left < i.right && m.top < i.bottom, opacity: getComputedStyle(document.querySelector(".class-card-actions")).opacity };
    });
    assert.equal(r.opacity, "1", "buttons always visible at " + width);
    assert.ok(r.gapToActions > 0 && r.onIcon, width + ": " + JSON.stringify(r));
    await page.hover("#card");
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("cls-done-c1")).opacity), "1");
    await page.close();
  }
});

test("on a touch screen the badge's tap area is finger-sized while it looks the same", async function() {
  const page = await browser.newPage({ viewport: { width: 375, height: 500 }, hasTouch: true, isMobile: true });
  await page.setContent('<meta name="viewport" content="width=device-width"><div class="class-grid" style="padding:16px"><div class="class-card" id="card"><div class="class-card-actions">' +
    '<button class="icon-btn">A</button><button class="icon-btn">E</button><button class="icon-btn">D</button></div>' +
    '<span class="class-done-medal hidden" id="cls-done-c1" role="img"></span><span class="class-icon" style="width:28px;height:28px"></span>' +
    '<div class="class-name">Linear Algebra</div></div></div>');
  await page.addStyleTag({ path: path.join(root, "client", "style.css") });
  await page.addScriptTag({ content: "function t(k) { return k; }" + icons + ["classDoneLevel", "classGoalText", "setClassDoneMedal"].map(extract).join("") });
  await page.evaluate(function() { setClassDoneMedal("c1", { known: 3, total: 240, mastery: { mastered: 60, known: 170, learning: 10, new: 0 } }); });
  const r = await page.evaluate(function() {
    const m = document.getElementById("cls-done-c1"), b = m.getBoundingClientRect(), a = getComputedStyle(m, "::after");
    const edge = document.elementFromPoint(b.left + b.width / 2, b.bottom + 8);
    return { size: b.width, after: a.content, inset: a.inset, pos: a.position, edgeHits: !!edge && !!edge.closest("#cls-done-c1"), hit: edge && (edge.tagName + "." + edge.className) };
  });
  assert.ok(r.size <= 22, "looks the same: " + r.size);
  assert.notEqual(r.after, "none");
  assert.ok(r.edgeHits, "a tap 8px outside the badge still reaches it: " + JSON.stringify(r));
  await page.close();
});
