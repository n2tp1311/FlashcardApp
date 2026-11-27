"use strict";
// The leech dialog names a likely cause and the fix for it, and a rewrite request carries the
// cause to KnowledgeApp so the rewrite addresses it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const express = require("express");

const root = path.join(__dirname, "..");
const dbFile = path.join(root, "server", "db.js");

// The real schema and migrations, in memory: db.js opens data/flashcards.db and clears its
// lock, which must not touch a running dev server's database.
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

function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub("server/middleware/auth.js", {
  requireAuth(req, res, next) { req.session = { userId: req.get("x-user") }; next(); }
});
stub("server/middleware/apiToken.js", {
  requireApiToken(req, res, next) { req.userId = req.get("x-user"); next(); },
  hashToken: (t) => t
});

const server = express();
server.use(express.json());
server.use("/api/integrations/knowledge", require(path.join(root, "server/routes/integrations.js")));
server.use("/api", require(path.join(root, "server/routes/cards.js")));

const long = Array.from({ length: 45 }, (_, i) => "word" + i).join(" ");
db.exec(`
  INSERT INTO users (id, email, name) VALUES ('u1', 'a@x', 'A');
  INSERT INTO classes (id, user_id, name) VALUES ('k1', 'u1', 'Stats');
  INSERT INTO lessons (id, class_id, title, format) VALUES ('l1', 'k1', 'Ch 1', 'term-def');
  INSERT INTO cards (id, lesson_id, format, data, external_id, needs) VALUES
    ('mix', 'l1', 'term-def', '{"term":"Overfitting","def":"learns the noise"}', 'b:1', '["b:9"]'),
    ('par', 'l1', 'term-def', '{"term":"Underfitting","def":"too simple"}', 'b:2', NULL),
    ('ned', 'l1', 'term-def', '{"term":"Uplift","def":"effect of treatment"}', 'b:3', '["b:9","b:8"]'),
    ('lng', 'l1', 'term-def', '{"term":"Van Westendorp","def":"${long}"}', 'b:4', NULL),
    ('unc', 'l1', 'term-def', '{"term":"Concentration","def":"attention to the ball"}', 'b:5', NULL),
    ('w9', 'l1', 'term-def', '{"term":"Treatment effect","def":"d"}', 'b:9', NULL),
    ('k8', 'l1', 'term-def', '{"term":"Known well","def":"d"}', 'b:8', NULL);
  INSERT INTO card_states (card_id, user_id, srs_due_at, fsrs_state) VALUES ('k8', 'u1', unixepoch() + 864000, 2);
  INSERT INTO attempts (id, card_id, user_id, correct, source, picked_card_id) VALUES
    ('a1', 'mix', 'u1', 0, 'quiz', 'par'), ('a2', 'par', 'u1', 0, 'quiz', 'mix');
`);

let base, listener;
test.before(() => new Promise((ok) => { listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); }); }));
test.after(() => listener.close());
async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-user": "u1" }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

test("the cause: mixed up first, then weak base cards, then a long back, else none found", async () => {
  const mix = (await call("GET", "/api/cards/mix/leech-cause")).body;
  assert.equal(mix.cause, "mixed", "a mixed-up pair wins over a weak base card");
  assert.deepEqual([mix.partner.id, mix.partner.data.term, mix.partner.n], ["par", "Underfitting", 2]);
  const ned = (await call("GET", "/api/cards/ned/leech-cause")).body;
  assert.equal(ned.cause, "needs");
  assert.deepEqual(ned.needs.map((c) => c.id), ["w9"], "only the weak ones: a card in review and not due is known");
  assert.deepEqual((await call("GET", "/api/cards/lng/leech-cause")).body, { cause: "long", words: 45 });
  assert.deepEqual((await call("GET", "/api/cards/unc/leech-cause")).body, { cause: "unclear", words: 4 });
  assert.equal((await call("GET", "/api/cards/nope/leech-cause")).status, 404);
});

test("a leech rewrite request carries its cause to KnowledgeApp; a flag does not", async () => {
  assert.equal((await call("POST", "/api/cards/mix/rewrite-request")).status, 201);
  assert.equal((await call("POST", "/api/cards/lng/rewrite-request")).status, 201);
  assert.equal((await call("POST", "/api/cards/unc/rewrite-request", { issues: ["front"] })).status, 201);
  const q = (await call("GET", "/api/integrations/knowledge/rewrites")).body.requests;
  const by = Object.fromEntries(q.map((r) => [r.external_id, r]));
  assert.equal(by["b:1"].cause, "mixed");
  assert.deepEqual(by["b:1"].cause_detail, { term: "Underfitting", def: "too simple", times: 2 });
  assert.deepEqual([by["b:4"].cause, by["b:4"].cause_detail], ["long", { words: 45 }]);
  assert.deepEqual([by["b:5"].cause, by["b:5"].cause_detail], [null, null], "a flag says its own issue");
});

