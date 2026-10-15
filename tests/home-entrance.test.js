const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

// Home's stats entrance with app.js's own builders and the real stylesheet: the bars fill,
// the ring draws, done days pop, the big numbers count up, and a met goal sparks once a day.
// Reduced motion shows the end state at once.
const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "client", "style.css"), "utf8");
function fn(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}
const code = "var GOAL_RING_R = 22;\n" +
  ["dailyGoalRing", "heroMeter", "playHomeEntrance", "countUpNumber", "goalSparkOnce"].map(fn).join("");

// A Home card as streakTimeHeroCard lays it out: a streak, a goal ring, three meters, a week.
const harness = `
function t(k) { return k; }
function escHtml(s) { return String(s); }
${code}
function mount(done, goal) {
  var week = ["done", "done", "rest", "done", "today", "future", "future"].map(function(s) {
    return '<div class="dash-week-day"><span class="dash-week-dot is-' + s + '"></span></div>';
  }).join("");
  document.body.innerHTML = '<div id="grid"><div class="dash-hero-card"><div class="dash-hero-tiles">' +
    '<section class="dash-tile"><div class="dash-tile-big is-streak is-lit"><svg width="22" height="22"></svg><span class="dash-tile-num">42</span></div>' +
    '<div class="dash-week">' + week + '</div></section>' +
    '<section class="dash-tile"><div class="dash-goal">' + dailyGoalRing(done, goal) + '</div><div class="dash-meters">' +
    heroMeter("time", "", "a", "1", 0.8) + heroMeter("new", "", "b", "2", 0.5) + heroMeter("review", "", "c", "3", 1) +
    '</div></section></div></div></div>';
  playHomeEntrance(document.getElementById("grid"));
}
`;

let browser, server, url;
before(async function() {
  browser = await chromium.launch({ headless: true });
  server = http.createServer((req, res) => { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><body></body>"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = "http://127.0.0.1:" + server.address().port + "/";
});
after(async function() { if (browser) await browser.close(); if (server) server.close(); });

async function page(reduced) {
  const p = await browser.newPage();
  if (reduced) await p.emulateMedia({ reducedMotion: "reduce" });
  await p.goto(url);
  await p.addStyleTag({ content: css });
  await p.addScriptTag({ content: harness });
  return p;
}
const look = (p) => p.evaluate(function() {
  const bar = document.querySelector(".dash-meter-track i");
  const arc = document.querySelector(".goal-ring-arc");
  return {
    bar: new DOMMatrix(getComputedStyle(bar).transform).a,
    offset: parseFloat(getComputedStyle(arc).strokeDashoffset),
    num: document.querySelector(".dash-tile-num").textContent,
    ring: document.querySelector(".goal-ring text").textContent,
    dot: new DOMMatrix(getComputedStyle(document.querySelector(".dash-week-dot.is-done")).transform).a,
    sparks: document.querySelectorAll(".goal-spark i").length,
  };
});

test("the stats start empty and settle on their real values", async function() {
  const p = await page(false);
  await p.evaluate(() => mount(6, 20));
  await p.waitForTimeout(60);
  const early = await look(p);
  assert.ok(early.bar < 0.5, JSON.stringify(early));
  assert.ok(early.offset > 120, JSON.stringify(early));
  assert.ok(Number(early.num) < 42, JSON.stringify(early));
  assert.ok(early.dot < 1, JSON.stringify(early));

  await p.waitForTimeout(1100);
  const end = await look(p);
  assert.equal(end.bar.toFixed(3), "0.800");
  assert.equal(end.offset.toFixed(1), (2 * Math.PI * 22 * (1 - 6 / 20)).toFixed(1));
  assert.equal(end.num, "42");
  assert.equal(end.ring, "6");
  assert.equal(end.dot, 1);
  assert.equal(end.sparks, 0, "no burst while the goal is unmet");
  await p.close();
});

test("a met goal sparks once a day, not on every visit", async function() {
  const p = await page(false);
  await p.evaluate(() => { localStorage.clear(); mount(20, 20); });
  assert.equal((await look(p)).sparks, 8);
  await p.waitForTimeout(1300);
  assert.equal((await look(p)).sparks, 0, "the burst cleans up after itself");
  await p.evaluate(() => mount(25, 20));
  assert.equal((await look(p)).sparks, 0);
  await p.close();
});

test("reduced motion shows the end state at once, with no burst and a still flame", async function() {
  const p = await page(true);
  await p.evaluate(() => { localStorage.clear(); mount(20, 20); });
  const now = await look(p);
  assert.equal(now.bar.toFixed(3), "0.800");
  assert.equal(now.offset, 0);
  assert.equal(now.num, "42");
  assert.equal(now.sparks, 0);
  assert.deepEqual(await p.evaluate(() => document.getAnimations().map((a) => a.animationName || a.transitionProperty)), []);
  await p.close();
});

test("only a fresh Home plays it, and a pressed class card sinks onto its ledge", function() {
  assert.match(fn("renderHomeCharts"), /grid\.innerHTML = streakTimeHeroCard[\s\S]*playHomeEntrance\(grid\);\n(    .*\n)*  \}\)\.catch/);
  assert.ok(!fn("_refreshDashHeroCards").includes("playHomeEntrance"), "a settings change does not replay the show");
  assert.match(css, /:root \.class-card:active \{ transform: translateY\(3px\); box-shadow: 0 1px 0 var\(--ledge\);/);
  assert.match(fn("heroStreakTile"), /is-streak' \+ \(streak > 0 \? ' is-lit' : ''\)/);
});
