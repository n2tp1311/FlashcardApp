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

test("the target is a whole percent from 80 to 95, and anything else reads as 90", function() {
  assert.equal(M.targetRecall({}), 90);
  assert.equal(M.targetRecall({ targetRecall: 85 }), 85);
  for (const bad of [79, 96, 87.5, "85", null]) assert.equal(M.targetRecall({ targetRecall: bad }), 90, String(bad));
});

test("a stored model must be 21 finite numbers, or it is the default", function() {
  assert.equal(M.parseModel(null), null);
  assert.equal(M.parseModel("{bad"), null);
  assert.equal(M.parseModel(JSON.stringify({ w: [1, 2, 3] })), null);
  assert.equal(M.parseModel(JSON.stringify({ w: M.DEFAULT_W.map((x, i) => i === 3 ? "x" : x) })), null);
  assert.deepEqual(M.parseModel(JSON.stringify({ w: M.DEFAULT_W })).w, M.DEFAULT_W);
});

function reviewState(stability, daysAgo, now) {
  return cardFromState({ fsrs_stability: stability, fsrs_difficulty: 5, fsrs_state: 2, fsrs_reps: 5, fsrs_lapses: 0,
                         fsrs_last_review_at: now - daysAgo * DAY, srs_due_at: now }, new Date(now * 1000));
}

