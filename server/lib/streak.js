"use strict";

// Study days are UTC calendar dates ("YYYY-MM-DD"), the same boundary the attempts queries
// group by, so the streak, the week row and the daily goal all roll over at one moment.

const MS_PER_DAY = 86400000;

function addDays(day, n) {
  return new Date(Date.parse(day + "T00:00:00Z") + n * MS_PER_DAY).toISOString().slice(0, 10);
}

// Monday of the day's week. Weeks start on Monday, as in Duolingo's week row and ISO 8601.
function weekStart(day) {
  const dow = new Date(day + "T00:00:00Z").getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

// Consecutive study days, where one missed day per week is a rest day and does not break the
// run. A rest day bridges a single gap only: two missed days in a row end the streak, even
// across a week boundary, so the rule cannot be read as "study every other day". Rest days do
// not add to the count. Today is never a gap: until midnight it is still open.
//
// Walking back from today, the most recent gap of a week takes that week's rest day, so an
// older second gap in the same week is where the streak ends.
function computeStreak(studyDays, today) {
  const studied = new Set(studyDays);
  const studiedToday = studied.has(today);
  const restWeeks = new Set();
  const restDays = [];
  let streak = 0;
  let day = studiedToday ? today : addDays(today, -1);
  for (let guard = 0; guard <= studied.size * 2 + 2; guard++) {
    if (studied.has(day)) { streak++; day = addDays(day, -1); continue; }
    const before = addDays(day, -1);
    if (streak > 0 || day === addDays(today, -1)) {
      if (!restWeeks.has(weekStart(day)) && studied.has(before)) {
        restWeeks.add(weekStart(day));
        restDays.push(day);
        day = before;
        continue;
      }
    }
    break;
  }
  if (!streak) restDays.length = 0;
  // Whether skipping the rest of today would still keep the streak: yesterday must be a study
  // day (a rest day cannot follow a rest day) and this week's rest day must be unused.
  const restAvailableToday = streak > 0 && !studiedToday && studied.has(addDays(today, -1)) &&
    !restWeeks.has(weekStart(today));
  return { streak, studiedToday, restDays, restAvailableToday };
}

// Monday to Sunday of the current week, each day marked for the week row.
function weekRow(studyDays, restDays, today) {
  const studied = new Set(studyDays);
  const rest = new Set(restDays);
  const monday = weekStart(today);
  const row = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(monday, i);
    const status = studied.has(day) ? "done" : rest.has(day) ? "rest" :
      day === today ? "today" : day > today ? "future" : "missed";
    row.push({ day, status, isToday: day === today });
  }
  return row;
}

module.exports = { computeStreak, weekRow, weekStart, addDays };
