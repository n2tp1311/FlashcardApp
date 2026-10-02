"use strict";

const { addDays } = require("./streak");

const WINDOW_DAYS = 30;

// Consecutive days studied longer than usual. A day is above average when its study time beats
// the mean of the 30 days before it, unstudied days counted as 0 -- so skipping lowers the bar,
// which is the point: the run rewards a good day relative to the recent past, not an absolute
// target. Before 30 days of history exist the mean covers the days since the first study day.
// Today joins the run only once it passes its average; until then the run shown ends yesterday,
// so the morning of a run never reads as a broken one.
function aboveAverageRun(rows, today) {
  const ms = new Map(rows.map(r => [r.day, r.ms > 0 ? r.ms : 0]));
  const avgByDay = new Map();
  const empty = { current: 0, best: 0, todayAbove: false, todayMs: 0, todayAvgMs: 0, avgByDay };
  if (!ms.size) return empty;
  const first = [...ms.keys()].sort()[0];
  if (first > today) return empty;

  const recent = [];
  let sum = 0, run = 0, best = 0, beforeToday = 0, todayAbove = false, todayAvgMs = 0;
  for (let day = first; day <= today; day = addDays(day, 1)) {
    const avg = recent.length ? sum / recent.length : 0;
    const v = ms.get(day) || 0;
    const above = v > avg;
    avgByDay.set(day, Math.round(avg));
    if (day === today) {
      beforeToday = run;
      todayAbove = above;
      todayAvgMs = Math.round(avg);
    }
    run = above ? run + 1 : 0;
    best = Math.max(best, run);
    recent.push(v);
    sum += v;
    if (recent.length > WINDOW_DAYS) sum -= recent.shift();
  }
  return { current: todayAbove ? run : beforeToday, best, todayAbove, todayMs: ms.get(today) || 0, todayAvgMs, avgByDay };
}

module.exports = { aboveAverageRun, WINDOW_DAYS };
