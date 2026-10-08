"use strict";
// Load balancing and easy days: a review lands on the quietest day in its fuzz range, a
// light day is chosen only when the others are fuller, and nothing moves when it is off.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");
const express = require("express");

const root = path.join(__dirname, "..");
const W = require(path.join(root, "server/lib/workload.js"));
const DAY = 86400;

test("fuzz ranges follow Anki's: none under 2.5 days, about ±15% short, ±5% past 20, capped at the maximum", function() {
  assert.equal(W.fuzzRange(2, 365), null);
  assert.deepEqual(W.fuzzRange(3, 365), { lo: 2, hi: 4 });
  assert.deepEqual(W.fuzzRange(20, 365), { lo: 17, hi: 23 });
  assert.deepEqual(W.fuzzRange(100, 365), { lo: 93, hi: 107 });
  assert.deepEqual(W.fuzzRange(365, 365), { lo: 345, hi: 365 });
});

test("local days and weekdays follow the user's offset", function() {
  const satNoonUtc = Date.UTC(2026, 9, 10, 12) / 1000;        // Saturday 10 Oct 2026, 12:00 UTC
  assert.equal(W.weekdayOf(W.localDay(satNoonUtc, 0)), 6);
  assert.equal(W.weekdayOf(W.localDay(satNoonUtc, -720)), 0, "UTC+12: already Sunday");
  assert.equal(W.weekdayOf(W.localDay(satNoonUtc, 780)), 5, "UTC-13: still Friday");
  assert.equal(W.normalizeTz(-420), -420);
  assert.equal(W.normalizeTz("x"), 0);
  assert.equal(W.normalizeTz(5000), 0);
});

test("settings default to on with no easy days, and junk levels read as normal", function() {
  assert.deepEqual(W.settingsFrom({}), { enabled: true, easyDays: [0, 0, 0, 0, 0, 0, 0] });
  assert.equal(W.settingsFrom({ loadBalance: false }).enabled, false);
  assert.deepEqual(W.settingsFrom({ easyDays: [2, 0, 0, 7, "1", 0, 1] }).easyDays, [2, 0, 0, 0, 0, 0, 1]);
});

const now = Date.UTC(2026, 9, 8, 9) / 1000;  // Thursday 8 Oct 2026, 09:00 UTC
const exact = now + 10 * DAY;                // a 10-day interval: range 8..12 days
const off = (t) => Math.round((t - now) / DAY);
const due = (dayOffset, n) => Array(n).fill(now + dayOffset * DAY + 3600);
const normal = W.settingsFrom({});

test("a review moves to the quietest day in its range, keeping its time of day", function() {
  assert.deepEqual(W.fuzzRange(10, 365), { lo: 8, hi: 12 });
  const dueTimes = [...due(8, 6), ...due(9, 5), ...due(10, 30), ...due(11, 2), ...due(12, 4)];
  const got = W.balanceDue({ now, dueAt: exact, maxInterval: 365, tzOffset: 0, settings: normal, dueTimes });
  assert.equal(off(got), 11);
  assert.equal((got - exact) % DAY, 0);
});

test("on equal days it stays on the exact interval, and with balancing off it never moves", function() {
  assert.equal(W.balanceDue({ now, dueAt: exact, maxInterval: 365, tzOffset: 0, settings: normal, dueTimes: [] }), exact);
  const dueTimes = due(10, 50);
  assert.equal(W.balanceDue({ now, dueAt: exact, maxInterval: 365, tzOffset: 0, settings: { ...normal, enabled: false }, dueTimes }), exact);
});

test("a light day takes a card only when the other days are more than twice as full", function() {
  // Days 8..12 from Thursday 8 Oct are Fri 16, Sat 17, Sun 18, Mon 19, Tue 20.
  const weekendLight = W.settingsFrom({ easyDays: [1, 0, 0, 0, 0, 0, 1] });
  const pick = (sat, sun, mon) => off(W.balanceDue({ now, dueAt: exact, maxInterval: 365, tzOffset: 0,
    settings: weekendLight, dueTimes: [...due(8, 20), ...due(9, sat), ...due(10, sun), ...due(11, mon), ...due(12, 20)] }));
  assert.equal(pick(5, 5, 8), 11, "Monday at 8 beats a light Saturday at 5");
  assert.equal(pick(2, 5, 8), 9, "a light Saturday at 2 counts as 6, below Monday's 9");
  const sundayMinimum = W.settingsFrom({ easyDays: [2, 0, 0, 0, 0, 0, 0] });
  assert.notEqual(off(W.balanceDue({ now, dueAt: exact, maxInterval: 365, tzOffset: 0, settings: sundayMinimum,
    dueTimes: [...due(8, 12), ...due(9, 12), ...due(11, 12), ...due(12, 12)] })), 10, "an empty Minimum Sunday still loses to days of 12");
});

