"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { aboveAverageRun } = require("../server/lib/aboveAvg");

const M = 60000;
function days(start, mins) {
  const { addDays } = require("../server/lib/streak");
  return mins.map((m, i) => ({ day: addDays(start, i), ms: m * M }));
}

test("a day counts when it beats the mean of the days before it, skipped days as 0", function() {
  // 10, 20 (> 10), 0 (no), 30 (> 10), 25 (> 15), today 5 (< 17)
  const r = aboveAverageRun(days("2026-09-01", [10, 20, 0, 30, 25, 5]), "2026-09-06");
  assert.equal(r.todayAbove, false);
  assert.equal(r.current, 2, "the run through yesterday stands while today is short");
  assert.equal(r.best, 2);
  assert.equal(r.todayAvgMs, 17 * M);
  assert.equal(r.todayMs, 5 * M);
});

test("today extends the run once it passes its average", function() {
  const r = aboveAverageRun(days("2026-09-01", [10, 20, 0, 30, 25, 40]), "2026-09-06");
  assert.equal(r.todayAbove, true);
  assert.equal(r.current, 3);
  assert.equal(r.best, 3);
});

test("a missed day ends the run, and days with no rows count as 0 in the mean", function() {
  const rows = days("2026-09-01", [30, 40]).concat([{ day: "2026-09-04", ms: 50 * M }]);
  const r = aboveAverageRun(rows, "2026-09-05");
  assert.equal(r.avgByDay.get("2026-09-04"), Math.round(70 / 3 * M));
  assert.equal(r.current, 1, "the 3rd (0 min) broke the run; the 4th started a new one");
  assert.equal(r.best, 2, "the 1st (against an empty history) and the 2nd");
});

test("the mean covers only the 30 days before, not the whole history", function() {
  const mins = Array(30).fill(60).concat(Array(30).fill(0)).concat([1]);
  const r = aboveAverageRun(days("2026-07-01", mins), days("2026-07-01", mins)[60].day);
  assert.equal(r.todayAvgMs, 0, "thirty quiet days put the bar at zero");
  assert.equal(r.todayAbove, true);
});

test("no history means no run", function() {
  assert.deepEqual(Object.assign({}, aboveAverageRun([], "2026-10-02"), { avgByDay: null }),
    { current: 0, best: 0, todayAbove: false, todayMs: 0, todayAvgMs: 0, avgByDay: null });
});

test("the dashboard sends the run and each sparkline day's rolling mean", function() {
  const stats = fs.readFileSync(path.join(__dirname, "../server/routes/stats.js"), "utf8");
  assert.match(stats, /const run = aboveAverageRun\(dayRows, todayStr\);/);
  assert.match(stats, /avgMs: run\.avgByDay\.get\(day\) \|\| 0/);
  assert.match(stats, /aboveAvg: \{ current: run\.current, best: run\.best, todayAbove: run\.todayAbove/);
});
