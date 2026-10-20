"use strict";
// Session complete, beyond the streak and goal lines: the best new medal as a card, lessons
// the session finished, a new daily record, and the medal closest to coming. At most three.
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

const now = Math.floor(Date.now() / 1000);
const DAY = 86400;
db.exec(`
  INSERT INTO users (id, email, name) VALUES ('u1', 'a@x', 'A'), ('u2', 'b@x', 'B');
  INSERT INTO classes (id, user_id, name) VALUES ('k1', 'u1', 'Mine'), ('k2', 'u2', 'Theirs');
  INSERT INTO lessons (id, class_id, title, format) VALUES ('l1', 'k1', 'Done', 'term-def'), ('l2', 'k1', 'Open', 'term-def'), ('lX', 'k2', 'X', 'term-def');
  INSERT INTO cards (id, lesson_id, format, data) VALUES
    ('d1', 'l1', 'term-def', '{}'), ('d2', 'l1', 'term-def', '{}'),
    ('o1', 'l2', 'term-def', '{}'), ('o2', 'l2', 'term-def', '{}'),
    ('x1', 'lX', 'term-def', '{}');
`);
let n = 0;
const ans = db.prepare("INSERT INTO attempts (id, card_id, user_id, correct, source, created_at) VALUES (?, ?, ?, 1, 'flashcard', ?)");
const answer = (card, at, user = "u1") => ans.run("a" + n++, card, user, at);
answer("d1", now - 3 * DAY); answer("d2", now - 60); answer("o1", now - 60); answer("x1", now - 60, "u2");
// Earlier days for the record: 5 answers three days ago is the best, 2 the day before.
for (let i = 0; i < 4; i++) answer("o1", now - 3 * DAY + i);
answer("o1", now - 2 * DAY); answer("o1", now - 2 * DAY + 1);

