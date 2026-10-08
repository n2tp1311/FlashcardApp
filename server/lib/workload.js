"use strict";

// Load balancing and easy days. FSRS gives every card an exact interval, so cards learned
// together come due together and one big study day becomes a spike of reviews later. A
// review interval of 2.5 days or more may instead land anywhere in Anki's fuzz range
// around it (about ±15% for short intervals, narrowing to ±5% past 20 days), and the
// balancer picks the day in that range with the fewest reviews already due. Recall at a
// date a few percent off the target is within a point or two of the target, so the
// schedule's quality is kept while the load evens out.
//
// Easy days are weekdays the user marks Light or Minimum. They count as busier than they
// are, so the balancer only chooses one when every other day in the range is fuller. A
// card is never moved outside its range, so a light day gets fewer reviews, not none.

const NORMAL = 0, LIGHT = 1, MINIMUM = 2;
// A day's reviews are divided by its weight: Light counts double and Minimum twenty times.
const LEVEL_WEIGHT = [1, 0.5, 0.05];
const MIN_FUZZ_INTERVAL = 2.5;

// Anki's fuzz ranges (rslib/src/scheduler/states/fuzz.rs), in whole days from today.
function fuzzRange(intervalDays, maxInterval) {
  if (intervalDays < MIN_FUZZ_INTERVAL) return null;
  let delta = 1 + 0.15 * (Math.min(intervalDays, 7) - 2.5);
  if (intervalDays > 7) delta += 0.1 * (Math.min(intervalDays, 20) - 7);
  if (intervalDays > 20) delta += 0.05 * (intervalDays - 20);
  let lo = Math.max(2, Math.round(intervalDays - delta));
  const hi = Math.min(Math.round(intervalDays + delta), maxInterval);
  lo = Math.min(lo, hi);
  return { lo, hi };
}

// Days counted in the user's local time. tzOffset is Date#getTimezoneOffset(): minutes
// to add to local time to get UTC, so UTC+7 is -420.
function localDay(ts, tzOffset) {
  return Math.floor((ts - tzOffset * 60) / 86400);
}

// 0 = Sunday, as Date#getDay(). Day 0 (1970-01-01) was a Thursday.
function weekdayOf(day) {
  return (((day + 4) % 7) + 7) % 7;
}

function normalizeTz(tz) {
  return Number.isInteger(tz) && tz >= -840 && tz <= 840 ? tz : 0;
}

function settingsFrom(prefs) {
  const p = prefs || {};
  const easy = Array.isArray(p.easyDays) && p.easyDays.length === 7
    ? p.easyDays.map(v => (v === LIGHT || v === MINIMUM ? v : NORMAL))
    : [0, 0, 0, 0, 0, 0, 0];
  return { enabled: p.loadBalance !== false, easyDays: easy };
}

// The day offset (from today) to schedule on. counts maps an absolute local day to the
// reviews already due that day. Ties go to the day nearest the exact interval.
function chooseOffset(range, target, today, counts, easyDays) {
  let best = null, bestScore = Infinity, bestDist = Infinity;
  for (let off = range.lo; off <= range.hi; off++) {
    const day = today + off;
    const weight = LEVEL_WEIGHT[easyDays[weekdayOf(day)]] || 1;
    const score = ((counts.get(day) || 0) + 1) / weight;
    const dist = Math.abs(off - target);
    if (score < bestScore || (score === bestScore && dist < bestDist)) {
      best = off; bestScore = score; bestDist = dist;
    }
  }
  return best;
}

// Moves a review's due time to the balanced day, keeping its time of day. dueTimes lists
// the due times of the user's other cards, so this answer's card is not counted against
// itself. Returns dueAt unchanged when balancing is off or the interval is too short.
function balanceDue({ now, dueAt, maxInterval, tzOffset, settings, dueTimes }) {
  if (!settings.enabled) return dueAt;
  const range = fuzzRange((dueAt - now) / 86400, maxInterval);
  if (!range) return dueAt;
  const today = localDay(now, tzOffset);
  const target = localDay(dueAt, tzOffset) - today;
  const counts = new Map();
  for (const t of dueTimes) {
    const d = localDay(t, tzOffset);
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  const off = chooseOffset(range, target, today, counts, settings.easyDays);
  return dueAt + (off - target) * 86400;
}

module.exports = { NORMAL, LIGHT, MINIMUM, LEVEL_WEIGHT, fuzzRange, localDay, weekdayOf,
                   normalizeTz, settingsFrom, chooseOffset, balanceDue };
