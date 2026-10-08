"use strict";
// Target recall and the personal FSRS model: the target moves intervals the right way, a fit
// is trained on a user's own answers and only proposed, and an applied model is what every
// later answer is scheduled with.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");
const express = require("express");

const root = path.join(__dirname, "..");
const M = require(path.join(root, "server/lib/memory.js"));
const { cardFromState, Rating } = require(path.join(root, "server/fsrs.js"));
const DAY = 86400;

test("the target is one of three choices; an old slider value maps to the nearest", function() {
  assert.equal(M.targetRecall({}), 90);
  for (const [v, want] of [[85, 85], [80, 85], [87, 85], [88, 90], [90, 90], [93, 95], [95, 95], [99, 95]])
    assert.equal(M.targetRecall({ targetRecall: v }), want, String(v));
  for (const bad of [60, 100, "85", null, NaN]) assert.equal(M.targetRecall({ targetRecall: bad }), 90, String(bad));
});

function reviewState(stability, daysAgo, now) {
  return cardFromState({ fsrs_stability: stability, fsrs_difficulty: 5, fsrs_state: 2, fsrs_reps: 5, fsrs_lapses: 0,
                         fsrs_last_review_at: now - daysAgo * DAY, srs_due_at: now }, new Date(now * 1000));
}

test("a higher target gives a shorter interval, and so more reviews a day", function() {
  const now = Math.floor(Date.UTC(2026, 9, 8) / 1000);
  const days = (r) => (M.schedulerFor(null, r).next(reviewState(10, 10, now), new Date(now * 1000), Rating.Good).card.due / 1000 - now) / DAY;
  assert.ok(days(85) > days(90) && days(90) > days(95), [days(85), days(90), days(95)].join(" "));
  const load = M.loadByTarget([5, 20, 60], null);
  assert.deepEqual(Object.keys(load), ["85", "90", "95"]);
  assert.ok(load[85] < load[90] && load[90] < load[95]);
  assert.ok(Math.abs(M.intervalAt(10, 90, null) - 10) < 1e-9, "at 90% the interval equals the stability");
  assert.equal(M.schedulerFor(null, 90), M.schedulerFor(null, 90), "schedulers are cached");
});

test("training items: one per answer after the first, with days between answers in local time", function() {
  const byCard = new Map([["a", [
    { rating: 3, day: 100, at: 10 }, { rating: 3, day: 100, at: 20 }, { rating: 1, day: 103, at: 30 }]],
    ["b", [{ rating: 3, day: 101, at: 15 }, { rating: 4, day: 105, at: 25 }]]]);
  const items = M.trainingItems(byCard);
  assert.deepEqual(items.map(i => i.at), [25, 30], "oldest last answer first; a history all on day one is left out");
  assert.deepEqual(items[1].reviews, [[3, 0], [3, 0], [1, 3]]);
  assert.deepEqual(items[0].reviews, [[3, 0], [4, 4]]);
});

test("the comparison predicts cross-day answers only, from each day's first answer", function() {
  const got = M.crossDay([{ at: 1, reviews: [[3, 0], [3, 0], [1, 2], [3, 0]] }, { at: 2, reviews: [[3, 0], [3, 0], [1, 2], [3, 0], [3, 4]] }]);
  assert.deepEqual(got, [{ at: 2, reviews: [[3, 0], [1, 2], [3, 4]] }]);
});

test("a panic in the native optimizer fails one training, not the process that asked", async function() {
  // Training on histories all on one day panics in fsrs-rs; the held-out pair is valid.
  const sameDay = Array.from({ length: 10 }, (_, i) => ({ at: i, reviews: i < 8 ? [[3, 0], [3, 0]] : [[3, 0], [3, 2]] }));
  await assert.rejects(M.train(sameDay), (e) => e instanceof M.TrainingError && e.code === "optimizerFailed");
});

// --- Routes, on the real schema in memory ---
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
server.use("/api/memory", require(path.join(root, "server/routes/memory.js")));
server.use("/api", require(path.join(root, "server/routes/cards.js")));

let base, listener;
test.before(() => new Promise((ok) => { listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); }); }));
test.after(() => listener.close());

db.exec(`
  INSERT INTO users (id, email, name, preferences) VALUES ('u1', 'a@x', 'A', '{"loadBalance":false,"adaptMemory":false}');
  INSERT INTO users (id, email, name, preferences) VALUES ('u2', 'b@x', 'B', '{"loadBalance":false}');
  INSERT INTO users (id, email, name, preferences) VALUES ('u3', 'c@x', 'C', '{"loadBalance":false}');
  INSERT INTO classes (id, user_id, name) VALUES ('k3', 'u3', 'Auto');
  INSERT INTO lessons (id, class_id, title, format) VALUES ('l3', 'k3', 'Ch 1', 'term-def');
  INSERT INTO classes (id, user_id, name) VALUES ('k1', 'u1', 'Stats');
  INSERT INTO lessons (id, class_id, title, format) VALUES ('l1', 'k1', 'Ch 1', 'term-def');
  INSERT INTO classes (id, user_id, name) VALUES ('k2', 'u2', 'Few');
  INSERT INTO lessons (id, class_id, title, format) VALUES ('l2', 'k2', 'Ch 1', 'term-def');
`);

