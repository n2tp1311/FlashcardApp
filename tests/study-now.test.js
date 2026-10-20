"use strict";
// Study now: Home's one-tap session. The route picks due cards most overdue first, then
// never-answered cards in course order, across every class that isn't archived; the Today
// tile's button says how many and how long, from numbers Home already has.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
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
server.use("/api", require(path.join(root, "server/routes/cards.js")));
server.use("/api/stats", require(path.join(root, "server/routes/stats.js")));
server.use("/api/classes", require(path.join(root, "server/routes/classes.js")));

const now = Math.floor(Date.now() / 1000);
db.exec(`
  INSERT INTO users (id, email, name) VALUES ('u1', 'a@x', 'A'), ('u2', 'b@x', 'B');
  INSERT INTO classes (id, user_id, name, sort_order, archived) VALUES
    ('k2', 'u1', 'Second', 1, 0), ('k1', 'u1', 'First', 0, 0), ('kA', 'u1', 'Archived', 2, 1), ('kX', 'u2', 'Theirs', 0, 0);
  INSERT INTO lessons (id, class_id, title, format, sort_order) VALUES
    ('l1b', 'k1', 'Ch 2', 'term-def', 1), ('l1a', 'k1', 'Ch 1', 'term-def', 0), ('l2', 'k2', 'Ch 1', 'term-def', 0),
    ('lA', 'kA', 'Old', 'term-def', 0), ('lX', 'kX', 'X', 'term-def', 0);
  INSERT INTO cards (id, lesson_id, format, data, sort_order) VALUES
    ('due-old', 'l2',  'term-def', '{"term":"a","def":"a"}', 0),
    ('due-new', 'l1a', 'term-def', '{"term":"b","def":"b"}', 0),
    ('later',   'l1a', 'term-def', '{"term":"c","def":"c"}', 1),
    ('n3',      'l2',  'term-def', '{"term":"d","def":"d"}', 1),
    ('n2',      'l1b', 'term-def', '{"term":"e","def":"e"}', 0),
    ('n1',      'l1a', 'term-def', '{"term":"f","def":"f"}', 2),
    ('arch',    'lA',  'term-def', '{"term":"g","def":"g"}', 0),
    ('theirs',  'lX',  'term-def', '{"term":"h","def":"h"}', 0);
`);
const st = db.prepare("INSERT INTO card_states (card_id, user_id, srs_due_at, fsrs_stability, fsrs_difficulty, fsrs_state, fsrs_reps, fsrs_lapses, fsrs_learning_steps, fsrs_last_review_at) VALUES (?, ?, ?, 3, 5, 2, 3, 0, 0, ?)");
st.run("due-old", "u1", now - 5 * 86400, now - 9 * 86400);
st.run("due-new", "u1", now - 60, now - 2 * 86400);
st.run("later", "u1", now + 86400, now - 86400);
st.run("arch", "u1", now - 86400, now - 3 * 86400);
st.run("theirs", "u2", now - 86400, now - 3 * 86400);

let base, listener;
test.before(() => new Promise((ok) => { listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); }); }));
test.after(() => listener.close());

