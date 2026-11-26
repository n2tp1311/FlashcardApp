"use strict";
// A wrong term-def quiz answer is another card's definition. That card counts as forgotten
// too (Again), the answer records which card was picked, and undo takes both back.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const Module = require("module");
const express = require("express");

const root = path.join(__dirname, "..");
const dbFile = path.join(root, "server", "db.js");

// The real schema and migrations, in memory (as in leech.test.js).
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

const authFile = require.resolve(path.join(root, "server/middleware/auth.js"));
require.cache[authFile] = { id: authFile, filename: authFile, loaded: true,
  exports: { requireAuth(req, res, next) { req.session = { userId: req.get("x-user") }; next(); } } };

const server = express();
server.use(express.json());
server.use("/api/attempts", require(path.join(root, "server/routes/attempts.js")));

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);
db.exec(`
  INSERT INTO users (id, email, name) VALUES ('u1', 'a@x', 'A'), ('u2', 'b@x', 'B');
  INSERT INTO classes (id, user_id, name) VALUES ('k1', 'u1', 'Stats'), ('k2', 'u2', 'Other');
  INSERT INTO lessons (id, class_id, title, format) VALUES ('l1', 'k1', 'Ch 1', 'term-def'), ('l2', 'k2', 'X', 'term-def');
  INSERT INTO cards (id, lesson_id, format, data) VALUES
    ('asked', 'l1', 'term-def', '{"term":"Policy evaluation baselines","def":"all-control, best arm, business rule"}'),
    ('picked', 'l1', 'term-def', '{"term":"Concentration","def":"attention to the ball''s sound"}'),
    ('fresh', 'l1', 'term-def', '{"term":"Never seen","def":"unseen def"}'),
    ('theirs', 'l2', 'term-def', '{"term":"t","def":"d"}');
`);

function known(cardId, dueIn) {
  db.prepare("DELETE FROM card_states WHERE card_id = ? AND user_id = 'u1'").run(cardId);
  db.prepare(
    "INSERT INTO card_states (card_id, user_id, srs_due_at, fsrs_stability, fsrs_difficulty, fsrs_state, fsrs_reps, " +
    "fsrs_lapses, fsrs_learning_steps, fsrs_last_review_at) VALUES (?, 'u1', ?, 30, 5, 2, 6, 0, 0, ?)"
  ).run(cardId, now() + dueIn, now() - 20 * DAY);
}
const stateOf = (cardId) => db.prepare("SELECT srs_due_at, fsrs_state, fsrs_lapses, fsrs_stability FROM card_states WHERE card_id = ? AND user_id = 'u1'").get(cardId);

let base, listener;
test.before(() => new Promise((ok) => { listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); }); }));
test.after(() => listener.close());
let n = 0;
const cid = () => "c" + String(++n).padStart(20, "0");
async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-user": "u1" }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
const answer = (fields) => call("POST", "/api/attempts", Object.assign({ source: "quiz", correct: false, clientId: cid() }, fields));

test("the picked card is counted as forgotten, and the answer says which card it was", async () => {
  known("asked", -60); known("picked", 40 * DAY);
  const id = "c" + "p".repeat(20);
  const r = await answer({ cardId: "asked", pickedCardId: "picked", clientId: id });
  assert.equal(r.status, 201);
  const s = stateOf("picked");
  assert.equal(s.fsrs_lapses, 1, "a lapse on the picked card");
  assert.equal(s.fsrs_state, 3, "relearning");
  assert.ok(s.srs_due_at < now() + DAY, "back within the day, not in 40 days");
  assert.deepEqual(r.body.picked, { cardId: "picked", srs_due_at: s.srs_due_at });
  const row = db.prepare("SELECT picked_card_id, picked_prev_state FROM attempts WHERE id = ?").get(id);
  assert.equal(row.picked_card_id, "picked");
  assert.ok(row.picked_prev_state);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE card_id = 'picked'").get().n, 0,
    "no answer of its own: one question is one answer in every count");
});

test("undo takes back both, unless the picked card has been answered since", async () => {
  known("asked", -60); known("picked", 40 * DAY);
  const before = stateOf("picked");
  const id = cid();
  await answer({ cardId: "asked", pickedCardId: "picked", clientId: id });
  assert.equal((await call("DELETE", "/api/attempts/" + id)).status, 200);
  assert.deepEqual(stateOf("picked"), before);

  known("asked", -60);
  const id2 = cid();
  await answer({ cardId: "asked", pickedCardId: "picked", clientId: id2 });
  await answer({ cardId: "picked", correct: true });
  const after = stateOf("picked");
  assert.equal((await call("DELETE", "/api/attempts/" + id2)).status, 200);
  assert.deepEqual(stateOf("picked"), after, "its own later answer stands");
});

test("nothing changes for a cram answer, a card never studied, a right answer, or another user's card", async () => {
  known("asked", 5 * DAY); known("picked", 40 * DAY);
  const before = stateOf("picked");
  const cram = await answer({ cardId: "asked", pickedCardId: "picked" });
  assert.equal(cram.body.notDue, true);
  assert.deepEqual(stateOf("picked"), before, "the asked card was not due: cramming stays harmless");

  known("asked", -60);
  const unseen = await answer({ cardId: "asked", pickedCardId: "fresh" });
  assert.equal(unseen.body.picked, null);
  assert.equal(stateOf("fresh"), null, "picking an unseen card's definition is not forgetting it");
  assert.equal(db.prepare("SELECT picked_card_id FROM attempts ORDER BY rowid DESC LIMIT 1").get().picked_card_id, "fresh", "still recorded");

  known("asked", -60);
  await answer({ cardId: "asked", pickedCardId: "picked", correct: true });
  known("asked", -60);
  await answer({ cardId: "asked", pickedCardId: "theirs" });
  known("asked", -60);
  await answer({ cardId: "asked", pickedCardId: "asked" });
  assert.deepEqual(stateOf("picked"), before);
  assert.deepEqual(db.prepare("SELECT picked_card_id FROM attempts ORDER BY rowid DESC LIMIT 3").all().map((r) => r.picked_card_id), [null, null, null]);
});

// The quiz's side: which card a wrong option came from.
const appJs = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
function extract(name) {
  const start = appJs.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return appJs.slice(start, appJs.indexOf("\n}\n", start) + 3);
}
test("the quiz names the card a wrong definition came from, and sends it", () => {
  const ctx = { state: {} };
  vm.createContext(ctx);
  vm.runInContext(extract("quizPickedCardId"), ctx);
  const c = (id, def, format = "term-def") => ({ id, format, data: { def } });
  ctx.state = { quizCards: [c("a", "A"), c("b", "B")], quizPool: [c("i", "B", "image-def"), c("b2", "B")], currentLessonCards: [c("d", "D")] };
  assert.equal(ctx.quizPickedCardId(ctx.state.quizCards[0], "B"), "b", "the first in the pool's order, of the same format");
  assert.equal(ctx.quizPickedCardId(ctx.state.quizCards[0], "D"), "d");
  assert.equal(ctx.quizPickedCardId(ctx.state.quizCards[0], "A"), null, "never the asked card");
  assert.equal(ctx.quizPickedCardId({ id: "m", format: "mcq", data: {} }, "B"), null, "an MCQ's wrong options are not cards");
  assert.match(extract("answerQuiz"), /var pickedId = !isCorrect && quizPickedCardId\(card, selectedVal\);\n  if \(pickedId\) quizAttemptFields\.pickedCardId = pickedId;/);
  assert.match(appJs, /if \(f\.pickedCardId\) body\.pickedCardId = f\.pickedCardId;/);
});