test("short intervals and learning steps are left exactly where FSRS put them", function() {
  const twoDays = now + 2 * DAY;
  assert.equal(W.balanceDue({ now, dueAt: twoDays, maxInterval: 365, tzOffset: 0, settings: normal, dueTimes: due(2, 40) }), twoDays);
});

// --- The attempts route, on the real schema in memory ---
const dbFile = path.join(root, "server", "db.js");
const realLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent && parent.filename === dbFile) {
    if (request === "node-sqlite3-wasm") {
      const { Database } = realLoad.call(this, request, parent, isMain);
      return { Database: class extends Database { constructor() { super(); } } };
    }
    if (request === "fs") return { ...fs, rmSync() {}, mkdirSync() {}, existsSync: () => true };
  }
  return realLoad.call(this, request, parent, isMain);
};
const db = require(dbFile);
Module._load = realLoad;
const authFile = require.resolve(path.join(root, "server/middleware/auth.js"));
require.cache[authFile] = { id: authFile, filename: authFile, loaded: true,
  exports: { requireAuth(req, res, next) { req.session = { userId: req.get("x-user") }; next(); } } };
const server = express();
server.use(express.json());
server.use("/api/attempts", require(path.join(root, "server/routes/attempts.js")));
server.use("/api/stats", require(path.join(root, "server/routes/stats.js")));

let base, listener;
test.before(() => new Promise((ok) => { listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); }); }));
test.after(() => listener.close());

db.exec(`
  INSERT INTO users (id, email, name) VALUES ('u1', 'a@x', 'A');
  INSERT INTO classes (id, user_id, name) VALUES ('k1', 'u1', 'Stats');
  INSERT INTO lessons (id, class_id, title, format) VALUES ('l1', 'k1', 'Ch 1', 'term-def');
`);
for (let i = 0; i < 80; i++)
  db.prepare("INSERT INTO cards (id, lesson_id, format, data) VALUES (?, 'l1', 'term-def', '{\"term\":\"t\",\"def\":\"d\"}')").run("c" + i);

function reviewCard(id, stability) {
  const t = Math.floor(Date.now() / 1000);
  db.prepare("DELETE FROM card_states WHERE card_id = ?").run(id);
  db.prepare(
    "INSERT INTO card_states (card_id, user_id, srs_due_at, fsrs_stability, fsrs_difficulty, fsrs_state, fsrs_reps, fsrs_lapses, fsrs_learning_steps, fsrs_last_review_at) " +
    "VALUES (?, 'u1', ?, ?, 5, 2, 5, 0, 0, ?)"
  ).run(id, t - 60, stability, t - Math.round(stability * DAY));
}

async function answer(id, body = {}) {
  const r = await fetch(base + "/api/attempts", { method: "POST", headers: { "content-type": "application/json", "x-user": "u1" },
    body: JSON.stringify({ cardId: id, correct: true, source: "flashcard", grade: "medium", ...body }) });
  return r.json();
}

test("the route moves an answer off a crowded day, and leaves it with balancing off", async function() {
  db.prepare("UPDATE users SET preferences = ? WHERE id = 'u1'").run(JSON.stringify({ loadBalance: false }));
  reviewCard("c0", 10);
  const exactDue = (await answer("c0")).srs_due_at;
  const t = Math.floor(Date.now() / 1000);
  const exactDays = Math.round((exactDue - t) / DAY);
  assert.ok(exactDays >= 5, "a 10-day stability gives a review interval: " + exactDays);

  // Crowd the exact day with 60 other cards, then answer the same card again from the same state.
  for (let i = 1; i <= 60; i++)
    db.prepare("INSERT OR REPLACE INTO card_states (card_id, user_id, srs_due_at) VALUES (?, 'u1', ?)").run("c" + i, exactDue);
  db.prepare("UPDATE users SET preferences = ? WHERE id = 'u1'").run(JSON.stringify({}));
  reviewCard("c0", 10);
  const balanced = (await answer("c0", { tz: 0 })).srs_due_at;
  assert.notEqual(Math.round((balanced - exactDue) / DAY), 0, "moved off the day holding 60 reviews");
  assert.ok(Math.abs(balanced - exactDue) <= 3 * DAY);
});

