"use strict";
// Book passages on KnowledgeApp cards (cards.source), and retrying the cards missed in a
// session. The endpoint's UPDATE is read from the route and run against an in-memory database.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const { Database } = require("node-sqlite3-wasm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
const integrations = fs.readFileSync(path.join(root, "server", "routes", "integrations.js"), "utf8");

function extract(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}

function fakeEl(tag) {
  return { tag, children: [], id: "", className: "", innerHTML: "", textContent: "",
    appendChild(c) { this.children.push(c); } };
}

const ctx = {
  t: (k) => k,
  escHtml: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"),
  document: { createElement: fakeEl }
};
vm.createContext(ctx);
vm.runInContext("var ICON_BOOK = '<svg/>';" + ["sourcePanel", "missedFlashcards", "missedQuizCards"].map(extract).join(""), ctx);

test("a card with a passage gets a collapsed panel holding it as plain text", () => {
  const el = ctx.sourcePanel({ source: "Costs rose to $5 and <b>then</b> fell." }, "quiz-source");
  assert.equal(el.tag, "details");
  assert.equal(el.id, "quiz-source");
  assert.equal(el.open, undefined);
  const body = el.children[1];
  assert.equal(body.textContent, "Costs rose to $5 and <b>then</b> fell.");
  assert.equal(body.innerHTML, "");
});

test("no passage, no panel", () => {
  assert.equal(ctx.sourcePanel({}), null);
  assert.equal(ctx.sourcePanel({ source: "   " }), null);
  assert.equal(ctx.sourcePanel(null), null);
});

test("the panel follows the explanation on the flashcard back and after a quiz answer, and is cleared per question", () => {
  assert.match(extract("renderFlashcard"), /var fcWhy = whyPanel\(card\);\s*if \(fcWhy\) expContainer\.appendChild\(fcWhy\);/);
  assert.match(extract("renderQuizCard"), /var prevSource = document\.getElementById\("quiz-source"\);\s*if \(prevSource\) prevSource\.remove\(\);/);
  assert.match(extract("renderQuizCard"), /priorResult && sourcePanel\(card, "quiz-source"\)/);
  assert.match(extract("answerQuiz"), /sourcePanel\(card, "quiz-source"\)/);
});

test("missed means Learning in flashcards and wrong in a quiz", () => {
  const cards = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const log = { a: "learning", b: "hard", c: "known" };
  assert.deepEqual(ctx.missedFlashcards(cards, log).map((c) => c.id), ["a"]);
  const results = [{ card: { id: "a" }, correct: false }, { card: { id: "b" }, correct: true }];
  assert.deepEqual(ctx.missedQuizCards(results).map((c) => c.id), ["a"]);
  assert.deepEqual(ctx.missedQuizCards([]), []);
});

test("both session-end screens have the retry-missed button, bound to M", () => {
  assert.match(html, /id="btn-results-missed"/);
  assert.match(html, /id="btn-summary-missed"/);
  assert.match(app, /e\.key === "m" \|\| e\.key === "M"\) document\.getElementById\("btn-results-missed"\)\.click\(\)/);
  assert.match(app, /e\.key === "m" \|\| e\.key === "M"\) document\.getElementById\("btn-summary-missed"\)\.click\(\)/);
  assert.equal(app.split('"results.retryMissed":').length - 1, 2);
});

test("a quiz retry of missed cards still draws wrong answers from the whole session", () => {
  assert.match(extract("quizDistractors"), /state\.quizCards\.concat\(state\.quizPool \|\| \[\], state\.currentLessonCards \|\| \[\]\)/);
  assert.match(app, /state\.quizPool = \(state\.quizPool \|\| \[\]\)\.concat\(state\.quizCards\);\s*state\.quizCards = shuffle\(missed\);/);
  assert.match(extract("startStudy"), /state\.quizPool\s+= null;/);
});

test("the sources endpoint sets the passage only on this user's linked cards", () => {
  const route = integrations.slice(integrations.indexOf('router.post("/sources"'));
  const handler = route.slice(0, route.indexOf("\n});") + 4);
  const sql = [...handler.matchAll(/db\.prepare\(\s*((?:"[^"]*"\s*\+?\s*)+)\)/g)]
    .map((m) => m[1].split(/"\s*\+\s*"/).join("").replace(/^"|"\s*$/g, ""));
  assert.equal(sql.length, 1);

  const db = new Database();
  db.exec(`CREATE TABLE classes (id TEXT PRIMARY KEY, user_id TEXT);
    CREATE TABLE lessons (id TEXT PRIMARY KEY, class_id TEXT);
    CREATE TABLE cards (id TEXT PRIMARY KEY, lesson_id TEXT, external_id TEXT, source TEXT);
    INSERT INTO classes VALUES ('C1','u1'), ('C2','u2');
    INSERT INTO lessons VALUES ('L1','C1'), ('L2','C2');
    INSERT INTO cards VALUES ('a','L1','s:1',NULL), ('b','L2','s:1',NULL), ('c','L1','s:2',NULL);`);
  const n = db.prepare(sql[0]).run(["The passage.", "s:1", "u1"]).changes;
  assert.equal(n, 1);
  assert.deepEqual(db.all("SELECT id, source FROM cards ORDER BY id"),
    [{ id: "a", source: "The passage." }, { id: "b", source: null }, { id: "c", source: null }]);
  db.close();
  assert.match(fs.readFileSync(path.join(root, "server", "db.js"), "utf8"), /ALTER TABLE cards ADD COLUMN source TEXT/);
});
