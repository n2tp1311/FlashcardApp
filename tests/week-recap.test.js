"use strict";
// Weekly recap: the sheet Home shows once a week. The route counts last week (Monday to
// Sunday, the streak's UTC days) against the week before; closing the sheet marks the week
// seen on the account.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const http = require("http");
const Module = require("module");
const express = require("express");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const dbFile = path.join(root, "server", "db.js");

// The real schema in memory, as tests/leech.test.js does: db.js must not open data/.
const realLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent && parent.filename === dbFile) {
    if (request === "node-sqlite3-wasm") {
      const { Database } = realLoad.call(this, request, parent, isMain);
      return { Database: class extends Database { constructor() { super(); } } };
    }
    if (request === "fs") return { ...fs, rmSync() {}, mkdirSync() {}, existsSync: () => true };
    if (request === "./lib/dbLock") return { claim() {}, hold() { return function() {}; } };
  }
  return realLoad.call(this, request, parent, isMain);
};
const db = require(dbFile);
Module._load = realLoad;

const auth = require.resolve(path.join(root, "server/middleware/auth.js"));
require.cache[auth] = { id: auth, filename: auth, loaded: true,
  exports: { requireAuth(req, res, next) { req.session = { userId: req.get("x-user") }; next(); } } };

const server = express();
server.use(express.json());
server.use("/api/stats", require(path.join(root, "server/routes/stats.js")));

const { weekStart, addDays } = require(path.join(root, "server/lib/streak.js"));
const today = new Date().toISOString().slice(0, 10);
const lastMon = addDays(weekStart(today), -7);
const at = (day, hour) => Date.parse(day + "T00:00:00Z") / 1000 + hour * 3600;

db.exec(`
  INSERT INTO users (id, email, name) VALUES ('u1', 'a@x', 'A'), ('u2', 'b@x', 'B'), ('u3', 'c@x', 'C');
  INSERT INTO classes (id, user_id, name) VALUES ('kA', 'u1', 'Algebra'), ('kB', 'u1', 'Biology');
  INSERT INTO lessons (id, class_id, title, format) VALUES ('lA', 'kA', 'A', 'term-def'), ('lB', 'kB', 'B', 'term-def');
  INSERT INTO cards (id, lesson_id, format, data) VALUES
    ('a1', 'lA', 'term-def', '{}'), ('a2', 'lA', 'term-def', '{}'), ('a3', 'lA', 'term-def', '{}'),
    ('b1', 'lB', 'term-def', '{}'), ('b2', 'lB', 'term-def', '{}');
`);
let n = 0;
const ans = db.prepare("INSERT INTO attempts (id, card_id, user_id, correct, source, created_at) VALUES (?, ?, ?, 1, 'flashcard', ?)");
const answer = (card, day, hour, user = "u1") => ans.run("x" + n++, card, user, at(day, hour));
// The week before last: b1 learnt, 4 answers on 2 days.
answer("b1", addDays(lastMon, -7), 9); answer("b1", addDays(lastMon, -7), 10);
answer("b1", addDays(lastMon, -5), 9); answer("b1", addDays(lastMon, -5), 10);
// Last week: Monday, Tuesday and Sunday; a1 a2 a3 new in Algebra, b1 reviewed, b2 new.
answer("a1", lastMon, 8); answer("a2", lastMon, 9); answer("a1", lastMon, 23.9);
answer("a3", addDays(lastMon, 1), 12); answer("b1", addDays(lastMon, 1), 13);
answer("b2", addDays(lastMon, 6), 23.5);
// This week does not count.
answer("a1", weekStart(today), 1);
// u3 studied only the week before last.
answer("a1", addDays(lastMon, -3), 9, "u3");

