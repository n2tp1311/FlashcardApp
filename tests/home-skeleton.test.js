const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

// Home's stats card keeps its place while loading. It used to be emptied on every load and
// filled when the data came, so the class list under it jumped down each time Home opened.
// app.js's own renderHomeCharts, under the real stylesheet, with the network held open.
const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
function fn(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}

const harness = `
var IS_SERVER = true, state = {};
function t(k) { return k; }
function escHtml(s) { return String(s); }
function dueTotal() { return 0; }
function playHomeEntrance() {}
var height = 300;
function streakTimeHeroCard() { return '<div class="dash-hero-card" style="height:' + height + 'px">card ' + height + '</div>'; }
var pending;
var store = {
  getNewCardEstimate: function() { return Promise.resolve(null); },
  getDashboard: function() { return new Promise(function(ok, fail) { pending = { ok: ok, fail: fail }; }); }
};
document.body.innerHTML = '<div id="home-charts-section" class="hidden"><div class="dash-summary-grid" id="home-summary-grid"></div></div><div id="class-list">classes</div>';
${fn("homeHeroHeightKey")}${fn("homeHeroSkeleton")}${fn("renderHomeCharts")}
function look() {
  var g = document.getElementById("home-summary-grid");
  return { list: Math.round(document.getElementById("class-list").getBoundingClientRect().top),
    skeleton: !!g.querySelector(".is-skeleton"), text: g.textContent,
    hidden: document.getElementById("home-charts-section").classList.contains("hidden") };
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

async function page() {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto(url);
  await p.addStyleTag({ path: path.join(root, "client", "style.css") });
  await p.addScriptTag({ content: harness });
  return p;
}
const tick = (p) => p.evaluate(() => new Promise((r) => setTimeout(r, 20)));

test("a first load holds the card's last height, so the class list does not move when it arrives", async function() {
  const p = await page();
  await p.evaluate(() => { localStorage.clear(); renderHomeCharts(); });
  let r = await p.evaluate(() => look());
  assert.equal(r.skeleton, true);
  assert.equal(r.hidden, false);
  await p.evaluate(() => pending.ok({ dueForReview: [] }));
  await tick(p);
  const loaded = await p.evaluate(() => look());
  assert.equal(loaded.text, "card 300");
  assert.equal(await p.evaluate(() => localStorage.getItem(homeHeroHeightKey())), "300");

  // The next launch: the placeholder stands where the card will.
  await p.evaluate(() => { document.getElementById("home-summary-grid").innerHTML = ""; renderHomeCharts(); });
  r = await p.evaluate(() => look());
  assert.equal(r.skeleton, true);
  assert.equal(r.list, loaded.list);
  await p.evaluate(() => pending.ok({ dueForReview: [] }));
  await tick(p);
  assert.equal((await p.evaluate(() => look())).list, loaded.list);
  await p.close();
});

test("a refresh keeps the last card up until the new one replaces it", async function() {
  const p = await page();
  await p.evaluate(() => renderHomeCharts());
  await p.evaluate(() => pending.ok({ dueForReview: [] }));
  await tick(p);
  await p.evaluate(() => { height = 320; renderHomeCharts(); });
  let r = await p.evaluate(() => look());
  assert.equal(r.text, "card 300", "no blank and no placeholder while it reloads");
  await p.evaluate(() => pending.ok({ dueForReview: [] }));
  await tick(p);
  assert.equal((await p.evaluate(() => look())).text, "card 320");

  // A failed refresh leaves the card; a failed first load leaves nothing behind.
  await p.evaluate(() => renderHomeCharts());
  await p.evaluate(() => pending.fail(new Error("offline")));
  await tick(p);
  assert.equal((await p.evaluate(() => look())).text, "card 320");
  await p.evaluate(() => { document.getElementById("home-summary-grid").innerHTML = ""; renderHomeCharts(); });
  await p.evaluate(() => pending.fail(new Error("offline")));
  await tick(p);
  r = await p.evaluate(() => look());
  assert.equal(r.skeleton, false);
  assert.equal(r.hidden, true);
  await p.close();
});

test("signing out empties the card, so the next account never sees this one's numbers", function() {
  assert.match(fn("showAuthScreen"), /document\.getElementById\("home-summary-grid"\)\.innerHTML = "";/);
});
