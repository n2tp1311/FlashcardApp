"use strict";

const { computeStreak, weekStart, addDays } = require("./streak");
const { aboveAverageRun } = require("./aboveAvg");

// Achievements reward the work of learning -- showing up, coming back, struggling through
// hard cards -- more than volume, and nothing rewards cramming. Each one is worked out from
// stored data every time it is asked for, so this module is pure: it takes the facts the
// route gathered and returns where each achievement stands.
//
// tiers: the thresholds of one achievement's five levels (bronze, silver, gold, platinum,
// diamond), not separate badges. Each step asks more than the one before, so a level stays
// worth reaching: the first comes within days, the last takes a year or more of study. Every
// threshold an earlier, shorter ladder used is kept, so no level already reached goes away
// (db.js "achievement_ladders_v2" moves the recorded tiers onto these ladders).
// lossable: describes the present ("every card in this class is mastered"), so it goes when
// the present changes. Every other achievement, once reached, is kept by the route.

const DEFS = [
  { key: "dayStreak",        group: "showingUp", tiers: [3, 7, 30, 100, 365] },
  { key: "daysStudied",      group: "showingUp", tiers: [10, 30, 100, 365, 1000] },
  { key: "goalKeeper",       group: "showingUp", tiers: [3, 7, 14, 30, 60] },
  { key: "aboveAverage",     group: "showingUp", tiers: [3, 7, 14, 30, 60] },
  { key: "comeback",         group: "showingUp", tiers: [1, 2, 4, 7, 12] },
  { key: "steadyRhythm",     group: "showingUp", tiers: [2, 4, 8, 16, 32] },
  { key: "dueZero",          group: "showingUp", tiers: [3, 7, 14, 30, 60] },
  { key: "fullMonth",        group: "showingUp", tiers: [1, 3, 6, 12, 24] },
  { key: "classMastered",    group: "mastery",   tiers: [1, 2, 4, 7, 12], lossable: true },
  { key: "lessonMastered",   group: "mastery",   tiers: [1, 10, 50, 150, 400], lossable: true },
  { key: "longTermCards",    group: "mastery",   tiers: [100, 500, 2000, 5000, 12000], lossable: true },
  { key: "deepMemory",       group: "mastery",   tiers: [50, 250, 1000, 3000, 8000], lossable: true },
  { key: "longMemory",       group: "mastery",   tiers: [50, 150, 400, 1000, 2500] },
  { key: "vocabInUse",       group: "mastery",   tiers: [10, 50, 200, 500, 1200], lossable: true },
  { key: "cardsLearned",     group: "mastery",   tiers: [100, 300, 1000, 5000, 15000] },
  { key: "chapterDone",      group: "mastery",   tiers: [10, 50, 200, 500, 1200] },
  { key: "bookDone",         group: "mastery",   tiers: [1, 3, 10, 25, 50] },
  { key: "toughOne",         group: "effort",    tiers: [1, 10, 50, 150, 400] },
  { key: "leechCleared",     group: "effort",    tiers: [1, 3, 7, 15, 30] },
  { key: "recallCleared",    group: "effort",    tiers: [1, 7, 30, 100, 250] },
  { key: "writer",           group: "effort",    tiers: [100, 500, 2000, 5000, 12000] },
  { key: "deepSession",      group: "effort",    tiers: [1, 5, 20, 50, 120] },
  { key: "hoursStudied",     group: "effort",    tiers: [1, 10, 50, 100, 250] },
  { key: "sharpSession",     group: "effort",    tiers: [1, 10, 50, 150, 400] },
  { key: "secondChance",     group: "effort",    tiers: [10, 100, 500, 1500, 4000] },
  { key: "passageSolved",    group: "effort",    tiers: [10, 50, 200, 500, 1200] },
  { key: "recallFirst",      group: "method",    tiers: [1, 4, 12, 26, 52] },
  { key: "mixedPractice",    group: "method",    tiers: [1, 5, 20, 50, 120] },
  { key: "secondLook",       group: "method",    tiers: [1, 5, 20, 50, 120] },
  { key: "cardFixer",        group: "method",    tiers: [1, 10, 30, 75, 150] },
  { key: "wordCollector",    group: "curiosity", tiers: [10, 50, 200, 500, 1200] },
  { key: "explorer",         group: "curiosity", tiers: [1, 4, 12, 26, 52] },
  { key: "builder",          group: "curiosity", tiers: [100, 500, 2000, 5000, 12000] },
  { key: "fromTheBook",      group: "curiosity", tiers: [1, 2, 4, 7, 12] },
  { key: "freshStart",       group: "curiosity", tiers: [100, 250, 500, 1000, 2000] }
];