// A learner who forgets twice as fast as FSRS's default model predicts: reviews scheduled by
// the default, each answered right with the recall their own, shorter stability gives.
function simulate(userId, lessonId, cards) {
  let seed = 11;
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const sched = M.schedulerFor(null, 90);
  const start = Math.floor(Date.now() / 1000) - 300 * DAY;
  const insert = db.prepare("INSERT INTO attempts (id, card_id, user_id, correct, source, grade, created_at) VALUES (?, ?, ?, ?, 'flashcard', ?, ?)");
  let n = 0;
  for (let c = 0; c < cards; c++) {
    const id = userId + "-c" + c;
    db.prepare("INSERT INTO cards (id, lesson_id, format, data) VALUES (?, ?, 'term-def', '{\"term\":\"t\",\"def\":\"d\"}')").run(id, lessonId);
    let t = start + Math.floor(rand() * 60) * DAY, card = null;
    for (let k = 0; k < 9; k++) {
      let ok = true;
      if (card) {
        const elapsed = (t - card.last_review.getTime() / 1000) / DAY;
        const recall = Math.pow(1 + (Math.pow(0.9, -1 / 0.1542) - 1) * elapsed / (card.stability * 0.5), -0.1542);
        ok = rand() < recall;
      }
      insert.run(id + "-" + k, id, userId, ok ? 1 : 0, ok ? "medium" : null, t);
      n++;
      const now = new Date(t * 1000);
      card = sched.next(card || cardFromState(null, now), now, ok ? Rating.Good : Rating.Again).card;
      t = Math.max(t + 600, Math.floor(card.due.getTime() / 1000));
      if (t > start + 300 * DAY) break;
    }
  }
  return n;
}
const reviews = simulate("u1", "l1", 160);
simulate("u2", "l2", 20);
simulate("u3", "l3", 80);

