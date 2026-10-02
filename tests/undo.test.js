const assert = require("node:assert/strict");
const { test } = require("node:test");
const { snapshotState, restoredState, undoRefusal, NEVER_SCHEDULED, UNDO_WINDOW_SEC } = require("../server/lib/undo");

const row = {
  srs_due_at: 1800000000, fsrs_stability: 3.2, fsrs_difficulty: 5.1, fsrs_state: 2, fsrs_reps: 4,
  fsrs_lapses: 1, fsrs_learning_steps: 0, fsrs_last_review_at: 1799000000, last_correct_source: "flashcard"
};

test("a scheduled card comes back exactly as it was", function() {
  assert.deepEqual(restoredState(snapshotState(row, false)), row);
});

test("a card answered for the first time goes back to never scheduled", function() {
  assert.deepEqual(restoredState(snapshotState(undefined, false)), NEVER_SCHEDULED);
});

test("a not-yet-due answer changed no schedule, so undo restores none", function() {
  assert.equal(restoredState(snapshotState(row, true)), null);
});

test("only the latest answer, within the window, recorded with a snapshot, can be undone", function() {
  const now = 2000000000;
  const attempt = { created_at: now - 30, prev_state: snapshotState(row, false) };
  assert.equal(undoRefusal(attempt, now, false), null);
  assert.equal(undoRefusal(undefined, now, false), "not_found");
  assert.equal(undoRefusal(attempt, now, true), "not_latest");
  assert.equal(undoRefusal({ created_at: now - UNDO_WINDOW_SEC - 1, prev_state: attempt.prev_state }, now, false), "too_old");
  assert.equal(undoRefusal({ created_at: now, prev_state: null }, now, false), "not_undoable",
    "an answer recorded before prev_state existed has nothing to restore");
});

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const app = fs.readFileSync(path.join(__dirname, "..", "client", "app.js"), "utf8");

function extract(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}

test("undoing a grade puts the session back: log, known map, time and due date", function() {
  const card = { id: "a", srs_due_at: 999 };
  const other = { id: "b" };
  const state = {
    studyCards: [other, card], studyKnownMap: { a: true }, studySessionLog: { a: "confident", b: "known" },
    sessionMs: 9000, sessionDurations: [4000, 5000]
  };
  const ctx = { state: state };
  vm.createContext(ctx);
  vm.runInContext(extract("restoreGradedCard"), ctx);
  const index = ctx.restoreGradedCard({ card: card, prevKnown: undefined, prevLog: undefined, prevDue: null, sessionMs: 5000 });
  assert.equal(index, 1);
  assert.deepEqual(Object.keys(state.studyKnownMap), []);
  assert.deepEqual(JSON.parse(JSON.stringify(state.studySessionLog)), { b: "known" });
  assert.equal(state.sessionMs, 4000);
  assert.deepEqual(Array.from(state.sessionDurations), [4000]);
  assert.equal(card.srs_due_at, null);
});

test("the answer carries the id the undo deletes, and the undo is queued behind it", function() {
  const mark = extract("markCard");
  assert.match(mark, /clientId: undo\.attemptId/);
  assert.match(mark, /offerGradeUndo\(undo/);
  assert.match(app, /undoAttempt: function\(id\) \{\n      return queuedWrite\(\{ method: "DELETE", path: "\/attempts\/" \+ encodeURIComponent\(id\), body: \{\} \}\);/);
  assert.match(app, /clientId: f\.clientId \|\| newClientId\(\)/);
});

test("the attempts table keeps the snapshot column, added after the rebuild that lists columns", function() {
  const db = fs.readFileSync(path.join(__dirname, "..", "server", "db.js"), "utf8");
  const at = db.indexOf('ALTER TABLE attempts ADD COLUMN prev_state TEXT');
  assert.ok(at > db.indexOf('runMigration("attempts_drop_card_fk"'));
});
