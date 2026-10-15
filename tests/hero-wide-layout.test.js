"use strict";
// Home's top card on a wide screen: Today is a full-width band on top, the other two tiles share
// the row below. Three equal columns all took Today's height and left the others half empty.
// On a phone the tiles stack in the DOM's order. The real stylesheet, measured in a browser.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
function fn(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}

const tile = (cls, h) => '<section class="dash-tile' + cls + '" style="min-height:' + h + 'px"><h3 class="dash-tile-h">t</h3></section>';
const today = '<section class="dash-tile is-today"><h3 class="dash-tile-h">Today</h3>' +
  '<div class="dash-today-main"><div style="height:120px">goal and button</div></div>' +
  '<div class="dash-meters"><div style="height:90px">meters</div></div></section>';
function card(tiles) { return '<div class="dash-hero-card"><div class="dash-hero-tiles">' + tiles + '</div></div>'; }

let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { if (browser) await browser.close(); });

async function layout(width, html) {
  const p = await browser.newPage({ viewport: { width, height: 900 } });
  await p.setContent("<!doctype html><body style='margin:0;padding:16px'>" + html + "</body>");
  await p.addStyleTag({ path: path.join(root, "client", "style.css") });
  const r = await p.evaluate(() => [...document.querySelectorAll(".dash-hero-tiles > *")].map((el) => {
    const b = el.getBoundingClientRect();
    const main = el.querySelector(".dash-today-main"), meters = el.querySelector(".dash-meters");
    return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width),
      side: main && meters ? Math.round(meters.getBoundingClientRect().left) > Math.round(main.getBoundingClientRect().right) : null };
  }));
  await p.close();
  return r;
}

test("wide: Today is a band across the top, goal and button beside the meters; the other two share the row below", async () => {
  const [streak, t, time] = await layout(1240, card(tile("", 300) + today + tile("", 260)));
  assert.ok(t.y < streak.y && t.y < time.y, "Today first");
  assert.ok(t.w > 1100, "Today spans the card");
  assert.equal(t.side, true, "meters to the right of the button");
  assert.equal(streak.y, time.y, "streak and window side by side");
  assert.ok(streak.x < time.x);
});

test("a narrower window (a tablet, a half screen) still puts Today on top, stacked inside, with no orphan tile", async () => {
  const [streak, t, time] = await layout(560, card(tile("", 300) + today + tile("", 260)));
  assert.ok(t.y < streak.y);
  assert.equal(t.side, false, "too narrow for the two halves");
  assert.equal(streak.y, time.y);
});

test("a phone keeps the stack in the DOM's order", async () => {
  const [streak, t, time] = await layout(390, card(tile("", 300) + today + tile("", 260)));
  assert.ok(streak.y < t.y && t.y < time.y);
  assert.equal(t.side, false);
  assert.equal(streak.w, t.w);
});

test("with a tile hidden from the gear, the one left takes the row under Today; without Today nothing changes", async () => {
  const [other, t] = await layout(1240, card(tile("", 300) + today));
  assert.ok(t.y < other.y);
  assert.equal(other.w, t.w);
  const three = await layout(1240, card(tile("", 200) + tile("", 200) + tile("", 200)));
  assert.equal(new Set(three.map((x) => x.y)).size, 1, "the Dashboard-style row of equals is untouched");
});

test("Today's tile is built as the two groups the band lays out, and the placeholder has its shape", () => {
  assert.match(fn("heroTodayTile"), /'<section class="dash-tile is-today">' \+\n    '<h3 class="dash-tile-h">' \+ escHtml\(t\("hero\.today"\)\) \+ '<\/h3>' \+\n    '<div class="dash-today-main">' \+ head \+/);
  assert.match(fn("homeHeroSkeleton"), /tile \+ '<section class="dash-tile is-today">' \+ bars \+ '<\/section>' \+ tile/);
});
