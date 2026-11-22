const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const path = require("node:path");
const { chromium } = require("playwright");

// Toolbar chips on a touchscreen (the last pill: in the gap between two narrow ones the later
// one wins, which is a fair split): they keep their size on screen, but a thumb within 44x44 of
// each still hits it. Chromium's hasTouch does not make (pointer: coarse) match, and CDP's
// media emulation is lost on navigation, so the pointer type is set at launch.
const css = path.join(__dirname, "..", "client", "style.css");
const markup = '<div class="sort-controls"><select id="class-sort-select" class="sort-select"><option>Level</option></select></div>' +
  '<div class="home-right-controls" style="margin-top:20px"><button id="btn-toggle-archived" class="pill">Archived</button>' +
  '<div class="view-toggle"><button class="view-toggle-btn active" id="grid">G</button><button class="view-toggle-btn" id="list">L</button></div></div>' +
  '<div class="study-now-classes" style="margin-top:20px"><button class="study-now-classes-btn"><span>New cards from Elements</span></button></div>' +
  '<div class="study-now-box has-gear" style="margin-top:20px"><div class="study-now">Study now</div><button class="study-now-gear">g</button></div>' +
  '<div class="slicer-bar" style="margin-top:20px"><button class="pill active">Term↔Def</button><button class="pill">MCQ</button></div>';
const chips = ["#btn-toggle-archived", ".study-now-classes-btn", ".study-now-gear", ".slicer-bar .pill:last-child"];

let coarse, fine;
before(async function() {
  coarse = await chromium.launch({ headless: true, args: ["--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"] });
  fine = await chromium.launch({ headless: true });
});
after(async function() { if (coarse) await coarse.close(); if (fine) await fine.close(); });

async function measure(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent("<body style='padding:20px'>" + markup + "</body>");
  await page.addStyleTag({ path: css });
  const r = await page.evaluate(function(sel) {
    function hits(el, x, y) { const at = document.elementFromPoint(x, y); return !!at && (at === el || el.contains(at)); }
    const out = { coarse: matchMedia("(pointer: coarse)").matches, chips: [] };
    sel.forEach(function(s) {
      const el = document.querySelector(s), b = el.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      out.chips.push({ s: s, h: Math.round(b.height), w: Math.round(b.width),
        reach: hits(el, cx, cy - 21) && hits(el, cx, cy + 21) && hits(el, cx - 21, cy) && hits(el, cx + 21, cy) });
    });
    const g = document.getElementById("grid"), l = document.getElementById("list");
    const gb = g.getBoundingClientRect(), lb = l.getBoundingClientRect();
    out.toggles = { gw: gb.width, gh: gb.height, lw: lb.width, gHitsOwn: hits(g, gb.left + gb.width / 2, gb.top + gb.height / 2), lHitsOwn: hits(l, lb.left + lb.width / 2, lb.top + lb.height / 2) };
    out.select = document.querySelector(".sort-select").getBoundingClientRect().height;
    return out;
  }, chips);
  await page.close();
  return r;
}

test("on a touchscreen each chip is hit anywhere within 44x44, but keeps its drawn size", async function() {
  const r = await measure(coarse);
  assert.equal(r.coarse, true);
  r.chips.forEach(function(c) {
    assert.ok(c.reach, c.s + " is hit 21px from its centre: " + JSON.stringify(c));
    if (c.s !== ".study-now-gear" && c.s !== ".study-now-classes-btn") assert.ok(c.h < 40, c.s + " looks the same: " + c.h);
  });
  assert.ok(r.select >= 44, "the select grows: " + r.select);
  assert.ok(r.toggles.gw >= 44 && r.toggles.gh >= 44 && r.toggles.lw >= 44, JSON.stringify(r.toggles));
  assert.ok(r.toggles.gHitsOwn && r.toggles.lHitsOwn, "grid and list each keep their own tap");
});

test("with a mouse nothing changes", async function() {
  const r = await measure(fine);
  assert.equal(r.coarse, false);
  assert.ok(r.select < 40 && r.toggles.gw < 40, JSON.stringify(r));
  assert.ok(!r.chips.find(function(c) { return c.s === "#btn-toggle-archived"; }).reach, "no hidden tap area on desktop");
});
