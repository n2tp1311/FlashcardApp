const assert = require("node:assert/strict");
const { test } = require("node:test");
const { computeStreak, weekRow, weekStart } = require("../server/lib/streak");

// 2026-10-02 is a Friday; its week runs Mon 09-28 to Sun 10-04.
const FRI = "2026-10-02";

test("weeks start on Monday", function() {
  assert.equal(weekStart("2026-10-02"), "2026-09-28");
  assert.equal(weekStart("2026-09-28"), "2026-09-28");
  assert.equal(weekStart("2026-10-04"), "2026-09-28");
  assert.equal(weekStart("2026-10-05"), "2026-10-05");
});

test("an unbroken run counts every day; today is still open", function() {
  assert.equal(computeStreak(["2026-10-02", "2026-10-01", "2026-09-30"], FRI).streak, 3);
  const open = computeStreak(["2026-10-01", "2026-09-30"], FRI);
  assert.equal(open.streak, 2);
  assert.equal(open.studiedToday, false);
});

test("one missed day a week is a rest day and adds nothing", function() {
  // Wed 09-30 missed.
  const s = computeStreak(["2026-10-02", "2026-10-01", "2026-09-29", "2026-09-28"], FRI);
  assert.equal(s.streak, 4);
  assert.deepEqual(s.restDays, ["2026-09-30"]);
});

test("a second missed day in the same week ends the streak there", function() {
  // Wed 09-30 and Mon 09-28 missed; Sun 09-27 studied.
  const s = computeStreak(["2026-10-02", "2026-10-01", "2026-09-29", "2026-09-27"], FRI);
  assert.equal(s.streak, 3);
});

test("each week has its own rest day", function() {
  // Thu 10-01 (this week) and Thu 09-24 (last week) missed.
  const days = ["2026-10-02", "2026-09-30", "2026-09-29", "2026-09-28", "2026-09-27",
    "2026-09-26", "2026-09-25", "2026-09-23"];
  assert.equal(computeStreak(days, FRI).streak, 8);
});

test("two missed days in a row break it, even across a week boundary", function() {
  // Sun 09-27 and Mon 09-28 missed: different weeks, but consecutive.
  const days = ["2026-10-02", "2026-10-01", "2026-09-30", "2026-09-29", "2026-09-26"];
  assert.equal(computeStreak(days, FRI).streak, 4);
});

test("yesterday can be the rest day while today is still open", function() {
  const s = computeStreak(["2026-09-30", "2026-09-29"], FRI);
  assert.equal(s.streak, 2);
  assert.deepEqual(s.restDays, ["2026-10-01"]);
  assert.equal(s.restAvailableToday, false, "a rest day cannot follow a rest day");
});

test("skipping today is safe only when yesterday was studied and the week's rest is unused", function() {
  assert.equal(computeStreak(["2026-10-01", "2026-09-30"], FRI).restAvailableToday, true);
  // This week's rest already went on Tue 09-29.
  assert.equal(computeStreak(["2026-10-01", "2026-09-30", "2026-09-28"], FRI).restAvailableToday, false);
  assert.equal(computeStreak(["2026-10-02", "2026-10-01"], FRI).restAvailableToday, false, "already studied");
  assert.equal(computeStreak([], FRI).restAvailableToday, false);
});

test("no study at all, or a gap with nothing before it, is no streak and no rest day", function() {
  assert.deepEqual(computeStreak([], FRI), { streak: 0, studiedToday: false, restDays: [], restAvailableToday: false });
  assert.equal(computeStreak(["2026-09-20"], FRI).streak, 0);
  assert.deepEqual(computeStreak(["2026-09-20"], FRI).restDays, []);
});

test("the week row marks done, rest, today, missed and future", function() {
  const days = ["2026-09-28", "2026-09-29", "2026-10-01"];
  const s = computeStreak(days, FRI);
  const row = weekRow(days, s.restDays, FRI);
  assert.deepEqual(row.map(function(d) { return d.status; }),
    ["done", "done", "rest", "done", "today", "future", "future"]);
  assert.equal(row[4].isToday, true);
  const gap = weekRow(["2026-10-02"], [], FRI);
  assert.equal(gap[0].status, "missed");
  assert.equal(gap[4].status, "done");
});
