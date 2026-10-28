"use strict";
// "Learn these first": the cards a card builds on (cards.needs, sent by KnowledgeApp), looked
// up when a card keeps being forgotten, and put into the session straight after it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const express = require("express");
const { Database } = require("node-sqlite3-wasm");

const root = path.join(__dirname, "..");
const raw = new Database();
const _prepare = raw.prepare.bind(raw);
const db = {
  exec: (sql) => raw.exec(sql),
  transaction: (fn) => () => fn(),
  prepare(sql) {
    const stmt = _prepare(sql);
    const arg = (a) => (a.length === 0 ? [] : a.length === 1 ? a[0] : a);
    return { run: (...a) => stmt.run(arg(a)), get: (...a) => stmt.get(arg(a)), all: (...a) => stmt.all(arg(a)) };
  }
};
const now = Math.floor(Date.now() / 1000);
raw.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, preferences TEXT, fsrs_model TEXT, fsrs_last_fit TEXT);
  CREATE TABLE classes (id TEXT PRIMARY KEY, user_id TEXT);
  CREATE TABLE lessons (id TEXT PRIMARY KEY, class_id TEXT);
  CREATE TABLE cards (id TEXT PRIMARY KEY, lesson_id TEXT, external_id TEXT, format TEXT, data TEXT, needs TEXT,
    sort_order INTEGER, created_at INTEGER);
  CREATE TABLE card_states (card_id TEXT, user_id TEXT, known INTEGER, last_seen_at INTEGER, srs_due_at INTEGER,
    last_correct_source TEXT, fsrs_stability REAL, fsrs_difficulty REAL, fsrs_state INTEGER, fsrs_reps INTEGER,
    fsrs_lapses INTEGER, fsrs_learning_steps INTEGER, fsrs_last_review_at INTEGER, leech_base INTEGER);
  CREATE TABLE rewrite_requests (card_id TEXT, status TEXT);
  INSERT INTO users (id) VALUES ('u1'), ('u2');
  INSERT INTO classes VALUES ('k1', 'u1'), ('k2', 'u1'), ('x', 'u2');
  INSERT INTO lessons VALUES ('L1', 'k1'), ('L2', 'k1'), ('M1', 'k2'), ('X1', 'x');
  INSERT INTO cards (id, lesson_id, external_id, format, data, needs) VALUES
    ('pi', 'L1', 's:1', 'term-def', '{"term":"Prediction Interval","def":"d"}', '["s:4","s:2","s:3","s:9"]'),
    ('err', 'L2', 's:2', 'term-def', '{"term":"Error Term","def":"d"}', NULL),
    ('dep', 'L1', 's:3', 'term-def', '{"term":"Dependent Variable","def":"d"}', NULL),
    ('mean', 'L1', 's:4', 'term-def', '{"term":"Conditional Mean","def":"d"}', NULL),
    ('other', 'M1', 's:2', 'term-def', '{"term":"Same id, another class","def":"d"}', NULL),
    ('theirs', 'X1', 's:1', 'term-def', '{"term":"t","def":"d"}', '["s:2"]');
  INSERT INTO card_states (card_id, user_id, srs_due_at, fsrs_state, fsrs_stability, fsrs_difficulty, fsrs_reps, fsrs_lapses, fsrs_learning_steps, fsrs_last_review_at) VALUES
    ('dep', 'u1', ${now + 86400 * 30}, 2, 40, 5, 4, 0, 0, ${now - 86400}), ('mean', 'u1', ${now - 60}, 2, 3, 6, 3, 1, 0, ${now - 86400 * 3});