let base, listener;
test.before(() => new Promise((ok) => { listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); }); }));
test.after(() => listener.close());
const call = async (method, p, body, user = "u1") => {
  const r = await fetch(base + "/api/stats" + p, { method, headers: { "content-type": "application/json", "x-user": user }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

test("lessons-done: lessons of the given cards with every card answered, own lessons only", async () => {
  assert.deepEqual((await call("POST", "/lessons-done", { newIds: ["d2", "o1"] })).body, { lessons: [{ id: "l1", title: "Done", cards: 2 }] });
  assert.deepEqual((await call("POST", "/lessons-done", { newIds: ["x1"] })).body, { lessons: [] }, "another user's lesson");
  assert.deepEqual((await call("POST", "/lessons-done", { newIds: [] })).body, { lessons: [] });
  assert.equal((await call("POST", "/lessons-done", { newIds: "d2" })).status, 400);
  assert.equal((await call("POST", "/lessons-done", { newIds: [1] })).status, 400);
  assert.equal((await call("POST", "/lessons-done", { newIds: Array(2001).fill("d1") })).status, 400);
});

test("/today carries the busiest earlier day, today left out", async () => {
  const day = new Date((now - 3 * DAY) * 1000).toISOString().slice(0, 10);
  assert.deepEqual((await call("GET", "/today")).body.bestDay, { day, count: 5 });
  db.exec("INSERT INTO users (id, email, name) VALUES ('u3', 'c@x', 'C')");
  assert.equal((await call("GET", "/today", undefined, "u3")).body.bestDay, null);
});

// The client side: app.js's own functions under the real stylesheet.
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
function fn(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}
function v(name) {
  const start = app.indexOf("\nvar " + name + " = ");
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf(";\n", start) + 2);
}
function block(name) {
  const start = app.indexOf("\nvar " + name + " = ");
  return app.slice(start, app.indexOf("\n};\n", start) + 4);
}
const harness = `
var state = { language: "en" };
function t(k, p) { return k + (p ? "|" + Object.keys(p).map(function(x) { return x + "=" + p[x]; }).join(",") : ""); }
function escHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
${block("ACH_ICONS")}${block("ACH_ICON_PATHS")}${block("ACH_UNITS")}
${v("RECORD_MIN_ANSWERS")}${v("NEAR_MIN_PROGRESS")}${v("SESSION_EXTRAS_MAX")}${v("SESSION_SPARKS")}
${["appLocale", "achIcon", "achMedalTier", "achThresholdLabel", "achTierName", "achDate", "achCountText", "achProgressText", "achNextUp", "achEarnedLineText", "sessionExtras", "sessionExtraHtml"].map(fn).join("")}
function item(o) { return Object.assign({ key: "writer", tiers: [100, 500, 2000], value: 0, tier: 0, next: 100, progress: 0, show: { cur: 0, target: 100 }, earnedAt: null, lost: false }, o); }
function show(xs) { document.body.innerHTML = '<div class="session-cheers" style="width:340px">' + xs.map(sessionExtraHtml).join("") + '</div>'; }
`;

let browser, pageServer, url;
test.before(async () => {
  browser = await chromium.launch({ headless: true });
  pageServer = http.createServer((q, s) => { s.setHeader("Content-Type", "text/html"); s.end("<!doctype html><body></body>"); });
  await new Promise((r) => pageServer.listen(0, "127.0.0.1", r));
  url = "http://127.0.0.1:" + pageServer.address().port + "/";
});
test.after(async () => { if (browser) await browser.close(); if (pageServer) pageServer.close(); });
async function page(reduced) {
  const p = await browser.newPage({ viewport: { width: 390, height: 800 } });
  if (reduced) await p.emulateMedia({ reducedMotion: "reduce" });
  await p.goto(url);
  await p.addStyleTag({ path: path.join(root, "client", "style.css") });
  await p.addScriptTag({ content: harness });
  return p;
}

test("which extras, in what order, and never more than three", async () => {
  const p = await page(false);
  const kinds = (code) => p.evaluate(`sessionExtras(${code}).map(function(x) { return x.kind + (x.item ? ":" + x.item.key : ""); })`);
  const silver = `item({ key: "writer", tier: 2, value: 520, next: 2000 })`, bronze = `item({ key: "builder", tier: 1, value: 100, next: 500 })`;
  // The highest medal is the card, whatever order they came in; the rest are lines after it.
  assert.deepEqual(await kinds(`[${bronze}, ${silver}], null, null, null, null, []`), ["badge:writer", "medal:builder"]);
  // A record: today crossed the old best, which was worth beating.
  const today = (before, after, best) => `{ count: ${before} }, { count: ${after}, bestDay: ${best === null ? "null" : `{ day: "2026-09-02", count: ${best} }`} }`;
  assert.deepEqual(await kinds(`[], null, ${today(70, 86, 71)}, null, []`), ["record"]);
  assert.deepEqual(await kinds(`[], null, ${today(72, 86, 71)}, null, []`), [], "already past it before this session");
  assert.deepEqual(await kinds(`[], null, ${today(10, 18, 15)}, null, []`), [], "a best under 20 is not a record yet");
  assert.deepEqual(await kinds(`[], null, ${today(0, 5, null)}, null, []`), []);
  // Almost there only without a new medal, and only from 80%.
  const near = `item({ key: "longTermCards", tiers: [100, 500, 2000], tier: 1, value: 468, next: 500, progress: 0.936, show: { cur: 468, target: 500 } })`;
  const far = `item({ key: "builder", tier: 1, value: 300, next: 500, progress: 0.6, show: { cur: 300, target: 500 } })`;
  assert.deepEqual(await kinds(`[], null, null, null, { values: { longTermCards: 456 } }, [${near}, ${far}]`), ["near:longTermCards"]);
  assert.deepEqual(await kinds(`[], null, null, null, null, [${far}]`), []);
  assert.deepEqual(await kinds(`[${silver}], null, null, null, null, [${near}]`), ["badge:writer"]);
  assert.equal(await p.evaluate(`sessionExtras([], null, null, null, { values: { longTermCards: 456 } }, [${near}])[0].gain`), 12);
  // Everything at once: three, the card and the milestones first.
  assert.deepEqual(await kinds(`[${bronze}, ${silver}, item({ key: "cardFixer", tiers: [1, 10], tier: 1 })], [{ id: "l", title: "Ch 3", cards: 20 }], ${today(70, 86, 71)}, null, [${near}]`),
    ["badge:writer", "lessons", "record"]);
  await p.close();
});

test("how they look: a medal card that pops, milestone lines, and a progress bar", async () => {
  const p = await page(false);
  await p.evaluate(`show(sessionExtras([item({ key: "writer", tier: 2, value: 520, next: 2000 })], [{ id: "l", title: "Ch 3 <b>", cards: 20 }],
    { count: 70 }, { count: 86, bestDay: { day: "2026-09-02", count: 71 } }, null, []))`);
  const r = await p.evaluate(() => ({
    kicker: document.querySelector(".session-badge-kicker").textContent,
    name: document.querySelector(".session-badge b").textContent,
    sparks: document.querySelectorAll(".session-spark").length,
    link: !!document.querySelector(".session-badge [data-open-achievements]"),
    lines: [...document.querySelectorAll(".session-milestone b")].map((b) => b.textContent),
    subs: [...document.querySelectorAll(".session-milestone small")].map((b) => b.textContent),
    medal: document.querySelector(".session-badge .ach-medal").offsetWidth,
    anims: document.getAnimations().length,
  }));
  assert.equal(r.kicker, "done.newBadge");
  assert.equal(r.name, "ach.writer.name · ach.tier2");
  assert.equal(r.sparks, 8);
  assert.ok(r.link);
  assert.deepEqual(r.lines, ["done.lessonDone|title=Ch 3 <b>", "done.record|n=86"]);
  assert.match(r.subs[1], /^done\.recordSub\|old=71,date=/);
  assert.equal(r.medal, 64);
  assert.ok(r.anims > 0, "the medal pops");

  await p.evaluate(`show(sessionExtras([], null, null, null, { values: { longTermCards: 456 } },
    [item({ key: "longTermCards", tiers: [100, 500, 2000], tier: 1, value: 468, next: 500, progress: 0.936, show: { cur: 468, target: 500 } })]))`);
  const near = await p.evaluate(() => ({
    title: document.querySelector(".session-near b").textContent,
    sub: document.querySelector(".session-near small").textContent,
    bar: Math.round(document.querySelector(".session-near-bar i").getBoundingClientRect().width / document.querySelector(".session-near-bar").getBoundingClientRect().width * 100),
    dashed: getComputedStyle(document.querySelector(".session-near .ach-medal")).borderStyle,
  }));
  assert.equal(near.title, "done.near|name=ach.longTermCards.name");
  assert.match(near.sub, / · done\.nearGain\|n=12$/);
  assert.equal(near.bar, 94);
  assert.equal(near.dashed, "dashed", "a medal not yet earned");
  await p.close();
});

test("reduced motion: no pop and no sparks", async () => {
  const p = await page(true);
  await p.evaluate(`show(sessionExtras([item({ key: "writer", tier: 1, value: 120, next: 500 })], null, null, null, null, []))`);
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector(".session-spark")).display), "none");
  assert.deepEqual(await p.evaluate(() => document.getAnimations().map((a) => a.animationName)), []);
  await p.close();
});

test("wiring: both summaries pass the session's new cards, and the card opens Achievements", () => {
  assert.match(app, /\], gradedIds\.filter\(function\(id\) \{ return state\.studySessionNewSet\[id\]; \}\)\);/);
  assert.match(app, /\], state\.quizResults\.filter\(function\(r\) \{ return !r\.card\.last_studied_at; \}\)\.map\(function\(r\) \{ return r\.card\.id; \}\)\);/);
  assert.match(fn("renderSessionDone"), /extras\.map\(sessionExtraHtml\)/);
  assert.match(app, /if \(e\.target\.closest\("\[data-open-achievements\]"\)\) openAchievementsScreen\(\);/);
  assert.match(fn("achSnapshot"), /values\[it\.key\] = it\.value;/);
  const vi = app.slice(app.indexOf('"done.newBadge": "Huy hiệu mới"'));
  ["done.near", "done.lessonDone", "done.record", "done.recordSub", "done.seeBadges"].forEach((k) => assert.ok(vi.slice(0, 800).includes('"' + k + '"'), k));
});
