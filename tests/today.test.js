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
  vm.runInContext("var GOAL_RING_R = 22; var ICON_TODAY_TIME = '', ICON_TODAY_NEW = '', ICON_TODAY_REVIEW = '', ICON_FLAME = '', ICON_SETTINGS = '';" +
    "var DASH_METRICS = [{ key: 'classes', labelKey: 'stat.classes' }, { key: 'lessons', labelKey: 'stat.lessons' }, { key: 'cards', labelKey: 'stat.cards' }, { key: 'attempts', labelKey: 'stat.attempts' }, { key: 'sessions', labelKey: 'stat.sessions' }];" +
    "var DEFAULT_DASH_METRIC_CONFIG = { streak: 'show' };" +
    "function formatStudyDuration(ms) { return Math.round(ms / 60000) + ' min'; }" +
    "function _streakResetCountdownText() { return 'resets'; }" +
    "function _dashMetricHint() { return 'hint'; }" +
    ["dailyGoalRing", "weekdayLabel", "heroWeekHtml", "streakTimeHeroCard", "heroStreakTile", "heroTodayTile",
     "heroMeter", "heroStudyTimeTile", "studySparkline", "heroAboveAvgHtml"].map(extract).join(""), ctx);
  return ctx;
}

const week = ["done", "done", "rest", "done", "today", "future", "future"].map(function(status, i) {
  return { day: new Date(Date.UTC(2026, 8, 28 + i)).toISOString().slice(0, 10), status: status, isToday: status === "today" };
});

