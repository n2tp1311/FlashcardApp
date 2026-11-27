"use strict";
// Scenario cards: KnowledgeApp adds a book's scenario questions as mcq cards in a lesson of
// their own, and a term-def lesson holding them still studies them as multiple choice.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const express = require("express");

const root = path.join(__dirname, "..");
const dbFile = path.join(root, "server", "db.js");

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

db.exec(`
  INSERT INTO users (id, email, name) VALUES ('u1', 'a@x', 'A');
  INSERT INTO classes (id, user_id, name) VALUES ('k1', 'u1', 'Deep Learning');
  INSERT INTO lessons (id, class_id, title, format) VALUES ('l1', 'k1', '7. Regularization', 'term-def');
  INSERT INTO lessons (id, class_id, title, format) VALUES ('l2', 'k1', '8. Optimization', 'term-def');
  INSERT INTO cards (id, lesson_id, format, data, sort_order, external_id) VALUES
    ('t1', 'l2', 'term-def', '{"term":"Momentum","def":"Accumulates past gradients."}', 0, 's:40'),
    ('t2', 'l2', 'term-def', '{"term":"Adam","def":"Adaptive moments."}', 1, 's:41');
`);

let base, listener;
test.before(() => new Promise((ok) => { listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); }); }));
test.after(() => listener.close());

async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-user": "u1" }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
const add = (cards) => call("POST", "/api/integrations/knowledge/add-cards", { class_id: "k1", cards });
const MCQ = { question: "A store tags a sofa 'was 2,400 dollars, now 1,199'. Which idea applies?", correct: "Reference Pricing",
  distractors: ["Bonus framing effect", "Underreaction", "Calendar Anomalies"], explanation: "The inflated price is the reference point." };

test("add-cards puts scenario questions in a lesson of their own, as mcq cards; a replay adds nothing", async () => {
  const r = await add([{ external_id: "s:s1", mcq: { ...MCQ, correct: " Reference Pricing " }, new_lesson_title: "Scenarios" },
                       { external_id: "s:s2", mcq: { question: "Q2?", correct: "Adam", distractors: ["Momentum"] }, new_lesson_title: "Scenarios" }]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.added, 2);
  assert.deepEqual(r.body.lessons.map((l) => [l.title, l.created]), [["Scenarios", true]]);
  const rows = db.prepare("SELECT c.format, c.data, l.title, l.sort_order FROM cards c JOIN lessons l ON l.id = c.lesson_id WHERE c.external_id LIKE 's:s%' ORDER BY c.sort_order").all();
  assert.deepEqual(rows.map((x) => x.format), ["mcq", "mcq"]);
  assert.deepEqual(JSON.parse(rows[0].data), MCQ, "trimmed, explanation kept");
  assert.ok(rows[0].sort_order > db.prepare("SELECT MAX(sort_order) AS m FROM lessons WHERE id IN ('l1', 'l2')").get().m, "after the book's lessons");
  const again = await add([{ external_id: "s:s1", mcq: MCQ, new_lesson_title: "Scenarios" },
                           { external_id: "s:s3", mcq: MCQ, new_lesson_title: "Scenarios" }]);
  assert.equal(again.body.exists, 1);
  assert.deepEqual(again.body.lessons.map((l) => l.created), [false], "the next run fills the same lesson");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE title = 'Scenarios'").get().n, 1);
});

test("a scenario needs a question, an answer and 1-4 wrong answers, and nothing else on the item", async () => {
  for (const bad of [{ ...MCQ, correct: " " }, { ...MCQ, distractors: [] }, { ...MCQ, distractors: ["a", "b", "c", "d", "e"] },
                     { ...MCQ, distractors: "a" }, { ...MCQ, explanation: 3 }]) {
    const r = await add([{ external_id: "s:bad", mcq: bad, new_lesson_title: "Scenarios" }]);
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  const mixed = await add([{ external_id: "s:bad", mcq: MCQ, term: "x", def: "y", lesson_id: "l1" }]);
  assert.equal(mixed.status, 400);
});

test("an updated event carrying mcq never touches a card", async () => {
  const r = await call("POST", "/api/integrations/knowledge/events", { events: [
    { id: "e1", type: "updated", external_id: "s:40", mcq: MCQ },
    { id: "e2", type: "updated", external_id: "s:s1", mcq: { ...MCQ, question: "changed?" } }] });
  assert.deepEqual(r.body.results.map((x) => x.status), ["noop", "noop"]);
  assert.equal(JSON.parse(db.prepare("SELECT data FROM cards WHERE external_id = 's:40'").get().data).term, "Momentum");
});

test("in the real page, a term-def lesson's mcq card quizzes as multiple choice and shows as a flashcard", async () => {
  const { chromium } = require("playwright");
  const app = express();
  app.use(express.static(path.join(root, "client")));
  const l = await new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:" + l.address().port + "/");
    await page.waitForFunction(() => typeof window.startQuiz === "function");
    const r = await page.evaluate((mcq) => {
      const cards = [{ id: "m1", lesson_id: "ls", format: "mcq", data: mcq }];
      state.currentLesson = { id: "ls", title: "Scenarios", format: "term-def" };
      state.quizCards = cards; startQuiz();
      const out = { options: state.quizOptions.slice().sort() };
      state.studyCards = cards; state.studyIndex = 0; startFlashcards();
      out.front = document.querySelector(".fc-front").textContent;
      return out;
    }, MCQ);
    assert.deepEqual(r.options, ["Bonus framing effect", "Calendar Anomalies", "Reference Pricing", "Underreaction"]);
    assert.match(r.front, /Which idea applies/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); l.close(); }
});