const call = async (method, p, body, user = "u1") => {
  const r = await fetch(base + p, { method, headers: { "content-type": "application/json", "x-user": user }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

function seedReviewCard(id, userId) {
  const t = Math.floor(Date.now() / 1000);
  db.prepare("INSERT OR REPLACE INTO card_states (card_id, user_id, srs_due_at, fsrs_stability, fsrs_difficulty, fsrs_state, " +
    "fsrs_reps, fsrs_lapses, fsrs_learning_steps, fsrs_last_review_at) VALUES (?, ?, ?, 20, 5, 2, 5, 0, 0, ?)").run(id, userId, t - 60, t - 20 * DAY);
}
async function answerDays(id, userId = "u1") {
  seedReviewCard(id, userId);
  const r = await call("POST", "/api/attempts", { cardId: id, correct: true, source: "flashcard", grade: "medium" }, userId);
  return (r.body.srs_due_at - Math.floor(Date.now() / 1000)) / DAY;
}

const prefs = (p) => db.prepare("UPDATE users SET preferences = ? WHERE id = 'u1'").run(JSON.stringify({ loadBalance: false, ...p }));

test("an answer is scheduled at the user's choice", async function() {
  prefs({ adaptMemory: false });
  const at90 = await answerDays("u1-c0");
  prefs({ adaptMemory: false, targetRecall: 85 });
  const at85 = await answerDays("u1-c0");
  prefs({ adaptMemory: false });
  assert.ok(at85 > at90 * 1.3, at85 + " vs " + at90);
});

test("below 400 answers nothing is fitted, and the summary says how far there is to go", async function() {
  assert.equal(await M.maybeAdapt(db, "u2", 0), null);
  const info = (await call("GET", "/api/memory", undefined, "u2")).body;
  assert.ok(info.reviews < 400 && info.minReviews === 400 && info.nextFitAt === 400 && info.model === null && info.lastFit === null);
  assert.equal(info.adapt, true, "on by default");
});

test("adapting fits on its own, is used when it beats the defaults, and the switch turns it off", async function() {
  assert.ok(reviews >= 400, "simulated " + reviews);
  prefs({ adaptMemory: false });
  const standardDays = await answerDays("u1-c1");
  assert.equal(await M.maybeAdapt(db, "u1", -420), null, "off: nothing is fitted");

  prefs({});
  assert.equal(await M.maybeAdapt(db, "u1", -420), "adapted", "a learner unlike the default is fitted better");
  let info = (await call("GET", "/api/memory")).body;
  const n = M.reviewCount(db, "u1");
  assert.equal(info.model.reviews, n);
  assert.equal(info.lastFit.result, "adapted");
  assert.equal(info.nextFitAt, n + 1000);
  assert.equal(await M.maybeAdapt(db, "u1", -420), null, "not again until 1,000 more answers");

  const adaptedDays = await answerDays("u1-c1");
  assert.ok(adaptedDays < standardDays, "a faster forgetter gets shorter intervals: " + adaptedDays + " vs " + standardDays);
  const row = (await call("GET", "/api/lessons/l1/cards")).body.find(x => x.id === "u1-c1");
  assert.ok(row.fsrs_preview_good > 0, "the button previews come from the same scheduler");

  prefs({ adaptMemory: false });
  assert.equal(await answerDays("u1-c1"), standardDays, "off ignores the stored model");
  assert.ok(M.readUser(db, "u1").model, "but keeps it for when it is turned back on");
});

test("a fit no better than the defaults is not used, and a failed one keeps what was in use", async function() {
  prefs({});
  const reset = () => db.prepare("UPDATE users SET fsrs_last_fit = NULL WHERE id = 'u1'").run();
  reset();
  const kept = M.readUser(db, "u1").model;
  assert.equal(await M.maybeAdapt(db, "u1", 0, async () => { throw new M.TrainingError("notEnoughData", "x"); }), "notEnoughData");
  assert.deepEqual(M.readUser(db, "u1").model, kept);
  reset();
  assert.equal(await M.maybeAdapt(db, "u1", 0, async () => ({ w: M.DEFAULT_W, errorDefault: 0.03, errorPersonal: 0.05 })), "standard");
  const u = M.readUser(db, "u1");
  assert.equal(u.model, null);
  assert.equal(u.lastFit.result, "standard");
  prefs({ adaptMemory: false });
});

test("an answer starts adapting in the background once there are enough", async function() {
  const id = "u3-c0";
  seedReviewCard(id, "u3");
  await call("POST", "/api/attempts", { cardId: id, correct: true, source: "flashcard", grade: "medium", tz: 0 }, "u3");
  for (let i = 0; i < 100 && !M.readUser(db, "u3").lastFit; i++) await new Promise(ok => setTimeout(ok, 100));
  assert.ok(M.readUser(db, "u3").lastFit, "a fit was attempted after the answer");
});

test("the parameters only come from fitting: the preferences blob cannot set them", function() {
  prefs({ fsrsModel: { w: M.DEFAULT_W.map(() => 0) } });
  db.prepare("UPDATE users SET fsrs_model = NULL WHERE id = 'u1'").run();
  assert.equal(M.readUser(db, "u1").model, null);
  prefs({ adaptMemory: false });
});

// --- Client ---
const appJs = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
function extract(name) {
  const start = appJs.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return appJs.slice(start, appJs.indexOf("\n}\n", start) + 3);
}
// English strings from app.js itself, so the layout check wraps real words.
function english(k, v) {
  const m = appJs.match(new RegExp('"' + k.replace(/\./g, "\\.") + '": "([^"]*)"'));
  return (m ? m[1] : k).replace(/\{(\w+)\}/g, (_, x) => (v && v[x] != null ? v[x] : ""));
}
function client(t) {
  const ctx = { state: { language: "en" }, t: t || ((k, v) => k + (v ? JSON.stringify(v) : "")), escHtml: (s) => String(s).replace(/</g, "&lt;") };
  vm.createContext(ctx);
  const choices = appJs.slice(appJs.indexOf("var MEMORY_CHOICES = ["), appJs.indexOf("];", appJs.indexOf("var MEMORY_CHOICES = [")) + 2);
  vm.runInContext(choices, ctx);
  for (const f of ["nearestMemoryChoice", "memoryPerDay", "memoryDate", "memoryChoicesHtml", "memoryStatusHtml"]) vm.runInContext(extract(f), ctx);
  return ctx;
}
const info = (over) => Object.assign({ choice: 90, adapt: true, reviews: 900, minReviews: 400, nextFitAt: 400, model: null, lastFit: null,
  reviewCards: 50, load: { 85: 22, 90: 42, 95: 104 } }, over);

test("three choices, each with reviews a day and how often you forget", function() {
  const c = client();
  const html = c.memoryChoicesHtml(info({}), 95);
  assert.equal((html.match(/role="radio"/g) || []).length, 3);
  assert.match(html, /class="memory-choice on" role="radio" aria-checked="true" data-value="95"/);
  assert.match(html, /pref\.memoryPerDay\{"n":"104"\}/);
  assert.match(html, /pref\.memoryForget\{"n":7\}/);
  assert.equal((html.match(/memory-rec/g) || []).length, 1, "Balanced is the recommended one");
  assert.doesNotMatch(c.memoryChoicesHtml(info({ reviewCards: 0 }), 90), /memoryPerDay/, "no estimate with no review cards");
  assert.deepEqual([80, 87, 88, 93, 96, "x"].map(c.nearestMemoryChoice), [85, 85, 90, 95, 95, 90]);
});

test("the status line under the switch", function() {
  const c = client();
  assert.match(c.memoryStatusHtml(info({}), false), /pref\.adaptOff/);
  const waiting = c.memoryStatusHtml(info({ reviews: 172 }), true);
  assert.match(waiting, /width:43%/);
  assert.match(waiting, /pref\.adaptWaiting\{"n":228\}/);
  assert.match(c.memoryStatusHtml(info({}), true), /pref\.adaptSoon/);
  assert.match(c.memoryStatusHtml(info({ model: { trainedAt: 1791450310, reviews: 2814 } }), true), /memory-line good">✓ pref\.adaptDone/);
  assert.match(c.memoryStatusHtml(info({ lastFit: { at: 1791450310, reviews: 900, result: "standard" } }), true), /pref\.adaptStandard/);
  assert.match(c.memoryStatusHtml(info({ nextFitAt: 1300, lastFit: { at: 1, reviews: 900, result: "notEnoughData" } }), true), /pref\.adaptRetry\{"n":400\}/);
});

test("the choice and the switch are saved, loaded and server-only, with every string in both languages", function() {
  assert.match(appJs, /prefs\.targetRecall = state\.targetRecall;\s*prefs\.adaptMemory = state\.adaptMemory;/);
  assert.match(appJs, /state\.targetRecall = nearestMemoryChoice\(prefs\.targetRecall\);/);
  assert.match(appJs, /typeof prefs\.adaptMemory === "boolean"/);
  assert.match(appJs, /"pref-workload", "pref-memory", (?:"pref-reminders", )?"pref-api-tokens"/);
  assert.match(indexHtml, /id="pref-memory-choices" role="radiogroup"/);
  assert.match(indexHtml, /id="pref-adapt-memory"/);
  assert.doesNotMatch(appJs + indexHtml, /pref-target-recall|pref\.model\w+|trainMemory/, "the first version's slider and model panel are gone");
  for (const k of appJs.match(/"pref\.(memory|adapt)\w*":/g)) assert.equal(appJs.split(k).length - 1, 2, k);
});

test("on a 320px phone the three choices and the status line fit the Preferences dialog", async function() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 640 }, isMobile: true, reducedMotion: "reduce" });
    await page.route("**/*.js", (r) => r.abort());
    await page.goto("file://" + path.join(root, "client", "index.html"));
    await page.addStyleTag({ path: path.join(root, "client", "style.css") });
    const c = client(english);
    const choices = c.memoryChoicesHtml(info({}), 90);
    const status = c.memoryStatusHtml(info({ model: { trainedAt: 1791450310, reviews: 2814 } }), true);
    const r = await page.evaluate(function([ch, st]) {
      document.getElementById("modal-overlay").classList.remove("hidden");
      document.getElementById("modal-preferences").classList.remove("hidden");
      document.getElementById("pref-memory-choices").innerHTML = ch;
      document.getElementById("pref-memory-status").innerHTML = st;
      document.getElementById("pref-memory").scrollIntoView();
      const box = document.getElementById("modal-preferences").getBoundingClientRect();
      const parts = Array.from(document.querySelectorAll("#pref-memory *")).map(el => [el, el.getBoundingClientRect()]).filter(p => p[1].width > 0);
      const rows = Array.from(document.querySelectorAll(".memory-choice")).map(b => {
        const name = Array.from(b.querySelector("b").getClientRects()).reduce((m, x) => ({ top: Math.min(m.top, x.top), right: Math.max(m.right, x.right) }), { top: 1e9, right: 0 });
        const rec = b.querySelector(".memory-rec");
        if (rec) { const x = rec.getBoundingClientRect(); name.right = Math.max(name.right, x.right); }
        const per = b.querySelector(".memory-per").getBoundingClientRect();
        return Math.abs(name.top - per.top) < 12 && name.right <= per.left;
      });
      return { left: box.left, right: box.right, rows, parts: parts.map(([el, b]) => [b.left, b.right, el.tagName + "." + el.className]) };
    }, [choices, status]);
    for (const [l, rr, what] of r.parts) assert.ok(l >= r.left - 0.5 && rr <= r.right + 0.5, JSON.stringify([what, l, rr, r.left, r.right]));
    assert.deepEqual(r.rows, [true, true, true], "each choice's name and reviews a day share a line without touching");
    await page.waitForTimeout(400);
    await page.locator("#pref-memory").screenshot({ path: path.join(root, "test-results", "memory-phone.png") });
  } finally {
    await browser.close();
  }
});