test("the streak caption says a rest day is available instead of a false reset countdown", function() {
  const ctx = load(20);
  assert.match(ctx.heroStreakTile(5, { count: 0, restAvailableToday: true }), /stat\.restDayAvailable/);
  const plain = ctx.heroStreakTile(5, { count: 0, restAvailableToday: false });
  assert.doesNotMatch(plain, /stat\.restDayAvailable/);
  assert.match(plain, /data-countdown="streak"/);
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

const summary = { classes: 10, lessons: 3, cards: 12, attempts: 177, quizSessions: 0 };
const activity = { studyMs: 105 * 60000, newCards: 44, reviews: 212 };
const studyTime = { totalMs: 33 * 3600000, avgDailyMs: 64 * 60000, minDailyMs: 27 * 60000, maxDailyMs: 127 * 60000, windowDays: 30,
  daily: [{ day: "2026-09-30", ms: 3600000 }, { day: "2026-10-01", ms: 0 }, { day: "2026-10-02", ms: 6300000 }] };

function hero(ctx, today, extra) {
  return ctx.streakTimeHeroCard(108, Object.assign({}, studyTime, extra && extra.studyTime), summary, { estimatedNewCards: 57 }, today);
}

test("the hero card is three tiles: streak, today, study-time window", function() {
  const ctx = load(20);
  ctx.state.maxReviewsPerDay = 300;
  const out = hero(ctx, { count: 281, week: week, activity: activity });
  assert.equal((out.match(/<section class="dash-tile"/g) || []).length, 3);
  assert.match(out, /hero\.streak[\s\S]*hero\.today[\s\S]*hero\.lastDays\|n=30/);
  assert.match(out, /<span class="dash-tile-num">108<\/span>/);
  assert.match(out, /<b>44 \/ 57<\/b>/);
  assert.match(out, /<b>212 \/ 300<\/b>/);
  assert.match(out, /scaleX\(0\.707\)/, "212 of 300 fills 70.7%");
  assert.match(out, /<span class="dash-tile-num">64 min<\/span>/);
  assert.match(out, /<svg class="dash-spark"/);
  assert.match(out, /<b>10<\/b> stat\.classes/);
});

test("the ring shows progress until the goal, then a gold check; goal Off keeps the count", function() {
  const ctx = load(20);
  const part = hero(ctx, { count: 14, week: week, activity: activity });
  assert.match(part, /goal\.progress\|done=14,goal=20/);
  assert.match(part, /goal\.left\|n=6/);
  assert.doesNotMatch(part, /goal-ring met/);
  const met = hero(ctx, { count: 25, week: week, activity: activity });
  assert.match(met, /goal-ring met/);
  assert.match(met, /stroke-dashoffset:0\.00/, "an overshoot still draws a full ring, not past it");
  const off = hero(load(0), { count: 5, week: week, activity: activity });
  assert.doesNotMatch(off, /goal-ring/);
  assert.match(off, /hero\.cardsToday\|n=5/);
  assert.match(off, /dash-week/);
});

test("the week row marks each day and explains rest days only when one is in play", function() {
  const ctx = load(20);
  const out = ctx.heroWeekHtml({ count: 1, week: week, restAvailableToday: false });
  assert.equal((out.match(/class="dash-week-dot/g) || []).length, 7);
  assert.match(out, /is-rest">❄/);
  assert.match(out, /dash-week-dot is-today"/);
  const studied = week.map(function(d) { return d.isToday ? Object.assign({}, d, { status: "done" }) : d; });
  assert.match(ctx.heroWeekHtml({ count: 1, week: studied }), /dash-week-dot is-done is-today">✓/);
  assert.match(out, /week\.restHint/);
  const plain = week.map(function(d) { return Object.assign({}, d, { status: d.status === "rest" ? "done" : d.status }); });
  assert.doesNotMatch(ctx.heroWeekHtml({ count: 1, week: plain, restAvailableToday: false }), /week\.restHint/);
  assert.match(ctx.heroWeekHtml({ count: 1, week: plain, restAvailableToday: true }), /week\.restHint/);
});

test("without today data (local mode) there is no Today tile and no week row", function() {
  const ctx = load(20);
  const out = hero(ctx, undefined);
  assert.equal((out.match(/<section class="dash-tile"/g) || []).length, 2);
  assert.doesNotMatch(out, /dash-week/);
  assert.equal(ctx.heroWeekHtml({ count: 3 }), "");
});

test("a count with nothing to measure against has no bar; a cap of 0 is still a cap", function() {
  const ctx = load(20);
  ctx.state.maxReviewsPerDay = null;
  const none = ctx.streakTimeHeroCard(1, { avgDailyMs: 0 }, summary, null, { count: 3, week: week, activity: { studyMs: 0, newCards: 2, reviews: 1 } });
  assert.match(none, /<b>2<\/b>/);
  assert.match(none, /<b>1<\/b>/);
  assert.equal((none.match(/dash-meter-track/g) || []).length, 0);
  ctx.state.maxReviewsPerDay = 0;
  const zero = ctx.streakTimeHeroCard(1, { avgDailyMs: 0 }, summary, null, { count: 3, week: week, activity: { studyMs: 0, newCards: 2, reviews: 1 } });
  assert.match(zero, /<b>1 \/ 0<\/b>[\s\S]*scaleX\(1\.000\)/);
});

test("the gear hides single numbers or a whole tile; an old 'highlight' still shows", function() {
  const ctx = load(20);
  ctx.state.dashMetricConfig = { streak: "highlight", avgDaily: "hidden", studyTime: "hidden", minDaily: "hidden", maxDaily: "hidden", classes: "hidden" };
  const out = hero(ctx, { count: 3, week: week, activity: activity });
  assert.match(out, /hero\.streak/);
  assert.doesNotMatch(out, /hero\.lastDays/, "every study-time number hidden drops the tile");
  assert.doesNotMatch(out, /stat\.classes/);
  assert.match(out, /stat\.lessons/);
  ctx.state.dashMetricConfig = { streak: "hidden", avgDaily: "hidden", studyTime: "hidden", minDaily: "hidden", maxDaily: "hidden",
    classes: "hidden", lessons: "hidden", cards: "hidden", attempts: "hidden", sessions: "hidden" };
  assert.match(hero(ctx, undefined), /dashboard\.allMetricsHidden/);
});

test("the sparkline draws every day of the window, today last, the average dashed", function() {
  const ctx = load(20);
  const svg = ctx.studySparkline(studyTime.daily, studyTime.avgDailyMs, false);
  assert.match(svg, /<path class="dash-spark-line" d="M0\.0 [\d.]+ L150\.0 52\.0 L300\.0 4\.0"/, "a 0-minute day sits on the floor, the max at the top");
  assert.match(svg, /dash-spark-avg/);
  assert.match(svg, /<circle class="dash-spark-dot" cx="300\.0" cy="4\.0"/);
  assert.equal(ctx.studySparkline([{ day: "x", ms: 1 }], 0, false), "");
  assert.match(ctx.studySparkline(studyTime.daily, 0, true), /dash-spark-note/, "all-time says which days the line covers");
});

test("the dashboard sends a zero-filled daily series for the sparkline", function() {
  assert.match(stats, /const sparkDays = windowDays \|\| 30;/);
  assert.match(stats, /daily\.push\(\{ day, ms: dayMs\.get\(day\) \|\| 0, avgMs: /);
  assert.match(stats, /windowDays:  windowDays,\n      daily,\n/);
});

test("the streak tile carries the above-average run, and says what today still needs", function() {
  const ctx = load(20);
  const run = { current: 3, best: 9, todayAbove: false, todayMs: 20 * 60000, todayAvgMs: 28.8 * 60000 };
  const out = hero(ctx, { count: 3, week: week, activity: activity }, { studyTime: { aboveAvg: run } });
  assert.match(out, /hero\.streak[\s\S]*dash-week[\s\S]*hero\.aboveAvgRun\|n=3[\s\S]*hero\.aboveAvgBest\|n=9[\s\S]*hero\.today/);
  assert.match(out, /hero\.aboveAvgKeep\|time=9 min/, "28.8 min against 20 needs 9 more, rounded up to the minute");
  assert.match(ctx.heroAboveAvgHtml(Object.assign({}, run, { todayAbove: true, current: 4 })), /hero\.aboveAvgToday/);
  assert.match(ctx.heroAboveAvgHtml(Object.assign({}, run, { current: 0 })), /hero\.aboveAvgStart/);
  assert.match(ctx.heroAboveAvgHtml(Object.assign({}, run, { current: 1 })), /hero\.aboveAvgRun1/);
  ctx.state.dashMetricConfig = { aboveAvg: "hidden" };
  assert.doesNotMatch(hero(ctx, { count: 3, week: week, activity: activity }, { studyTime: { aboveAvg: run } }), /dash-run/);
  ctx.state.dashMetricConfig = { streak: "hidden" };
  const alone = hero(ctx, { count: 3, week: week, activity: activity }, { studyTime: { aboveAvg: run } });
  assert.match(alone, /hero\.streak[\s\S]*dash-run/, "the run keeps the tile when the day streak is hidden");
  assert.doesNotMatch(alone, /dash-week|data-countdown/);
});

test("the sparkline's dashed line follows each day's rolling average when the server sends it", function() {
  const ctx = load(20);
  const daily = [{ day: "a", ms: 3600000, avgMs: 1800000 }, { day: "b", ms: 0, avgMs: 2400000 }, { day: "c", ms: 7200000, avgMs: 1600000 }];
  const svg = ctx.studySparkline(daily, 9e9, false);
  assert.match(svg, /<path class="dash-spark-avg" d="M0\.0 [\d.]+ L150\.0 [\d.]+ L300\.0 [\d.]+"/);
  assert.match(svg, /<path class="dash-spark-line" d="M0\.0 [\d.]+ L150\.0 52\.0 L300\.0 4\.0"/, "the flat window average is ignored for scale");
});