test("the forecast groups by the user's local day when given tz", async function() {
  db.prepare("INSERT OR REPLACE INTO card_states (card_id, user_id, srs_due_at) VALUES ('c70', 'u1', ?)").run(Math.floor(Date.now() / 1000) + 3 * DAY);
  const get = async (q) => (await (await fetch(base + "/api/stats/future-due" + q, { headers: { "x-user": "u1" } })).json()).days;
  const utc = await get("");
  const shifted = await get("?tz=-840");
  assert.equal(utc.reduce((s, r) => s + r.cnt, 0), shifted.reduce((s, r) => s + r.cnt, 0));
  assert.ok(utc.length > 0);
});

// --- Client ---
const appJs = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
function extract(name) {
  const start = appJs.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return appJs.slice(start, appJs.indexOf("\n}\n", start) + 3);
}

test("the forecast lays 14 local days out from today with each day's level", function() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(extract("workloadBars"), ctx);
  const today = new Date(2026, 9, 8);
  const bars = ctx.workloadBars([{ day: "2026-10-08", cnt: 4 }, { day: "2026-10-10", cnt: 9 }], [2, 0, 0, 0, 0, 0, 1], today);
  assert.equal(bars.length, 14);
  assert.equal(JSON.stringify(bars.slice(0, 4).map(b => [b.n, b.level])), "[[4,0],[0,0],[9,1],[0,2]]");
});

test("settings are saved, loaded, sent with every answer, and server-only", function() {
  assert.match(appJs, /prefs\.loadBalance = document\.getElementById\("pref-load-balance"\)\.checked;\s*prefs\.easyDays = easyDaysDraft\.slice\(\);/);
  assert.match(appJs, /typeof prefs\.loadBalance === "boolean"/);
  assert.match(appJs, /body\.tz = new Date\(\)\.getTimezoneOffset\(\);/);
  assert.match(appJs, /"setup-filter-leeches", "pref-workload"/);
  assert.match(indexHtml, /id="pref-load-balance"/);
  for (const k of ["pref.loadBalance", "pref.loadBalanceHint", "pref.easyDays", "pref.easyDaysHint", "pref.easyNormal",
                   "pref.easyLight", "pref.easyMinimum", "pref.easyDayLabel", "pref.forecastTitle", "pref.forecastBar"]) {
    assert.equal(appJs.split('"' + k + '":').length - 1, 2, k);
  }
});

test("on a 320px phone the seven day chips and the forecast fit the Preferences dialog", async function() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 640 }, isMobile: true });
    await page.route("**/*.js", (r) => r.abort());
    await page.goto("file://" + path.join(root, "client", "index.html"));
    await page.addStyleTag({ path: path.join(root, "client", "style.css") });
    const r = await page.evaluate(function() {
      document.getElementById("modal-overlay").classList.remove("hidden");
      document.getElementById("modal-preferences").classList.remove("hidden");
      document.getElementById("modal-preferences").dataset.page = "plan";
      document.getElementById("pref-easy-days").innerHTML = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(function(d, i) {
        return '<button type="button" class="easy-day level-' + (i > 4 ? 2 : 0) + '">' + d + "<small>" + (i > 4 ? "Tối thiểu" : "Normal") + "</small></button>";
      }).join("");
      document.getElementById("pref-forecast-bars").innerHTML = Array(14).fill('<span class="workload-bar" style="height:50%"></span>').join("");
      document.getElementById("pref-easy-days").scrollIntoView();
      const box = document.getElementById("modal-preferences").getBoundingClientRect();
      const chips = Array.from(document.querySelectorAll(".easy-day")).map(b => b.getBoundingClientRect());
      const bars = document.getElementById("pref-forecast-bars");
      return { left: box.left, right: box.right, chips: chips.map(c => [c.left, c.right, c.top]), barsW: bars.scrollWidth, barsCw: bars.clientWidth };
    });
    for (const [l, rr] of r.chips) assert.ok(l >= r.left && rr <= r.right, JSON.stringify(r));
    assert.equal(new Set(r.chips.map(c => Math.round(c[2]))).size, 1, "one row of seven");
    assert.ok(r.barsW <= r.barsCw + 1);
  } finally {
    await browser.close();
  }
});