let base, listener;
test.before(() => new Promise((ok) => { listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); }); }));
test.after(() => listener.close());
const call = async (method, p, body, user = "u1") => {
  const r = await fetch(base + "/api/stats" + p, { method, headers: { "content-type": "application/json", "x-user": user }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

test("last week's days, answers and new cards against the week before, and the most studied class", async () => {
  const r = (await call("GET", "/week-recap")).body;
  assert.equal(r.week, lastMon);
  assert.deepEqual(r.days, [true, true, false, false, false, false, true]);
  assert.equal(r.studyDays, 3);
  assert.equal(r.answers, 6);
  assert.equal(r.newCards, 4, "a1 a2 a3 b2; b1 was learnt the week before");
  assert.deepEqual(r.prev, { studyDays: 2, answers: 4, newCards: 1 });
  assert.deepEqual(r.topClass, { id: "kA", name: "Algebra", answers: 4, newCards: 3 });
  assert.equal(r.seen, false);
});

test("a week with no study, and another user's week, come back empty", async () => {
  const r = (await call("GET", "/week-recap", undefined, "u2")).body;
  assert.equal(r.studyDays, 0);
  assert.equal(r.topClass, null);
  const r3 = (await call("GET", "/week-recap", undefined, "u3")).body;
  assert.equal(r3.studyDays, 0);
  assert.equal(r3.prev.studyDays, 1);
});

test("marking the week seen is stored with the account and keeps the other preferences", async () => {
  db.prepare("UPDATE users SET preferences = ? WHERE id = 'u1'").run(JSON.stringify({ theme: "dark" }));
  assert.equal((await call("POST", "/week-recap/seen", { week: "nope" })).status, 400);
  assert.equal((await call("POST", "/week-recap/seen", {})).status, 400);
  assert.equal((await call("POST", "/week-recap/seen", { week: lastMon })).status, 200);
  assert.equal((await call("GET", "/week-recap")).body.seen, true);
  assert.equal((await call("GET", "/week-recap", undefined, "u2")).body.seen, false);
  assert.deepEqual(JSON.parse(db.prepare("SELECT preferences FROM users WHERE id = 'u1'").get().preferences), { theme: "dark", weekRecapSeen: lastMon });
});

// The sheet, with app.js's own functions under the real stylesheet and index.html's markup.
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
function fn(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}
const enStart = app.indexOf('  "recap.title"'), enEnd = app.indexOf('  "recap.start"', enStart);
const strings = eval("({" + app.slice(enStart, app.indexOf("\n", enEnd)) + "})");
const modalStart = indexHtml.indexOf('<div id="modal-week-recap"');
const modal = indexHtml.slice(modalStart, indexHtml.indexOf("\n  </div>\n", modalStart) + 9);
const harness = `
var IS_SERVER = true, state = { language: "en" }, modalStack = [], screen = "home", seen = [], recap;
var STRINGS = ${JSON.stringify(Object.assign({ "week.done": "Studied", "week.missed": "Missed" }, strings))};
function t(k, p) { var s = p && p.n === 1 && STRINGS[k + "_one"] ? STRINGS[k + "_one"] : (STRINGS[k] || k); Object.keys(p || {}).forEach(function(n) { s = s.split("{" + n + "}").join(p[n]); }); return s; }
function escHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
function getActiveScreen() { return screen; }
function openModal(id) { modalStack.push({ id: id }); document.getElementById("modal-overlay").classList.remove("hidden"); document.getElementById("modal-" + id).classList.remove("hidden"); }
function closeModal(id) {
  var modal = document.getElementById("modal-" + id);
  if (id === "week-recap" && !modal.classList.contains("hidden") && state.weekRecapWeek) {
    store.markWeekRecapSeen(state.weekRecapWeek).catch(function() {});
  }
  modal.classList.add("hidden"); modalStack.pop(); document.getElementById("modal-overlay").classList.add("hidden");
}
var store = { getWeekRecap: function() { return Promise.resolve(recap); }, markWeekRecapSeen: function(w) { seen.push(w); return Promise.resolve(); } };
document.body.innerHTML = '<div id="modal-overlay" class="modal-overlay hidden">' + ${JSON.stringify(modal)} + '</div>';
document.querySelector("[data-modal]").addEventListener("click", function() { closeModal("week-recap"); });
${fn("weekdayLabel")}${fn("weekRecapDelta")}${fn("weekRecapHtml")}${fn("maybeShowWeekRecap")}
`;

let browser, page_server, url;
test.before(async () => {
  browser = await chromium.launch({ headless: true });
  page_server = http.createServer((q, s) => { s.setHeader("Content-Type", "text/html"); s.end("<!doctype html><body></body>"); });
  await new Promise((r) => page_server.listen(0, "127.0.0.1", r));
  url = "http://127.0.0.1:" + page_server.address().port + "/";
});
test.after(async () => { if (browser) await browser.close(); if (page_server) page_server.close(); });

const sample = { week: "2026-10-05", days: [true, true, true, false, true, true, false], studyDays: 5, answers: 412, newCards: 63,
  prev: { studyDays: 4, answers: 349, newCards: 72 }, topClass: { id: "k", name: "<b>ML</b>", answers: 180, newCards: 30 }, seen: false };

async function page(width) {
  const p = await browser.newPage({ viewport: { width, height: 800 } });
  await p.goto(url);
  await p.addStyleTag({ path: path.join(root, "client", "style.css") });
  await p.addScriptTag({ content: harness });
  return p;
}
const settle = (p) => p.evaluate(() => new Promise((r) => setTimeout(r, 400)));

test("the sheet: the numbers, rises in green, falls in grey, and once per load", async () => {
  const p = await page(390);
  await p.evaluate((r) => { recap = r; maybeShowWeekRecap(); }, sample);
  await settle(p);
  const text = await p.evaluate(() => document.getElementById("week-recap-body").innerText.replace(/\s+/g, " ").trim());
  assert.match(text, /^Last week you studied 5 days Mon ✓ Tue ✓ Wed ✓ Thu Fri ✓ Sat ✓ Sun 5\/7 days studied \+1 412 answers \+18% 63 new cards −9 Against the week before\. Most studied: <b>ML<\/b> 180 answers · 30 new cards$/);
  const box = await p.evaluate(() => { const r = document.getElementById("modal-week-recap").getBoundingClientRect(); return { left: r.left, right: r.right, bottom: Math.round(r.bottom) }; });
  assert.deepEqual(box, { left: 0, right: 390, bottom: 800 }, "a sheet from the bottom edge on a phone");
  const colours = await p.evaluate(() => [...document.querySelectorAll(".recap-delta")].map((e) => e.classList.contains("is-up")));
  assert.deepEqual(colours, [true, true, false]);

  await p.click("#modal-week-recap [data-modal]");
  assert.deepEqual(await p.evaluate(() => seen), ["2026-10-05"]);
  await p.evaluate(() => maybeShowWeekRecap());
  await settle(p);
  assert.equal(await p.evaluate(() => document.getElementById("modal-week-recap").classList.contains("hidden")), true);
  await p.close();
});

test("not shown when seen, after an empty week, off Home or over another dialog; centred on a wide screen", async () => {
  const p = await page(1200);
  for (const [setup, why] of [
    ["recap = Object.assign({}, SAMPLE, { seen: true })", "seen"],
    ["recap = Object.assign({}, SAMPLE, { studyDays: 0 })", "empty week"],
    ["recap = SAMPLE; screen = 'flashcard'", "mid-study"],
    ["recap = SAMPLE; screen = 'home'; modalStack = [{ id: 'tutorial' }]", "over the tutorial"],
  ]) {
    await p.evaluate(`SAMPLE = ${JSON.stringify(sample)}; state.weekRecapChecked = false; ${setup}; maybeShowWeekRecap();`);
    await settle(p);
    assert.equal(await p.evaluate(() => document.getElementById("modal-week-recap").classList.contains("hidden")), true, why);
  }
  await p.evaluate(`modalStack = []; state.weekRecapChecked = false; recap = SAMPLE; maybeShowWeekRecap();`);
  await settle(p);
  const box = await p.evaluate(() => { const r = document.getElementById("modal-week-recap").getBoundingClientRect(); return { w: Math.round(r.width), centre: Math.round(r.left + r.width / 2), bottom: r.bottom < 800 }; });
  assert.deepEqual(box, { w: 420, centre: 600, bottom: true });
  await p.close();
});

test("wiring: Home asks after its card lands, and closeModal marks the week seen", () => {
  assert.match(fn("renderHomeCharts"), /playHomeEntrance\(grid\);\n    maybeShowWeekRecap\(\);/);
  assert.match(fn("closeModal"), /if \(id === "week-recap" && !modal\.classList\.contains\("hidden"\) && state\.weekRecapWeek\) \{\n    store\.markWeekRecapSeen\(state\.weekRecapWeek\)/);
  assert.match(app, /getWeekRecap: function\(\) \{ return req\("GET", "\/stats\/week-recap"\); \}/);
  const vi = app.slice(app.indexOf('"recap.title": "Tuần trước'));
  assert.ok(vi.includes('"recap.start": "Bắt đầu tuần mới"'));
});
