const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
const stats = fs.readFileSync(path.join(root, "server", "routes", "stats.js"), "utf8");

function extract(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}

function load(goal) {
  const ctx = {
    state: { dailyGoal: goal, language: "en" },
    t: function(k, v) { return k + (v ? "|" + Object.keys(v).map(function(x) { return x + "=" + v[x]; }).join(",") : ""); },
    escHtml: function(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  };
  vm.createContext(ctx);
  vm.runInContext("var GOAL_RING_R = 22; var ICON_TODAY_TIME = '', ICON_TODAY_NEW = '', ICON_TODAY_REVIEW = '';" +
    "function formatStudyDuration(ms) { return Math.round(ms / 60000) + ' min'; }" +
    extract("dailyGoalRing") + extract("weekdayLabel") + extract("todayStripHtml") + extract("todayChipsHtml"), ctx);
  return ctx;
}

const week = ["done", "done", "rest", "done", "today", "future", "future"].map(function(status, i) {
  return { day: new Date(Date.UTC(2026, 8, 28 + i)).toISOString().slice(0, 10), status: status, isToday: status === "today" };
});

test("the ring shows progress until the goal, then a gold check", function() {
  const ctx = load(20);
  const part = ctx.todayStripHtml({ count: 14, week: week, restAvailableToday: false });
  assert.match(part, /goal\.progress\|done=14,goal=20/);
  assert.match(part, /goal\.left\|n=6/);
  assert.doesNotMatch(part, /goal-ring met/);
  const met = ctx.todayStripHtml({ count: 25, week: week, restAvailableToday: false });
  assert.match(met, /goal-ring met/);
  assert.match(met, /goal\.met/);
  assert.match(met, /stroke-dashoffset:0\.00/, "an overshoot still draws a full ring, not past it");
});

test("goal Off hides the ring but keeps the week row", function() {
  const out = load(0).todayStripHtml({ count: 5, week: week, restAvailableToday: false });
  assert.doesNotMatch(out, /goal-ring/);
  assert.match(out, /dash-week/);
  assert.match(out, /no-goal/);
});

test("the week row marks each day and explains rest days only when one is in play", function() {
  const ctx = load(20);
  const out = ctx.todayStripHtml({ count: 1, week: week, restAvailableToday: false });
  assert.equal((out.match(/class="dash-week-dot/g) || []).length, 7);
  assert.match(out, /is-rest">❄/);
  assert.match(out, /dash-week-dot is-today"/);
  const studied = week.map(function(d) { return d.isToday ? Object.assign({}, d, { status: "done" }) : d; });
  assert.match(ctx.todayStripHtml({ count: 1, week: studied }), /dash-week-dot is-done is-today">✓/);
  assert.match(out, /week\.restHint/);
  const plain = week.map(function(d) { return Object.assign({}, d, { status: d.status === "rest" ? "done" : d.status }); });
  assert.doesNotMatch(ctx.todayStripHtml({ count: 1, week: plain, restAvailableToday: false }), /week\.restHint/);
  assert.match(ctx.todayStripHtml({ count: 1, week: plain, restAvailableToday: true }), /week\.restHint/);
});

test("no today data (local mode, old server) renders nothing", function() {
  assert.equal(load(20).todayStripHtml(undefined), "");
  assert.equal(load(20).todayStripHtml({ count: 3 }), "");
});

test("the streak caption says a rest day is available instead of a false reset countdown", function() {
  const hero = extract("streakTimeHeroCard");
  assert.match(hero, /today && today\.restAvailableToday/);
  assert.match(hero, /stat\.restDayAvailable/);
});

test("Daily goal is a saved preference, 20 by default, both languages", function() {
  assert.match(app, /\n  dailyGoal: 20,\n/);
  assert.match(html, /id="pref-daily-goal"[\s\S]{0,200}data-value="0"/);
  assert.match(app, /dailyGoal: dailyGoal, quizCountsAsKnown/);
  assert.match(app, /typeof prefs\.dailyGoal === "number"/);
  for (const k of ["goal.progress", "goal.left", "goal.met", "week.restHint", "pref.dailyGoal", "stat.restDayAvailable"]) {
    assert.equal(app.split('"' + k + '":').length - 1, 2, k);
  }
});

test("dashboard and /today share one computation, so Home and the session end agree", function() {
  assert.match(stats, /const today = todayStats\(uid\);\n  const streak = today\.streak;/);
  assert.match(stats, /router\.get\("\/today", requireAuth/);
  assert.doesNotMatch(stats, /let streak = 0;/, "the old streak loop must be gone");
});

test("chips show time, new cards against the recommendation and reviews against the cap", function() {
  const ctx = load(20);
  ctx.state.maxReviewsPerDay = 300;
  const html = ctx.todayStripHtml({ count: 281, week: week, activity: { studyMs: 47 * 60000, newCards: 12, reviews: 269 } }, 15);
  assert.match(html, /<b>47 min<\/b> today\.studied/);
  assert.match(html, /<b>12 \/ 15<\/b> today\.newCards/);
  assert.match(html, /<b>269 \/ 300<\/b> today\.reviews/);
});

test("with no cap and no estimate the counts stand alone; a cap of 0 is still a cap", function() {
  const ctx = load(20);
  ctx.state.maxReviewsPerDay = null;
  const html = ctx.todayStripHtml({ count: 3, week: week, activity: { studyMs: 0, newCards: 2, reviews: 1 } }, null);
  assert.match(html, /<b>2<\/b> today\.newCards/);
  assert.match(html, /<b>1<\/b> today\.reviews/);
  ctx.state.maxReviewsPerDay = 0;
  assert.match(ctx.todayStripHtml({ count: 3, week: week, activity: { studyMs: 0, newCards: 2, reviews: 1 } }, null), /<b>1 \/ 0<\/b>/);
});

test("the review cap and the Home chip count reviews the same way", function() {
  assert.match(stats, /router\.get\("\/reviews-today"[\s\S]{0,200}todayActivity\(req\.session\.userId\)\.reviews/);
  assert.match(stats, /activity: todayActivity\(uid\)/);
});

const { summarizeToday } = require("../server/lib/today");

test("a card is new on the day of its first answer; later days' answers are reviews", function() {
  const s = summarizeToday([
    { card_id: "a", duration_ms: 4000, seen_before: 0 },
    { card_id: "a", duration_ms: 3000, seen_before: 0 },
    { card_id: "b", duration_ms: 5000, seen_before: 1 },
    { card_id: "b", duration_ms: null, seen_before: 1 },
    { card_id: "c", duration_ms: 2000, seen_before: 0 }
  ]);
  assert.deepEqual(s, { studyMs: 14000, newCards: 2, reviews: 2 });
});