// A study session, for Deep session and Mixed practice: answers no more than this far apart.
// There is no session id in the data; a ten-minute pause is long enough to be a break.
const SESSION_GAP_SEC = 10 * 60;
const DEEP_SESSION_MS = 25 * 60 * 1000;
const LONG_GAP_SEC = 30 * 86400;     // Long memory: a review after a month or more away
const LONG_MEMORY_REVIEWS = 50;
const LONG_MEMORY_ACCURACY = 0.9;
const COMEBACK_AWAY_DAYS = 7;
const RHYTHM_DAYS_PER_WEEK = 5;
const RECALL_SHARE = 0.7;
const RECALL_MIN_ANSWERS = 30;       // so a week of three flashcards cannot earn it
const TOUGH_LEARNING_MARKS = 3;
const LEECH_LAPSES = 8;
const MIXED_CLASSES = 3;
const SHARP_QUIZ_ANSWERS = 20;       // Sharp session: a session of 20+ quiz answers, 90% right
const SHARP_ACCURACY = 0.9;

function utcDay(sec) {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

// Longest run of consecutive calendar days in a sorted list of "YYYY-MM-DD".
function longestDayRun(days) {
  let best = 0, run = 0, prev = null;
  days.forEach(d => {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  });
  return best;
}

// The best day streak ever, under the same rest-day rule as the live streak. A run can only
// end on a studied day whose next day was not studied, so only those days are checked.
function bestStreak(days, today) {
  const studied = new Set(days);
  let best = 0;
  days.forEach(d => {
    if (studied.has(addDays(d, 1)) && d !== today) return;
    best = Math.max(best, computeStreak(days, d).streak);
  });
  return best;
}

// How many times a week or more away was followed by three days running.
function comeback(days) {
  let n = 0;
  for (let i = 1; i + 2 < days.length; i++) {
    const away = (Date.parse(days[i]) - Date.parse(days[i - 1])) / 86400000 - 1;
    if (away >= COMEBACK_AWAY_DAYS && days[i + 1] === addDays(days[i], 1) && days[i + 2] === addDays(days[i], 2)) n++;
  }
  return n;
}

// Calendar months (UTC) with every day studied. The month in progress counts once its last
// day is studied, like any other.
function fullMonths(days) {
  const perMonth = new Map();
  days.forEach(d => { const m = d.slice(0, 7); perMonth.set(m, (perMonth.get(m) || 0) + 1); });
  let n = 0;
  perMonth.forEach((count, m) => {
    const [y, mo] = m.split("-").map(Number);
    if (count === new Date(Date.UTC(y, mo, 0)).getUTCDate()) n++;
  });
  return n;
}

// Weeks running with at least five study days. The week in progress joins the run once it
// has its five, and does not break it before then.
function steadyRhythm(days, today) {
  const perWeek = new Map();
  days.forEach(d => { const w = weekStart(d); perWeek.set(w, (perWeek.get(w) || 0) + 1); });
  if (!days.length) return { best: 0, current: 0 };
  const thisWeek = weekStart(today);
  let best = 0, run = 0;
  for (let w = weekStart(days[0]); w <= thisWeek; w = addDays(w, 7)) {
    const ok = (perWeek.get(w) || 0) >= RHYTHM_DAYS_PER_WEEK;
    if (w === thisWeek && !ok) break;
    run = ok ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { best, current: run };
}

// secondChances: cards answered wrong and then right later in the same session, once each.
function sessions(attempts) {
  const out = [];
  let cur = null;
  attempts.forEach(a => {
    if (!cur || a.t - cur.last > SESSION_GAP_SEC) {
      cur = { ms: 0, classes: new Set(), last: a.t, quiz: 0, quizRight: 0, missed: new Set(), secondChances: 0 };
      out.push(cur);
    }
    cur.ms += a.ms > 0 ? a.ms : 0;
    if (a.cls) cur.classes.add(a.cls);
    if (a.source === "quiz") { cur.quiz++; if (a.correct) cur.quizRight++; }
    if (!a.correct) cur.missed.add(a.card);
    else if (cur.missed.delete(a.card)) cur.secondChances++;
    cur.last = a.t;
  });
  return out;
}

// facts: see routes/achievements.js gatherFacts(). Returns one entry per DEFS item.
function computeAchievements(facts, today) {
  const attempts = facts.attempts;
  const dayCount = new Map(), dayMs = new Map();
  attempts.forEach(a => {
    const d = utcDay(a.t);
    dayCount.set(d, (dayCount.get(d) || 0) + 1);
    dayMs.set(d, (dayMs.get(d) || 0) + (a.ms > 0 ? a.ms : 0));
  });
  const days = [...dayCount.keys()].sort();
  const live = facts.cards.filter(c => !c.archived);
  const v = {};      // value per key
  const show = {};   // optional { cur, target, unit } overriding "value / next tier"

  v.dayStreak = bestStreak(days, today);
  v.daysStudied = days.length;
  if (facts.dailyGoal > 0) {
    v.goalKeeper = longestDayRun(days.filter(d => dayCount.get(d) >= facts.dailyGoal));
  } else {
    v.goalKeeper = 0;
    show.goalKeeper = { off: true };
  }
  v.aboveAverage = aboveAverageRun([...dayMs].map(([day, ms]) => ({ day, ms })), today).best;
  v.comeback = comeback(days);
  const rhythm = steadyRhythm(days, today);
  v.steadyRhythm = rhythm.best;
  const rhythmNext = DEFS.find(d => d.key === "steadyRhythm").tiers.find(x => x > rhythm.best);
  if (rhythmNext) show.steadyRhythm = { cur: rhythm.current, target: rhythmNext, unit: "weeks" };
  v.dueZero = longestDayRun(facts.dueZeroDays.slice().sort());
  v.fullMonth = fullMonths(days);

  // Mastery describes the cards as they are now; archived classes are set aside.
  const byClass = new Map(), byLesson = new Map();
  live.forEach(c => {
    [[byClass, c.cls], [byLesson, c.lesson]].forEach(([m, k]) => {
      const e = m.get(k) || { n: 0, mastered: 0 };
      e.n++; if (c.mastered) e.mastered++;
      m.set(k, e);
    });
  });
  const full = e => e.n > 0 && e.mastered === e.n;
  v.classMastered = [...byClass.values()].filter(full).length;
  if (!v.classMastered) {
    const best = Math.max(0, ...[...byClass.values()].map(e => e.mastered / e.n));
    show.classMastered = { cur: Math.floor(best * 100), target: 100, unit: "%" };
  }
  v.lessonMastered = [...byLesson.values()].filter(full).length;
  v.longTermCards = live.filter(c => c.mastered).length;
  v.deepMemory = live.filter(c => c.deep).length;
  v.vocabInUse = live.filter(c => c.vocab && c.mastered).length;

  // Learned: given a due date by a first grade, which is also what takes a card out of Study
  // now's new cards. A chapter or book is done when every card in it is learned, the moment
  // the Study order screen calls a class Completed. Kept once reached, unlike mastery.
  v.cardsLearned = facts.cards.filter(c => c.due != null).length;
  const learnedBy = (key) => {
    const m = new Map();
    live.forEach(c => {
      const e = m.get(c[key]) || { n: 0, learned: 0, book: false };
      e.n++; if (c.due != null) e.learned++; if (c.ext) e.book = true;
      m.set(c[key], e);
    });
    return [...m.values()].filter(e => e.learned === e.n);
  };
  v.chapterDone = learnedBy("lesson").length;
  v.bookDone = learnedBy("cls").filter(e => e.book).length;

  // Long memory: the latest 50 answers to cards last answered a month or more before.
  const lastSeen = new Map(), longReviews = [];
  attempts.forEach(a => {
    const prev = lastSeen.get(a.card);
    if (prev !== undefined && a.t - prev >= LONG_GAP_SEC) longReviews.push(a.correct ? 1 : 0);
    lastSeen.set(a.card, a.t);
  });
  // Levels count those reviews, while the latest 50 hold 90%: a long gap survived, not just sat.
  const recent = longReviews.slice(-LONG_MEMORY_REVIEWS);
  const longAcc = recent.length ? recent.reduce((s, x) => s + x, 0) / recent.length : 0;
  const longOk = recent.length >= LONG_MEMORY_REVIEWS && longAcc >= LONG_MEMORY_ACCURACY;
  v.longMemory = longOk ? longReviews.length : 0;
  if (recent.length < LONG_MEMORY_REVIEWS) show.longMemory = { cur: recent.length, target: LONG_MEMORY_REVIEWS, unit: "reviews" };
  else if (!longOk) show.longMemory = { cur: Math.round(longAcc * 100), target: LONG_MEMORY_ACCURACY * 100, unit: "%" };

  // Tough one tamed: marked Still learning three times or more, then answered Confident.
  const learningMarks = new Map(), tamed = new Set();
  attempts.forEach(a => {
    if (a.source === "flashcard" && !a.correct) learningMarks.set(a.card, (learningMarks.get(a.card) || 0) + 1);
    else if (a.grade === "easy" && (learningMarks.get(a.card) || 0) >= TOUGH_LEARNING_MARKS) tamed.add(a.card);
  });
  v.toughOne = tamed.size;
  v.leechCleared = facts.cards.filter(c => c.lapses >= LEECH_LAPSES && c.state === 2).length;
  // Days Needs Recall was found empty. Only someone who has used quizzes can have emptied it.
  // The route records today (recall_zero) when clearNow says so; nothing else stores the past.
  const waiting = live.filter(c => c.lastCorrectSource === "quiz" && c.due != null && c.due <= facts.now).length;
  const clearNow = attempts.some(a => a.source === "quiz") && waiting === 0;
  const recallDays = new Set(facts.recallZeroDays || []);
  if (clearNow) recallDays.add(today);
  v.recallCleared = recallDays.size;
  show.recallCleared = { cur: waiting, unit: "waiting", clearNow };
  v.writer = attempts.filter(a => a.typed).length;
  const sess = sessions(attempts);
  const deepest = Math.max(0, ...sess.map(s => s.ms));
  v.deepSession = sess.filter(s => s.ms >= DEEP_SESSION_MS).length;
  if (!v.deepSession) show.deepSession = { cur: Math.floor(deepest / 60000), target: 25, unit: "min" };
  v.sharpSession = sess.filter(s => s.quiz >= SHARP_QUIZ_ANSWERS && s.quizRight / s.quiz >= SHARP_ACCURACY).length;
  v.secondChance = sess.reduce((n, s) => n + s.secondChances, 0);
  v.passageSolved = facts.passagesSolved || 0;
  const totalMs = attempts.reduce((s, a) => s + (a.ms > 0 ? a.ms : 0), 0);
  v.hoursStudied = Math.floor(totalMs / 360000) / 10;

  // Recall over recognition, and Explorer, are judged per week (Monday to Sunday, UTC).
  const weeks = new Map();
  attempts.forEach(a => {
    const w = weekStart(utcDay(a.t));
    const e = weeks.get(w) || { n: 0, recall: 0, classes: new Set() };
    e.n++;
    if (a.source !== "quiz") e.recall++;
    if (a.cls) e.classes.add(a.cls);
    weeks.set(w, e);
  });
  const thisWeek = weeks.get(weekStart(today)) || { n: 0, recall: 0, classes: new Set() };
  // Until the first is reached, the line shows how this week or the best session is doing;
  // after that it counts weeks and sessions toward the next level.
  v.recallFirst = [...weeks.values()].filter(e => e.n >= RECALL_MIN_ANSWERS && e.recall / e.n >= RECALL_SHARE).length;
  if (!v.recallFirst) show.recallFirst = { cur: thisWeek.n ? Math.round(thisWeek.recall / thisWeek.n * 100) : 0, target: RECALL_SHARE * 100, unit: "%" };
  const mostClasses = Math.max(0, ...sess.map(s => s.classes.size));
  v.mixedPractice = sess.filter(s => s.classes.size >= MIXED_CLASSES).length;
  if (!v.mixedPractice) show.mixedPractice = { cur: mostClasses, target: MIXED_CLASSES, unit: "classes" };
  v.secondLook = facts.secondLooks;
  v.cardFixer = facts.cardFixes;

  v.wordCollector = facts.vocabRequests;
  v.explorer = [...weeks.values()].filter(e => e.classes.size >= MIXED_CLASSES).length;
  if (!v.explorer) show.explorer = { cur: thisWeek.classes.size, target: MIXED_CLASSES, unit: "classes" };
  v.builder = facts.cards.filter(c => !c.ext).length;
  v.fromTheBook = new Set(attempts.filter(a => a.ext && !a.vocab && a.cls).map(a => a.cls)).size;
  v.freshStart = facts.cards.filter(c => !c.ext && c.state === 2).length;

  return DEFS.map(def => {
    const value = v[def.key] || 0;
    const tier = def.tiers.filter(x => value >= x).length;
    const next = tier < def.tiers.length ? def.tiers[tier] : null;
    const shown = show[def.key] || { cur: value, target: next };
    return {
      key: def.key, group: def.group, tiers: def.tiers, lossable: !!def.lossable,
      value, tier, next,
      progress: next == null ? 1 : shown.off ? 0 : Math.min(1, (shown.target ? shown.cur / shown.target : value / next) || 0),
      show: shown
    };
  });
}

module.exports = { DEFS, computeAchievements, bestStreak, comeback, steadyRhythm, sessions, longestDayRun, fullMonths };
