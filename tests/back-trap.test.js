const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

// app.js's Back trap, run in a real browser history: an entry behind the current one only
// while there is somewhere in-app to go back to. Home used to keep one forever, which gave
// iOS's edge-swipe-back something to swipe to, and it showed a white screen.
const app = fs.readFileSync(path.join(__dirname, "..", "client", "app.js"), "utf8");
const map = app.slice(app.indexOf("var SCREEN_BACK_BTN = {"), app.indexOf("};", app.indexOf("var SCREEN_BACK_BTN = {")) + 2);
const start = app.indexOf("var backTrap = ");
const trap = app.slice(start, app.indexOf("\nsyncBackTrap();\n", start) + "\nsyncBackTrap();\n".length);

// Stand-ins for the screens and dialogs: the back button of a screen goes to its parent,
// as the app's do.
const harness = `
var screen = "home", overlay = false, parent = { class: "home", lesson: "class" };
function getActiveScreen() { return screen; }
function fcAnyOverlayOpen() { return overlay; }
function fcCloseTopModal() { overlay = false; syncBackTrap(); }
function confirmLeaveStudy(go) { go(); }
function showScreen(id) { screen = id; syncBackTrap(); }
function openOverlay() { overlay = true; syncBackTrap(); }
document.body.innerHTML = '<button id="btn-class-back"></button><button id="btn-lesson-back"></button>';
document.getElementById("btn-class-back").onclick = function() { showScreen("home"); };
document.getElementById("btn-lesson-back").onclick = function() { showScreen("class"); };
${map}
${trap}
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
  const p = await browser.newPage();
  await p.goto(url);
  await p.addScriptTag({ content: harness });
  return p;
}
const settle = (p) => p.waitForTimeout(150);
const where = (p) => p.evaluate(() => ({ index: navigation.currentEntry.index, screen, overlay, armed: backTrap.armed }));

test("Home has nothing behind it, so iOS has no page to swipe back to", async function() {
  const p = await page();
  await settle(p);
  assert.deepEqual(await where(p), { index: 0, screen: "home", overlay: false, armed: false });
  await p.close();
});

test("a screen with a Back button gets the entry; Back takes it and returns Home with nothing behind", async function() {
  const p = await page();
  await p.evaluate(() => showScreen("class"));
  await settle(p);
  assert.equal((await where(p)).index, 1);
  await p.evaluate(() => history.back());
  await settle(p);
  assert.deepEqual(await where(p), { index: 0, screen: "home", overlay: false, armed: false });
  await p.close();
});

test("Back from two screens deep steps one screen and keeps the trap", async function() {
  const p = await page();
  await p.evaluate(() => { showScreen("class"); showScreen("lesson"); });
  await settle(p);
  await p.evaluate(() => history.back());
  await settle(p);
  assert.deepEqual(await where(p), { index: 1, screen: "class", overlay: false, armed: true });
  await p.close();
});

test("the app's own Back button to Home removes the entry", async function() {
  const p = await page();
  await p.evaluate(() => showScreen("class"));
  await settle(p);
  await p.evaluate(() => document.getElementById("btn-class-back").click());
  await settle(p);
  assert.deepEqual(await where(p), { index: 0, screen: "home", overlay: false, armed: false });
  await p.close();
});

test("a dialog on Home is trapped while open: Back closes it, not the app", async function() {
  const p = await page();
  await p.evaluate(() => openOverlay());
  await settle(p);
  assert.equal((await where(p)).index, 1);
  await p.evaluate(() => history.back());
  await settle(p);
  assert.deepEqual(await where(p), { index: 0, screen: "home", overlay: false, armed: false });
  await p.close();
});

test("leaving and re-entering a screen quickly does not lose the entry to a late Back", async function() {
  const p = await page();
  await p.evaluate(() => { showScreen("class"); });
  await settle(p);
  await p.evaluate(() => { showScreen("home"); showScreen("class"); showScreen("home"); showScreen("class"); });
  await settle(p);
  assert.deepEqual(await where(p), { index: 1, screen: "class", overlay: false, armed: true });
  await p.close();
});

test("forward onto the old entry from Home (a swipe from the right edge) steps straight back off it", async function() {
  const p = await page();
  await p.evaluate(() => showScreen("class"));
  await settle(p);
  await p.evaluate(() => document.getElementById("btn-class-back").click());
  await settle(p);
  await p.evaluate(() => history.forward());
  await settle(p);
  assert.deepEqual(await where(p), { index: 0, screen: "home", overlay: false, armed: false });
  await p.close();
});

test("showScreen and syncInert keep the trap in step, and URL resets keep its marker", function() {
  assert.match(app, /syncSidebar\(id\);\n  syncBackTrap\(\);\n\}/);
  assert.match(app, /m\.inert = m\.id !== topId; \}\);\n  syncBackTrap\(\);\n\}/);
  assert.ok(!app.includes('history.replaceState({}, "", "/")'));
  assert.ok(!/^history\.pushState\(/m.test(app), "no entry pushed unconditionally at load");
});