test("a higher target gives a shorter interval, and so more reviews a day", function() {
  const now = Math.floor(Date.UTC(2026, 9, 8) / 1000);
  const days = (r) => (M.schedulerFor(null, r).next(reviewState(10, 10, now), new Date(now * 1000), Rating.Good).card.due / 1000 - now) / DAY;
  assert.ok(days(80) > days(90) && days(90) > days(95), [days(80), days(90), days(95)].join(" "));
  const load = M.loadByTarget([5, 20, 60], null);
  assert.equal(Object.keys(load).length, 16);
  assert.ok(load[80] < load[90] && load[90] < load[95]);
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
  INSERT INTO users (id, email, name, preferences) VALUES ('u1', 'a@x', 'A', '{"loadBalance":false}');
  INSERT INTO users (id, email, name, preferences) VALUES ('u2', 'b@x', 'B', '{"loadBalance":false}');
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

test("an answer is scheduled at the user's target", async function() {
  const at90 = await answerDays("u1-c0");
  db.prepare("UPDATE users SET preferences = ? WHERE id = 'u1'").run(JSON.stringify({ loadBalance: false, targetRecall: 80 }));
  const at80 = await answerDays("u1-c0");
  db.prepare("UPDATE users SET preferences = ? WHERE id = 'u1'").run(JSON.stringify({ loadBalance: false }));
  assert.ok(at80 > at90 * 1.5, at80 + " vs " + at90);
});

test("below 400 reviews the model cannot be trained, and the summary says how far there is to go", async function() {
  const r = await call("POST", "/api/memory/train", { tz: 0 }, "u2");
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "notEnoughReviews");
  const info = (await call("GET", "/api/memory", undefined, "u2")).body;
  assert.ok(info.reviews < 400 && info.minReviews === 400 && info.model === null && info.candidate === null);
});

test("training proposes a fit; applying it schedules every later answer; reset goes back", async function() {
  assert.ok(reviews >= 400, "simulated " + reviews);
  const defaultDays = await answerDays("u1-c1");

  const trained = await call("POST", "/api/memory/train", { tz: -420 });
  assert.equal(trained.status, 200, JSON.stringify(trained.body));
  const c = trained.body.candidate;
  assert.equal(c.reviews, M.reviewCount(db, "u1"));
  assert.ok(c.errorPersonal < c.errorDefault, "a learner unlike the default is fitted better: " + JSON.stringify(c));

  assert.equal(await answerDays("u1-c1"), defaultDays, "a candidate changes nothing until applied");
  let info = (await call("GET", "/api/memory")).body;
  assert.ok(info.candidate && info.candidateLoad && !info.model);

  assert.equal((await call("POST", "/api/memory/apply", {})).status, 200);
  info = (await call("GET", "/api/memory")).body;
  assert.ok(info.model && !info.candidate && info.newSince === 1 && info.retrainSuggested === false);
  const personalDays = await answerDays("u1-c1");
  assert.ok(personalDays < defaultDays, "a faster forgetter gets shorter intervals: " + personalDays + " vs " + defaultDays);

  const cards = (await call("GET", "/api/lessons/l1/cards")).body;
  const row = cards.find(x => x.id === "u1-c1");
  assert.ok(row.fsrs_preview_good > 0, "the button previews come from the same scheduler");

  assert.equal((await call("POST", "/api/memory/apply", {})).body.code, "noCandidate");
  await call("DELETE", "/api/memory/model");
  assert.equal(await answerDays("u1-c1"), defaultDays);
});

test("the parameters only come from training: the preferences blob cannot set them", function() {
  db.prepare("UPDATE users SET preferences = ? WHERE id = 'u1'").run(JSON.stringify({ fsrsModel: { w: M.DEFAULT_W.map(() => 0) } }));
  assert.equal(M.readUser(db, "u1").model, null);
  db.prepare("UPDATE users SET preferences = ? WHERE id = 'u1'").run(JSON.stringify({ loadBalance: false }));
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
function modelHtml(info, recall, training, t) {
  const ctx = { state: { language: "en" }, t: t || ((k, v) => k + (v ? JSON.stringify(v) : "")),
                escHtml: (s) => String(s).replace(/</g, "&lt;") };
  vm.createContext(ctx);
  for (const f of ["memoryPerDay", "memoryPct", "memoryDate", "memoryModelHtml"]) vm.runInContext(extract(f), ctx);
  return ctx.memoryModelHtml(info, recall, training);
}
const info = (over) => Object.assign({ reviews: 900, minReviews: 400, model: null, candidate: null, newSince: null,
  retrainSuggested: false, reviewCards: 50, load: { 90: 42 }, candidateLoad: null }, over);

test("the model panel: locked below the minimum, a candidate shows both errors, a model can retrain", function() {
  const locked = modelHtml(info({ reviews: 172 }), 90, false);
  assert.match(locked, /width:43%/);
  assert.match(locked, /data-action="train" disabled/);

  const ready = modelHtml(info({}), 90, false);
  assert.match(ready, /data-action="train">pref\.modelTrain</);
  assert.match(modelHtml(info({}), 90, true), /data-action="train" disabled>pref\.modelTraining/);

  const cand = modelHtml(info({ candidate: { reviews: 2814, errorDefault: 0.079, errorPersonal: 0.031 }, candidateLoad: { 90: 36 } }), 90, false);
  assert.match(cand, /7\.9%/);
  assert.match(cand, /3\.1%/);
  assert.match(cand, /42 → 36/);
  assert.match(cand, /pref\.modelBetter/);
  assert.match(cand, /btn-primary" data-action="apply"/);

  const worse = modelHtml(info({ candidate: { reviews: 500, errorDefault: 0.03, errorPersonal: 0.05 } }), 90, false);
  assert.match(worse, /memory-badge warn">pref\.modelWorse/);
  assert.match(worse, /btn-primary" data-action="keep"/);

  const applied = modelHtml(info({ model: { reviews: 2814, trainedAt: 1791450310 }, newSince: 1240, retrainSuggested: true }), 90, false);
  assert.match(applied, /memory-nudge/);
  assert.match(applied, /data-action="reset"/);
});

test("the target is saved, loaded and server-only, with every string in both languages", function() {
  assert.match(appJs, /prefs\.targetRecall = state\.targetRecall;/);
  assert.match(appJs, /Number\.isInteger\(prefs\.targetRecall\) && prefs\.targetRecall >= 80 && prefs\.targetRecall <= 95/);
  assert.match(appJs, /"pref-workload", "pref-memory", "pref-api-tokens"/);
  assert.match(indexHtml, /id="pref-target-recall" class="memory-slider" min="80" max="95" step="1"/);
  for (const k of appJs.match(/"(pref\.(targetRecall|memory|model)\w*|toast\.model\w+|error\.(notEnoughData|notEnoughReviews|trainingBusy|optimizerUnavailable|optimizerFailed))":/g)) {
    assert.equal(appJs.split(k).length - 1, 2, k);
  }
});

test("on a 320px phone the slider and a candidate panel fit the Preferences dialog", async function() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 640 }, isMobile: true });
    await page.route("**/*.js", (r) => r.abort());
    await page.goto("file://" + path.join(root, "client", "index.html"));
    await page.addStyleTag({ path: path.join(root, "client", "style.css") });
    const html = modelHtml(info({ candidate: { reviews: 2814, errorDefault: 0.079, errorPersonal: 0.031 }, candidateLoad: { 90: 36 } }), 90, false, english);
    const r = await page.evaluate(function(h) {
      document.getElementById("modal-overlay").classList.remove("hidden");
      document.getElementById("modal-preferences").classList.remove("hidden");
      document.getElementById("pref-memory-model").innerHTML = h;
      document.getElementById("pref-memory-model").scrollIntoView();
      const box = document.getElementById("modal-preferences").getBoundingClientRect();
      const parts = Array.from(document.querySelectorAll("#pref-memory *")).map(el => [el, el.getBoundingClientRect()]).filter(p => p[1].width > 0);
      return { left: box.left, right: box.right, parts: parts.map(([el, b]) => [b.left, b.right, el.tagName + "." + el.className + "#" + el.id]) };
    }, html);
    for (const [l, rr, what] of r.parts) assert.ok(l >= r.left - 0.5 && rr <= r.right + 0.5, JSON.stringify([what, l, rr, r.left, r.right]));
    await page.screenshot({ path: path.join(root, "test-results", "memory-phone.png") });
  } finally {
    await browser.close();
  }
});