`);

function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub("server/db.js", db);
stub("server/middleware/auth.js", { requireAuth(req, res, next) { req.session = { userId: req.get("x-user") }; next(); } });
const app = express();
app.use(express.json());
app.use("/api", require(path.join(root, "server/routes/cards.js")));
let base, server;
test.before(() => new Promise((ok) => { server = app.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + server.address().port; ok(); }); }));
test.after(() => server.close());
const get = async (id, user = "u1") => { const r = await fetch(base + "/api/cards/" + id + "/needs", { headers: { "x-user": user } }); return { status: r.status, body: await r.json() }; };

test("a card's prerequisites come from its own class, in the order sent, each marked weak or not", async () => {
  const { status, body } = await get("pi");
  assert.equal(status, 200);
  assert.deepEqual(body.cards.map((c) => [c.id, c.weak]), [["mean", true], ["err", true], ["dep", false]]);
  assert.equal(body.cards[1].data.term, "Error Term", "shaped like a lesson's cards");
  assert.ok("fsrs_preview_again" in body.cards[0]);
  assert.deepEqual((await get("err")).body, { cards: [] });
  assert.equal((await get("theirs")).status, 404);
});

test("KnowledgeApp's lists are stored per linked card, and an empty one clears it", () => {
  const integrations = fs.readFileSync(path.join(root, "server", "routes", "integrations.js"), "utf8");
  const route = integrations.slice(integrations.indexOf('router.post("/needs"'));
  const handler = route.slice(0, route.indexOf("\n});") + 4);
  const sql = [...handler.matchAll(/db\.prepare\(\s*((?:"[^"]*"\s*\+?\s*)+)\)/g)]
    .map((m) => m[1].split(/"\s*\+\s*"/).join("").replace(/^"|"\s*$/g, ""))[0];
  assert.equal(raw.prepare(sql).run(['["s:3"]', "s:2", "u1"]).changes, 2);
  assert.equal(db.prepare("SELECT needs FROM cards WHERE id = 'err'").get().needs, '["s:3"]');
  raw.prepare(sql).run([null, "s:2", "u1"]);
  assert.equal(db.prepare("SELECT needs FROM cards WHERE id = 'err'").get().needs, null);
  assert.match(handler, /n\.needs\.length > MAX_NEEDS \|\| !n\.needs\.every\(isId\)/);
  assert.match(handler, /n\.needs\.length \? JSON\.stringify\(n\.needs\) : null/);
  assert.match(fs.readFileSync(path.join(root, "server", "db.js"), "utf8"), /ALTER TABLE cards ADD COLUMN needs TEXT/);
});

// The study screen's side, run from client/app.js.
const appJs = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
function extract(name) {
  const start = appJs.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return appJs.slice(start, appJs.indexOf("\n}\n", start) + 3);
}
const ctx = { IS_SERVER: true, state: {}, store: {}, saveResumeSession() {}, renderFcDots() {}, advanced: 0,
  scheduleFlashcardAdvance() { ctx.advanced++; }, getActiveScreen: () => "flashcard", offered: null,
  showNeedsOffer(card, weak) { ctx.offered = weak.map((c) => c.id); } };
vm.createContext(ctx);
vm.runInContext("var NEEDS_AFTER_LAPSES = 2;" + ["needIds", "needsLookup", "needsToStudy", "advanceOrOfferNeeds", "insertNeeds"].map(extract).join(""), ctx);
const card = (id, extra) => Object.assign({ id: id, data: { term: id } }, extra);

test("looked up only from the third forgetting, on the server, for a card that has prerequisites", () => {
  ctx.store = { cardNeeds: (id) => Promise.resolve({ id }) };
  ctx.state = { studyIndex: 0 };
  assert.equal(ctx.needsLookup(card("a", { needs: '["s:2"]', leech_lapses: 1 }), "t1"), null);
  assert.equal(ctx.needsLookup(card("a", { needs: null, leech_lapses: 5 }), "t1"), null);
  assert.ok(ctx.needsLookup(card("a", { needs: '["s:2"]', leech_lapses: 2 }), "t1"));
  ctx.IS_SERVER = false;
  assert.equal(ctx.needsLookup(card("a", { needs: '["s:2"]', leech_lapses: 2 }), "t1"), null);
  ctx.IS_SERVER = true;
});

test("weak prerequisites not seen yet are offered; none left, it simply moves on", async () => {
  const a = card("a"), seen = card("seen");
  ctx.state = { studyIndex: 1, studyCards: [seen, a, card("next")] };
  ctx.state.fcNeedsOffer = { card: a, index: 1, attemptId: "t1",
    promise: Promise.resolve({ cards: [card("seen", { weak: true }), card("w", { weak: true }), card("ok", { weak: false })] }) };
  ctx.advanced = 0; ctx.offered = null;
  ctx.advanceOrOfferNeeds(400);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ctx.offered, ["w"]);
  assert.equal(ctx.advanced, 0, "waits for the answer");

  ctx.state.fcNeedsOffer = { card: a, index: 1, attemptId: "t2", promise: Promise.resolve({ cards: [card("ok", { weak: false })] }) };
  ctx.offered = null;
  ctx.advanceOrOfferNeeds(400);
  await new Promise((r) => setImmediate(r));
  assert.equal(ctx.offered, null);
  assert.equal(ctx.advanced, 1);

  ctx.state.fcNeedsOffer = { card: a, index: 1, attemptId: "t3", promise: Promise.reject(new Error("offline")) };
  ctx.advanceOrOfferNeeds(400);
  await new Promise((r) => setImmediate(r));
  assert.equal(ctx.advanced, 2, "a failed lookup never holds the session");

  ctx.state.fcUndoneAttempt = "t4";
  ctx.state.fcNeedsOffer = { card: a, index: 1, attemptId: "t4", promise: Promise.resolve({ cards: [card("w", { weak: true })] }) };
  ctx.offered = null;
  ctx.advanceOrOfferNeeds(400);
  await new Promise((r) => setImmediate(r));
  assert.equal(ctx.offered, null, "an undone grade offers nothing");
});

test("the prerequisites go straight after, then the card again; one already later moves up", () => {
  const a = card("a"), later = card("w2");
  ctx.state = { studyIndex: 1, studyCards: [card("x"), a, card("y"), later, card("z")] };
  ctx.insertNeeds(a, [card("w1"), card("w2", { weak: true })]);
  assert.deepEqual(ctx.state.studyCards.map((c) => c.id), ["x", "a", "w1", "w2", "a", "y", "z"]);
  assert.equal(ctx.state.studyCards[3], later, "the session's own card object is kept");
});

test("the offer is wired into grading, the retype drill, and the summary counts each card once", () => {
  assert.match(extract("markCard"), /state\.fcNeedsOffer = !known \? needsLookup\(card, undo\.attemptId\) : null;/);
  assert.match(extract("markCard"), /advanceOrOfferNeeds\(advanceDelay\);/);
  assert.match(extract("completeForcedRetype"), /advanceOrOfferNeeds\(state\.fcRetypeAdvanceDelay\);/);
  assert.match(extract("showFlashcardSummary"), /\n  state\.studyCards = uniqueCards\(state\.studyCards\);/);
  for (const k of ["study.needsTitle", "study.needsBody", "study.needsSkip", "study.needsStudy"])
    assert.equal(appJs.split('"' + k + '":').length, 3, k + " in English and Vietnamese");
});