test("the dialog names the cause and offers its fix, in the real page", async () => {
  const { chromium } = require("playwright");
  const app = express();
  app.use(express.static(path.join(root, "client")));
  const l = await new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:" + l.address().port + "/");
    await page.waitForFunction(() => typeof window.showLeechCause === "function");
    const r = await page.evaluate(async () => {
      const card = { id: "mix", format: "term-def", external_id: "b:1", leech_lapses: 8, data: { term: "Overfitting", def: "learns the noise in the data" } };
      const vis = (id) => !document.getElementById(id).classList.contains("hidden");
      const out = {};
      state.leechPrompt = { card, fromStudy: false };
      showLeechCause(null);
      out.plain = { cause: vis("leech-cause"), fix: vis("btn-leech-fix"), body: document.getElementById("leech-body").textContent };

      showLeechCause({ cause: "mixed", partner: { id: "par", data: { term: "Underfitting", def: "too simple for the data" }, n: 3 } });
      out.mixed = { head: document.getElementById("leech-cause-head").textContent, body: document.getElementById("leech-cause-body").textContent,
        fix: document.getElementById("btn-leech-fix").textContent, editPrimary: document.getElementById("btn-leech-edit").classList.contains("btn-primary") };
      document.getElementById("btn-leech-fix").click();
      out.compared = [...document.querySelectorAll("#leech-cause .quiz-compare-term")].map((e) => e.textContent);
      out.fixAfter = vis("btn-leech-fix");

      const weak = [{ id: "w9", data: { term: "Treatment effect" } }];
      let launched = null;
      window.launchStudy = (cards, mode) => { launched = [cards.map((c) => c.id), mode]; };
      showLeechCause({ cause: "needs", needs: weak });
      out.needs = { head: document.getElementById("leech-cause-head").textContent, fix: document.getElementById("btn-leech-fix").textContent,
        compareGone: !document.querySelector("#leech-cause .quiz-compare") };
      document.getElementById("btn-leech-fix").click();
      out.launched = launched;

      state.leechPrompt = { card, fromStudy: true };
      showScreen("quiz");
      showLeechCause({ cause: "needs", needs: weak });
      out.quizFix = vis("btn-leech-fix");

      state.leechPrompt = { card, fromStudy: false };
      showLeechCause({ cause: "long", words: 52 });
      out.long = { body: document.getElementById("leech-cause-body").textContent, rewrite: document.getElementById("btn-leech-rewrite").textContent, fix: vis("btn-leech-fix") };
      return out;
    });
    assert.deepEqual(r.plain, { cause: false, fix: false, body: "You've forgotten it 8 times. Reviewing it again rarely helps. Shortening it, splitting it, or adding an example usually does." },
      "until the cause arrives, or offline, the dialog reads as before");
    assert.deepEqual(r.mixed, { head: "You mix it up with Underfitting", body: "You picked Underfitting for it 3 times. Seeing the two side by side usually fixes this.",
      fix: "Tell them apart", editPrimary: false });
    assert.deepEqual(r.compared, ["Overfitting", "Underfitting"], "compared in the dialog, the session behind it untouched");
    assert.equal(r.fixAfter, false);
    assert.deepEqual(r.needs, { head: "It builds on a card you're not sure of", fix: "Review it first", compareGone: true });
    assert.deepEqual(r.launched, [["w9", "mix"], "flashcard"], "from the card list: the base cards, then this one");
    assert.equal(r.quizFix, false, "a quiz has no place for base cards: the cause is only named");
    assert.deepEqual(r.long, { body: "52 words. A long answer is hard to recall whole. Keeping only what the front asks for usually helps.",
      rewrite: "Ask KnowledgeApp to shorten it", fix: false });
  } finally { await browser.close(); l.close(); }
  const appJs = fs.readFileSync(path.join(root, "client/app.js"), "utf8");
  assert.match(appJs, /state\.fcNeedsOffer = null;\n    insertNeeds\(p\.card, cause\.needs\);/, "in a flashcard session the base cards join it, and the session's own offer does not ask again");
});
