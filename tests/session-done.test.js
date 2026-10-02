const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..", "client");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function extract(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}

const ctx = {
  state: {},
  t: function(k, v) { return k + (v ? "|" + Object.keys(v).map(function(x) { return x + "=" + v[x]; }).join(",") : ""); }
};
vm.createContext(ctx);
vm.runInContext("var SESSION_CARD_MAX_MS = 5 * 60 * 1000; var STREAK_MILESTONES = [7, 14, 30, 50, 100, 200, 365, 500, 1000];" +
  ["addSessionTime", "formatSessionTime", "sessionHeadline", "sessionCheers"].map(extract).join(""), ctx);

test("session time sums answers, each capped at five minutes", function() {
  ctx.state.sessionMs = 0;
  ctx.addSessionTime(12000);
  ctx.addSessionTime(60 * 60 * 1000);
  ctx.addSessionTime(undefined);
  ctx.addSessionTime(-5);
  assert.equal(ctx.state.sessionMs, 12000 + 5 * 60 * 1000);
  assert.equal(ctx.formatSessionTime(ctx.state.sessionMs), "5:12");
  assert.equal(ctx.formatSessionTime(0), "0:00");
});

test("the headline follows the result", function() {
  assert.equal(ctx.sessionHeadline(1), "done.perfect");
  assert.equal(ctx.sessionHeadline(0.8), "done.great");
  assert.equal(ctx.sessionHeadline(0.79), "done.complete");
});

test("the day's first session ticks the streak; a later one does not", function() {
  const first = ctx.sessionCheers({ studiedToday: false, streak: 9, count: 0 }, { studiedToday: true, streak: 10, count: 6 }, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), [{ kind: "streak", text: "done.streak|from=9,to=10" }]);
  assert.deepEqual(ctx.sessionCheers({ studiedToday: true, streak: 10, count: 6 }, { studiedToday: true, streak: 10, count: 12 }, 0).length, 0);
});

test("milestones replace the plain tick", function() {
  const m = ctx.sessionCheers({ studiedToday: false, streak: 6, count: 0 }, { studiedToday: true, streak: 7, count: 3 }, 0);
  assert.equal(m[0].kind, "milestone");
  assert.equal(m[0].text, "done.streakMilestone|n=7");
});

test("the goal line shows only on the session that crosses it, and not when the goal is off", function() {
  const before = { studiedToday: true, streak: 3, count: 15 };
  assert.equal(ctx.sessionCheers(before, { studiedToday: true, streak: 3, count: 22 }, 20)[0].kind, "goal");
  assert.equal(ctx.sessionCheers({ studiedToday: true, streak: 3, count: 21 }, { studiedToday: true, streak: 3, count: 30 }, 20).length, 0);
  assert.equal(ctx.sessionCheers(before, { studiedToday: true, streak: 3, count: 22 }, 0).length, 0);
  assert.equal(ctx.sessionCheers(null, { studiedToday: true, streak: 3, count: 22 }, 20).length, 0, "no start snapshot, no claims");
});

test("both end screens are wired, and the start snapshot is taken for both modes", function() {
  assert.match(html, /id="results-done"/);
  assert.match(html, /id="summary-done"/);
  assert.match(extract("startFlashcards"), /beginStudySession\(\)/);
  assert.match(extract("startQuiz"), /beginStudySession\(\)/);
  assert.match(extract("showFlashcardSummary"), /renderSessionDone\("summary-done"/);
  assert.match(extract("showQuizResults"), /renderSessionDone\("results-done"/);
  // Queued answers must land before today's numbers are re-read.
  assert.match(extract("renderSessionDone"), /store\.writesSettled\(\)\.then\(function\(\) \{\s*return Promise\.all\(\[\s*before \? store\.getToday\(\) : null,\s*achBefore \? refreshAchievements\(\)/);
  for (const k of ["done.perfect", "done.streak", "done.streakMilestone", "done.goalMet", "done.bestRun"]) {
    assert.equal(app.split('"' + k + '":').length - 1, 2, k);
  }
});