async function studyNow(body, user = "u1") {
  const r = await fetch(base + "/api/cards/study-now", { method: "POST",
    headers: { "content-type": "application/json", "x-user": user }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

test("due cards most overdue first, then new cards in course order, archived and others' left out", async () => {
  const r = await studyNow({ reviews: null, newCards: 10 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.cards.map((c) => c.id), ["due-old", "due-new", "n1", "n2", "n3"]);
  assert.deepEqual(r.body.lessons.map((l) => l.id).sort(), ["l1a", "l1b", "l2"]);
  const card = r.body.cards[0];
  assert.equal(card.data.term, "a");
  assert.ok(card.fsrs_preview_good, "cards carry the grading previews the flashcard screen shows");
});

test("the counts the client sends are what it gets", async () => {
  assert.deepEqual((await studyNow({ reviews: 1, newCards: 1 })).body.cards.map((c) => c.id), ["due-old", "n1"]);
  assert.deepEqual((await studyNow({ reviews: 0, newCards: 2 })).body.cards.map((c) => c.id), ["n1", "n2"]);
  assert.deepEqual((await studyNow({ reviews: 0, newCards: 0 })).body.cards, []);
  assert.equal((await studyNow({ reviews: -1, newCards: 0 })).status, 400);
  assert.equal((await studyNow({ reviews: 1 })).status, 400);
  assert.equal((await studyNow({ reviews: "5", newCards: 1 })).status, 400);
});

test("classIds keeps it to the picked classes; another user's class id finds nothing", async () => {
  assert.deepEqual((await studyNow({ reviews: null, newCards: 10, classIds: ["k1"] })).body.cards.map((c) => c.id), ["due-new", "n1", "n2"]);
  assert.deepEqual((await studyNow({ reviews: null, newCards: 10, classIds: ["k2", "k1"] })).body.cards.map((c) => c.id), ["due-old", "due-new", "n1", "n2", "n3"]);
  assert.deepEqual((await studyNow({ reviews: null, newCards: 10, classIds: ["kX"] })).body.cards, []);
  assert.deepEqual((await studyNow({ reviews: null, newCards: 10, classIds: null })).body.cards.length, 5);
  for (const bad of [[], "k1", [1], ["x".repeat(65)]])
    assert.equal((await studyNow({ reviews: null, newCards: 1, classIds: bad })).status, 400, JSON.stringify(bad));
});

test("the new-card estimate lists the classes, in course order, with the new cards each holds", async () => {
  const est = await (await fetch(base + "/api/stats/new-card-estimate", { headers: { "x-user": "u1" } })).json();
  assert.deepEqual(est.byClass, [{ id: "k1", name: "First", available: 2 }, { id: "k2", name: "Second", available: 1 }]);
});

test("the priority order puts the given classes first, keeps the rest after, and new cards follow it", async () => {
  const order = (ids, user = "u1") => fetch(base + "/api/classes/order", { method: "POST",
    headers: { "content-type": "application/json", "x-user": user }, body: JSON.stringify({ ids }) });
  assert.equal((await order(["k2", "k1"])).status, 200);
  assert.deepEqual(db.prepare("SELECT id FROM classes WHERE user_id = 'u1' ORDER BY sort_order").all().map((r) => r.id), ["k2", "k1", "kA"]);
  assert.deepEqual((await studyNow({ reviews: 0, newCards: 10 })).body.cards.map((c) => c.id), ["n3", "n1", "n2"]);
  const est = await (await fetch(base + "/api/stats/new-card-estimate", { headers: { "x-user": "u1" } })).json();
  assert.deepEqual(est.byClass.map((c) => c.id), ["k2", "k1"]);
  assert.equal((await order(["kX"])).status, 404, "another user's class");
  for (const bad of [[], ["k1", "k1"], "k1", [3]]) assert.equal((await order(bad)).status, 400, JSON.stringify(bad));
  assert.equal((await order(["k1", "k2"])).status, 200);
});

test("another user gets only their own", async () => {
  assert.deepEqual((await studyNow({ reviews: null, newCards: 5 }, "u2")).body.cards.map((c) => c.id), ["theirs"]);
});

test("the day's new-card goal still counts the new cards already learnt today", async () => {
  db.exec(`
    INSERT INTO users (id, email, name) VALUES ('u3', 'c@x', 'C');
    INSERT INTO classes (id, user_id, name) VALUES ('k3', 'u3', 'Small');
    INSERT INTO lessons (id, class_id, title, format) VALUES ('l3', 'k3', 'Only', 'term-def');
    INSERT INTO cards (id, lesson_id, format, data) VALUES
      ('s1', 'l3', 'term-def', '{}'), ('s2', 'l3', 'term-def', '{}'), ('s3', 'l3', 'term-def', '{}');
    INSERT INTO card_states (card_id, user_id, srs_due_at) VALUES ('s1', 'u3', ${now + 600}), ('s2', 'u3', ${now + 600});
    INSERT INTO attempts (id, card_id, user_id, correct, source, created_at) VALUES
      ('a1', 's1', 'u3', 1, 'flashcard', ${now - 30}), ('a2', 's2', 'u3', 1, 'flashcard', ${now - 20});
  `);
  const r = await fetch(base + "/api/stats/new-card-estimate", { headers: { "x-user": "u3" } });
  const est = await r.json();
  // Three cards in all, two learnt today: the goal is three, not the one left untouched.
  assert.equal(est.availableNewCards, 1);
  assert.equal(est.estimatedNewCards, 3);
});

test("a new account's dashboard counts zero answers, not null", async () => {
  db.exec("INSERT INTO users (id, email, name) VALUES ('u9', 'z@x', 'Z')");
  const r = await fetch(base + "/api/stats/dashboard", { headers: { "x-user": "u9" } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).summary.attempts, 0);
});

// The Today tile's button, built by app.js's own functions under the real stylesheet.
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
function fn(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}
const strings = {
  "studyNow.go": "Study now · {n} cards", "studyNow.reviews": "{n} to review", "studyNow.new": "{n} new",
  "studyNow.minutes": "~{n} min", "studyNow.underMinute": "<1 min", "studyNow.doneTitle": "All done for today",
  "studyNow.doneSub": "Nothing is due", "studyNow.capTitle": "Today's review limit reached",
  "studyNow.capSub": "{n} more due, left for tomorrow", "studyNow.more": "Learn {n} more new cards",
  "studyNow.modeLabel": "How to study", "studyNow.flashcard": "Flashcards", "studyNow.quiz": "Quiz"
};
const harness = `
var state = { maxReviewsPerDay: null, studyNowMode: "flashcard" };
var IS_SERVER = true, puts = [];
window.fetch = function(url, opts) { puts.push([url, opts.method, opts.body]); return Promise.resolve({ ok: true }); };
var STRINGS = ${JSON.stringify(strings)};
function t(k, p) { return (STRINGS[k] || k).replace(/\\{(\\w+)\\}/g, function(_, n) { return p[n]; }); }
function escHtml(s) { return String(s); }
var ETA_FALLBACK_MS = { flashcard: 10000, quiz: 15000 };
var STUDY_NOW_EXTRA = 10;
var STUDY_NOW_MODES = ["flashcard", "quiz"];
${fn("studyNowMode")}${fn("studyNowModeHtml")}${fn("setStudyNowMode")}${fn("saveStudyNowPref")}${fn("studyNowPlan")}${fn("studyNowHtml")}
// app.js's delegate, as the wiring test pins it.
document.addEventListener("click", function(e) {
  var modeBtn = e.target.closest("[data-study-now-mode]");
  if (modeBtn) setStudyNowMode(modeBtn.dataset.studyNowMode);
});
function tile(today, est, due, cap) {
  state.maxReviewsPerDay = cap;
  document.body.innerHTML = '<section class="dash-tile" style="width:340px">' + studyNowHtml(studyNowPlan(today, est, due), today) + '</section>';
  var b = document.querySelector("[data-study-now]");
  return { text: document.body.innerText.replace(/\\s+/g, " ").trim(), data: b && b.dataset.studyNow, filled: !!document.querySelector(".study-now") };
}
`;

let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { if (browser) await browser.close(); });

test("the button counts reviews and new cards, and says how long from the median card", async () => {
  const p = await browser.newPage();
  await p.setContent("<!doctype html><body></body>");
  await p.addStyleTag({ path: path.join(root, "client", "style.css") });
  await p.addScriptTag({ content: harness });
  const today = (reviews, newCards) => ({ activity: { reviews, newCards }, medianMs: { flashcard: 20000, quiz: null } });
  const est = { estimatedNewCards: 10, availableNewCards: 40 };

  let r = await p.evaluate(([a, b]) => tile(a, b, 28, null), [today(0, 4), est]);
  assert.deepEqual(r, { text: "Study now · 34 cards 28 to review · 6 new · ~11 min Flashcards Quiz", data: "all,6", filled: true });

  // A cap counts what is left of it today; due cards past it wait for tomorrow.
  r = await p.evaluate(([a, b]) => tile(a, b, 28, 30), [today(25, 10), est]);
  assert.deepEqual(r, { text: "Study now · 5 cards 5 to review · ~2 min Flashcards Quiz", data: "5,0", filled: true });
  r = await p.evaluate(([a, b]) => tile(a, b, 28, 30), [today(30, 10), est]);
  assert.deepEqual(r, { text: "✓ Today's review limit reached 28 more due, left for tomorrow", data: null, filled: false });

  // Nothing due and the day's new cards learnt: done, with ten more new ones on offer.
  r = await p.evaluate(([a, b]) => tile(a, b, 0, null), [today(12, 10), est]);
  assert.deepEqual(r, { text: "✓ All done for today Nothing is due Learn 10 more new cards", data: "0,10", filled: false });
  r = await p.evaluate(([a]) => tile(a, null, 0, null), [today(0, 0)]);
  assert.equal(r.text, "✓ All done for today Nothing is due");

  // Only new cards: they are always flashcards, so there is no mode to pick.
  r = await p.evaluate(([a, b]) => tile(a, b, 0, null), [today(0, 4), est]);
  assert.deepEqual(r, { text: "Study now · 6 cards 6 new · ~2 min", data: "all,6", filled: true });
  await p.close();
});

test("flashcards or quiz is a choice under the button: the time follows it, and it is remembered", async () => {
  const p = await browser.newPage();
  await p.route("http://sn.test/", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }));
  await p.goto("http://sn.test/");
  await p.addStyleTag({ path: path.join(root, "client", "style.css") });
  await p.addScriptTag({ content: harness });
  const today = { activity: { reviews: 0, newCards: 0 }, medianMs: { flashcard: 20000, quiz: 30000 } };
  const est = { estimatedNewCards: 10, availableNewCards: 40 };
  const read = () => p.evaluate(() => ({
    sub: document.querySelector(".study-now small").textContent,
    pressed: [...document.querySelectorAll("[data-study-now-mode]")].map((b) => b.dataset.studyNowMode + "=" + b.getAttribute("aria-pressed")),
    mode: state.studyNowMode, puts: puts.slice(), cached: JSON.parse(localStorage.getItem("fc-preferences") || "{}")
  }));
  await p.evaluate(([a, b]) => { localStorage.setItem("fc-preferences", '{"theme":"dark"}'); tile(a, b, 20, null); }, [today, est]);
  let r = await read();
  assert.equal(r.sub, "20 to review · 10 new · ~10 min");
  assert.deepEqual(r.pressed, ["flashcard=true", "quiz=false"], "flashcards for anyone who never picked");

  await p.click("[data-study-now-mode=quiz]");
  r = await read();
  // 20 reviews at the quiz median and the 10 new cards still at the flashcard one.
  assert.equal(r.sub, "20 to review · 10 new · ~13 min", "the reviews at a quiz answer's own median");
  assert.deepEqual(r.pressed, ["flashcard=false", "quiz=true"]);
  assert.equal(r.mode, "quiz");
  assert.deepEqual(r.puts, [["/api/auth/preferences", "PUT", '{"studyNowMode":"quiz"}']]);
  assert.deepEqual(r.cached, { theme: "dark", studyNowMode: "quiz" }, "merged into the cached preferences");

  // Pressing the chosen one again sends nothing; the next render opens on the choice.
  await p.click("[data-study-now-mode=quiz]");
  await p.evaluate(([a, b]) => tile(a, b, 20, null), [today, est]);
  r = await read();
  assert.equal(r.puts.length, 1);
  assert.equal(r.sub, "20 to review · 10 new · ~13 min");
  assert.deepEqual(r.pressed, ["flashcard=false", "quiz=true"]);
  await p.close();
});

test("wiring: Home and the Dashboard feed it the due total, it skips Study Setup and returns where it began", () => {
  assert.match(fn("renderHomeCharts"), /state\.studyNowDue = dueTotal\(dash\.dueForReview\);\n    state\.studyNowDueLessons = dash\.dueForReview \|\| \[\];/);
  assert.match(app, /state\.studyNowDue = dueTotal\(d\.dueForReview\);\n    state\.studyNowDueLessons = d\.dueForReview \|\| \[\];\n    summaryGrid\.innerHTML = streakTimeHeroCard/);
  assert.match(fn("heroTodayTile"), /studyNowHtml\(state\.studyNowDue == null \? null : studyNowPlan\(today, newCardEstimate, state\.studyNowDue\), today, !!summary && summary\.cards === 0, studyNowOrderChipHtml\(newCardEstimate\)\)/);
  const start = fn("startStudyNow");
  assert.match(start, /launchStudyNowCards\(due\.length \? due : fresh, res\.lessons, statsMap, from, due\.length \? studyNowMode\(\) : "flashcard"\)/);
  assert.match(fn("launchStudyNowCards"), /returnScreen: from/);
  assert.match(fn("launchStudyNowCards"), /launchStudy\(cards, mode, "in-order"\)/);
  assert.match(fn("applyPrefs"), /if \(prefs\.studyNowMode === "quiz" \|\| prefs\.studyNowMode === "flashcard"\) state\.studyNowMode = prefs\.studyNowMode;/);
  assert.match(app, /var modeBtn = e\.target\.closest\("\[data-study-now-mode\]"\);\n  if \(modeBtn\) \{ setStudyNowMode\(modeBtn\.dataset\.studyNowMode\); return; \}/);
  assert.match(fn("startStudy"), /launchStudy\(filtered, mode, order\);/);
  assert.match(app, /getStudyNowCards: function\(reviews, newCards, classIds\) \{ return req\("POST", "\/cards\/study-now"/);
});
