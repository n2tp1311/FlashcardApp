const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const lib = require("../server/lib/achievements");

const DAY = 86400;
const T0 = Date.parse("2026-09-01T12:00:00Z") / 1000; // a Tuesday
const TODAY = "2026-10-02";

function facts(over) {
  return Object.assign({ now: Date.parse(TODAY + "T12:00:00Z") / 1000, attempts: [], cards: [], dailyGoal: 20,
    dueZeroDays: [], secondLooks: 0, cardFixes: 0, vocabRequests: 0 }, over);
}
function answer(t, more) {
  return Object.assign({ t: t, ms: 10000, source: "flashcard", correct: 1, grade: "good", typed: null, card: "c1", cls: "k1", ext: null, vocab: false }, more);
}
function byKey(items) {
  const m = {}; items.forEach(i => { m[i.key] = i; }); return m;
}
function days(list) {
  return list.map(d => answer(Date.parse(d + "T08:00:00Z") / 1000));
}

test("every achievement comes back once, with its tiers in order", function() {
  const items = lib.computeAchievements(facts(), TODAY);
  assert.equal(items.length, lib.DEFS.length);
  assert.equal(items.length, 35);
  assert.ok(!items.some(i => i.key === "bothWays"), "Both ways round has nothing to track");
  items.forEach(i => {
    assert.deepEqual(i.tiers, i.tiers.slice().sort((a, b) => a - b), i.key);
    assert.equal(i.tier, 0, i.key);
  });
});

test("tiers count the thresholds reached; next and progress point at the one after", function() {
  const a = [];
  for (let i = 0; i < 120; i++) a.push(answer(T0 + i * 30, { typed: 1 }));
  const w = byKey(lib.computeAchievements(facts({ attempts: a }), TODAY)).writer;
  assert.equal(w.value, 120);
  assert.equal(w.tier, 1);
  assert.equal(w.next, 500);
  assert.equal(w.progress, 120 / 500);
});

test("best streak survives a later gap; days studied counts them all", function() {
  const list = [];
  for (let i = 0; i < 8; i++) list.push(new Date((T0 + i * DAY) * 1000).toISOString().slice(0, 10));
  list.push("2026-09-25");
  const r = byKey(lib.computeAchievements(facts({ attempts: days(list) }), TODAY));
  assert.ok(r.dayStreak.value >= 7);
  assert.equal(r.dayStreak.tier, 2);
  assert.equal(r.daysStudied.value, 9);
});

test("comeback needs a week away and then three days running, and counts each time", function() {
  assert.equal(lib.comeback(["2026-09-01", "2026-09-10", "2026-09-11", "2026-09-12"]), 1);
  assert.equal(lib.comeback(["2026-09-01", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-25", "2026-09-26", "2026-09-27"]), 2);
  assert.equal(lib.comeback(["2026-09-01", "2026-09-10", "2026-09-11"]), 0);
  assert.equal(lib.comeback(["2026-09-01", "2026-09-05", "2026-09-06", "2026-09-07"]), 0);
});

test("steady rhythm: an unfinished week neither counts nor breaks the run", function() {
  const d = [];
  ["2026-09-07", "2026-09-14", "2026-09-21"].forEach(mon => {
    for (let i = 0; i < 5; i++) d.push(new Date(Date.parse(mon) + i * DAY * 1000).toISOString().slice(0, 10));
  });
  d.push("2026-09-28");
  assert.deepEqual(lib.steadyRhythm(d, "2026-09-29"), { best: 3, current: 3 });
});

test("sessions split on a ten-minute pause; deep and mixed read them", function() {
  const a = [];
  for (let i = 0; i < 30; i++) a.push(answer(T0 + i * 60, { ms: 60000, cls: "k" + (i % 3) }));
  a.push(answer(T0 + 30 * 60 + 11 * 60, { ms: 60000 }));
  assert.equal(lib.sessions(a).length, 2);
  const r = byKey(lib.computeAchievements(facts({ attempts: a }), TODAY));
  assert.equal(r.deepSession.tier, 1);
  assert.equal(r.mixedPractice.tier, 1);
  assert.equal(r.explorer.tier, 1);
});

test("tough one: three Learning marks, then Confident", function() {
  const a = [0, 1, 2].map(i => answer(T0 + i * DAY, { correct: 0, grade: null }));
  a.push(answer(T0 + 3 * DAY, { grade: "easy" }));
  assert.equal(byKey(lib.computeAchievements(facts({ attempts: a }), TODAY)).toughOne.value, 1);
  a.splice(0, 1);
  assert.equal(byKey(lib.computeAchievements(facts({ attempts: a }), TODAY)).toughOne.value, 0);
});

test("a daily goal of 0 switches Goal keeper off instead of leaving it at 0%", function() {
  const r = byKey(lib.computeAchievements(facts({ dailyGoal: 0, attempts: days(["2026-09-01"]) }), TODAY));
  assert.deepEqual(r.goalKeeper.show, { off: true });
  assert.equal(r.goalKeeper.progress, 0);
});

test("mastery counts only live cards, and a class needs every card mastered", function() {
  const cards = [
    { id: "a", lesson: "l1", cls: "k1", archived: 0, mastered: 1 },
    { id: "b", lesson: "l1", cls: "k1", archived: 0, mastered: 1 },
    { id: "c", lesson: "l2", cls: "k1", archived: 0, mastered: 0 },
    { id: "d", lesson: "l3", cls: "k2", archived: 1, mastered: 1 }
  ];
  const r = byKey(lib.computeAchievements(facts({ cards }), TODAY));
  assert.equal(r.lessonMastered.value, 1);
  assert.equal(r.classMastered.value, 0);
  assert.deepEqual(r.classMastered.show, { cur: 66, target: 100, unit: "%" });
  assert.equal(r.longTermCards.value, 2);
  assert.ok(r.classMastered.lossable && r.lessonMastered.lossable && !r.toughOne.lossable);
});

test("Recall cleared needs a quiz first, then nothing quiz-only due", function() {
  const due = { id: "a", lesson: "l", cls: "k", archived: 0, lastCorrectSource: "quiz", due: 1 };
  const quiz = [answer(T0, { source: "quiz" })];
  assert.equal(byKey(lib.computeAchievements(facts({ cards: [due] }), TODAY)).recallCleared.tier, 0);
  assert.equal(byKey(lib.computeAchievements(facts({ cards: [due], attempts: quiz }), TODAY)).recallCleared.show.cur, 1);
  const later = Object.assign({}, due, { due: Date.parse("2027-01-01") / 1000 });
  const clear = byKey(lib.computeAchievements(facts({ cards: [later], attempts: quiz }), TODAY)).recallCleared;
  assert.equal(clear.tier, 1);
  assert.equal(clear.show.clearNow, true, "the route records today from this");
  // Levels count the days it was found empty: recorded ones, plus today when it is.
  const days7 = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"];
  assert.equal(byKey(lib.computeAchievements(facts({ cards: [later], attempts: quiz, recallZeroDays: days7 }), TODAY)).recallCleared.tier, 2);
  assert.equal(byKey(lib.computeAchievements(facts({ cards: [due], attempts: quiz, recallZeroDays: days7 }), TODAY)).recallCleared.value, 6);
});

test("recall over recognition needs 30 answers in a week, 70% flashcards", function() {
  const a = [];
  for (let i = 0; i < 30; i++) a.push(answer(T0 + i * 60, { source: i < 21 ? "flashcard" : "quiz" }));
  assert.equal(byKey(lib.computeAchievements(facts({ attempts: a }), TODAY)).recallFirst.tier, 1);
  assert.equal(byKey(lib.computeAchievements(facts({ attempts: a.slice(0, 29) }), TODAY)).recallFirst.tier, 0);
});

test("hours are answer time, in tenths", function() {
  const a = [answer(T0, { ms: 3600 * 1000 * 1.25 })];
  const h = byKey(lib.computeAchievements(facts({ attempts: a }), TODAY)).hoursStudied;
  assert.equal(h.value, 1.2);
  assert.equal(h.tier, 1);
});

test("the route keeps a reached tier, except for lossable ones, which say they were earned", function() {
  const route = fs.readFileSync(path.join(__dirname, "..", "server", "routes", "achievements.js"), "utf8");
  assert.match(route, /const tier = it\.lossable \? it\.tier : Math\.max\(it\.tier, best\);/);
  assert.match(route, /lost: it\.lossable && best > it\.tier/);
  assert.match(route, /if \(it\.tier > \(rec \? rec\.tier : 0\)\)/);
  // due_zero is the server's to write: a client cannot claim it.
  assert.match(route, /const CLIENT_EVENTS = new Set\(\["second_look", "card_fix", "passage_solved"\]\);/);
  assert.match(route, /if \(recall && recall\.show\.clearNow\)\s*db\.prepare\("INSERT OR IGNORE INTO study_events \(user_id, kind, ref\) VALUES \(\?, 'recall_zero', date\('now'\)\)"\)/);
  const attempts = fs.readFileSync(path.join(__dirname, "..", "server", "routes", "attempts.js"), "utf8");
  assert.match(attempts, /typed === true \? 1 : null/);
  assert.match(attempts, /recordDueZero\(/);
});

/* ---------- client ---------- */

const app = fs.readFileSync(path.join(__dirname, "..", "client", "app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "client", "index.html"), "utf8");
function extract(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}
function extractVar(name) {
  const start = app.indexOf("\nvar " + name + " = ");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n};\n", start) + 4);
}
const ctx = {
  state: { language: "en" },
  t: function(k, v) { return k + (v ? "|" + Object.keys(v).map(function(x) { return x + "=" + v[x]; }).join(",") : ""); },
  escHtml: function(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
};
vm.createContext(ctx);
vm.runInContext(["ACH_ICONS", "ACH_ICON_PATHS", "ACH_UNITS"].map(extractVar).join("") +
  ["appLocale", "achIcon", "achMedalTier", "achThresholdLabel", "achDate", "achCountText", "achProgressText", "achBadgeHtml",
   "achEarnedCount", "achNextUp", "achNewlyEarned", "achSnapshot"].map(extract).join(""), ctx);

function item(over) {
  return Object.assign({ key: "writer", group: "effort", tiers: [100, 500, 2000], lossable: false, value: 0, tier: 0,
    next: 100, progress: 0, show: { cur: 0, target: 100 }, earnedAt: null, lost: false }, over);
}

test("medal colour: one per level, bronze to diamond", function() {
  [0, 1, 2, 3, 4, 5].forEach(n => assert.equal(ctx.achMedalTier(n), n));
  assert.equal(ctx.achMedalTier(6), 5);
  const css = fs.readFileSync(path.join(__dirname, "..", "client", "style.css"), "utf8");
  [1, 2, 3, 4, 5].forEach(n => {
    assert.match(css, new RegExp("\\.ach-t" + n + " \\{ color: var\\(--medal-" + n + "\\); \\}"));
    assert.equal(css.split("--medal-" + n + "-bg: #").length - 1, 2, "light and dark tokens for level " + n);
  });
  [1, 2, 3, 4, 5].forEach(n => assert.equal(app.split('"ach.tier' + n + '":').length - 1, 2, "tier " + n + " named in both languages"));
});

test("progress line: count toward the next tier, percent, waiting, goal off, not yet, lost", function() {
  assert.equal(ctx.achProgressText(item({ value: 64, progress: 0.64, show: { cur: 64, target: 100 } })), "ach.progress|cur=64,target=100,unit=ach.unit.typed");
  assert.equal(ctx.achProgressText(item({ key: "longMemory", tiers: [1], next: 1, show: { cur: 91, target: 90, unit: "%" } })), "ach.progressPct|cur=91,target=90");
  assert.equal(ctx.achProgressText(item({ key: "recallCleared", tiers: [1], next: 1, show: { cur: 6, unit: "waiting" } })), "ach.waiting|n=6");
  assert.equal(ctx.achProgressText(item({ key: "goalKeeper", show: { off: true } })), "ach.goalOff");
  assert.equal(ctx.achProgressText(item({ key: "secondLook", tiers: [1], next: 1, show: { cur: 0, target: 1 } })), "ach.notYet");
  assert.match(ctx.achProgressText(item({ key: "lessonMastered", tiers: [1, 10, 50], lost: true, value: 0, show: { cur: 0, target: 1 } })), /^ach\.wasEarned · /);
  // Top of the ladder: the count itself, nothing left to reach.
  assert.equal(ctx.achProgressText(item({ value: 2400, tier: 3, next: null, progress: 1 })), "ach.count|n=2400,unit=ach.unit.typed");
});

test("badge: locked is dashed with progress, earned shows the threshold, a model string is escaped", function() {
  const locked = ctx.achBadgeHtml(item({ value: 50, progress: 0.5, show: { cur: 50, target: 100 } }));
  assert.match(locked, /class="ach-badge ach-locked"/);
  assert.match(locked, /<i style="width:50%">/);
  const silver = ctx.achBadgeHtml(item({ value: 600, tier: 2, next: 2000, progress: 0.3 }));
  assert.match(silver, /ach-badge ach-t2/);
  assert.match(silver, /<span class="ach-tn">500<\/span>/);
  const hours = ctx.achBadgeHtml(item({ key: "hoursStudied", tiers: [1, 10, 50, 100], value: 12, tier: 2, next: 50 }));
  assert.match(hours, /ach-tn">10h</);
  const once = ctx.achBadgeHtml(item({ key: "comeback", tiers: [1], value: 1, tier: 1, next: null, progress: 1, earnedAt: 1790000000 }));
  assert.doesNotMatch(once, /ach-tn|ach-prog/);
  const lost = ctx.achBadgeHtml(item({ key: "classMastered", tiers: [1], lossable: true, lost: true, next: 1 }));
  assert.match(lost, /ach-t1 ach-lost/);
  assert.match(ctx.achBadgeHtml(item({ key: "<x>" })), /data-key="&lt;x>"/);
});

test("next up skips finished, frozen and untouched ones and takes the closest", function() {
  const items = [
    item({ key: "a", progress: 0.4 }),
    item({ key: "b", progress: 0.9, show: { off: true } }),
    item({ key: "c", progress: 0.7 }),
    item({ key: "d", next: null, progress: 1 }),
    item({ key: "e", progress: 0 })
  ];
  assert.equal(ctx.achNextUp(items).key, "c");
  assert.equal(ctx.achNextUp([items[3]]), null);
});

test("session lines: only tiers that rose and were stamped during the session", function() {
  const before = ctx.achSnapshot({ now: 1000, items: [item({ key: "a", tier: 0 }), item({ key: "b", tier: 1 }), item({ key: "c", tier: 0 })] });
  const after = [
    item({ key: "a", tier: 1, earnedAt: 1005 }),
    item({ key: "b", tier: 1, earnedAt: 900 }),
    item({ key: "c", tier: 1, earnedAt: 500 }),   // a lossable one back at a tier it held before
    item({ key: "z", tier: 1, earnedAt: 1005 })   // not in the snapshot
  ];
  assert.deepEqual(Array.from(ctx.achNewlyEarned(before, after, 3), i => i.key), ["a"]);
  assert.deepEqual(Array.from(ctx.achNewlyEarned(null, after, 3)), []);
});

test("every achievement has an icon and both languages carry every string", function() {
  lib.DEFS.forEach(d => {
    assert.ok(ctx.ACH_ICONS[d.key] && ctx.ACH_ICON_PATHS[ctx.ACH_ICONS[d.key]], "icon " + d.key);
    ["name", "desc"].forEach(f => assert.equal(app.split('"ach.' + d.key + '.' + f + '":').length - 1, 2, d.key + "." + f));
  });
  const keys = new Set((app.match(/"ach\.[A-Za-z.]+":/g) || []));
  keys.forEach(k => assert.equal(app.split(k).length - 1, 2, k));
  Object.values(ctx.ACH_UNITS).forEach(u => assert.equal(app.split('"ach.unit.' + u + '":').length - 1, 2, u));
});

test("wiring: sidebar, screen, back paths, strip, events and the typed flag", function() {
  assert.match(html, /id="sidebar-achievements-link"/);
  assert.match(html, /id="screen-achievements"/);
  assert.doesNotMatch(html, /dash-ach-strip/);
  assert.match(app, /"sidebar-vocabulary-link", "sidebar-achievements-link"\]\.forEach/);
  assert.match(app, /achievements: "btn-achievements-back"/);
  assert.match(app, /SCREEN_BACK_BTN\[screen\] && document.getElementById\(SCREEN_BACK_BTN\[screen\]\)/);  // the edge swipe uses the same map
  assert.match(app, /screen === "achievements"\) \{\s*if \(e\.key === "Escape"\)/);
  // The Dashboard shows them in the Streak tile, filled once the hero card is drawn.
  assert.match(extract("renderDashboard"), /streakTimeHeroCard\([^)]*\{ due: d\.dueForReview \|\| \[\], futureDue: futureDue \}\);\s*renderDashAchievements\(\);/);
  assert.match(extract("heroStreakTile"), /withAchievements \? '<div data-ach-mini>'/);
  assert.match(extract("beginStudySession"), /state\.sessionAchAtStart = achSnapshot\(data\)/);
  assert.match(extract("markCard"), /if \(state\.typeToCompare && document\.getElementById\("fc-type-input"\)\.value\.trim\(\)\) attemptFields\.typed = true;/);
  assert.match(app, /if \(f\.typed\) body\.typed = true;/);
  assert.match(extract("syncEditedCardIntoStudySession"), /if \(state\.editFromStudy\) recordStudyEvent\("card_fix", cardId\);/);
  assert.equal(app.split("openEditCard(card.id, card, true);").length - 1, 2);
  assert.equal(app.split("renderQuizCard();\n  noteQuizSecondLook();").length - 1, 2);
  assert.match(extract("noteQuizSecondLook"), /if \(res && !res\.correct\) recordStudyEvent\("second_look", card\.id\);/);
  assert.match(extract("checkGapfill"), /if \(!wrong\) recordStudyEvent\("passage_solved", st\.cardId \+ ":" \+ new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\);/);
});

/* ---------- five levels ---------- */

test("every achievement has five levels, and each step asks more than the one before", function() {
  lib.DEFS.forEach(d => {
    assert.equal(d.tiers.length, 5, d.key);
    for (let i = 2; i < 5; i++)
      assert.ok(d.tiers[i] - d.tiers[i - 1] >= d.tiers[i - 1] - d.tiers[i - 2], d.key + " step " + i);
  });
});

function migration() {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "db.js"), "utf8");
  const start = src.indexOf('runMigration("achievement_ladders_v2"');
  assert.ok(start >= 0);
  const body = src.slice(start, src.indexOf("\n});\n", start) + 4);
  return function(rows) {
    const updates = [];
    const db = { prepare: (sql) => ({ all: () => rows, run: (...a) => updates.push(a) }) };
    let ladders;
    vm.runInNewContext(body.replace("var rows =", "ladders = { OLD: OLD, NEW: NEW }; var rows ="),
      { db, runMigration: (n, fn) => fn(), get ladders() { return ladders; }, set ladders(v) { ladders = v; } });
    return { updates, ladders };
  };
}

test("the migration moves a recorded tier to the level of the threshold it stood for", function() {
  const run = migration();
  const { updates, ladders } = run([
    { user_id: "u", key: "dayStreak", tier: 2 },       // 30 days: level 3 now
    { user_id: "u", key: "steadyRhythm", tier: 1 },    // 4 weeks: level 2
    { user_id: "u", key: "writer", tier: 3 },          // 2000: still level 3
    { user_id: "u", key: "longMemory", tier: 1 },      // the old one step: level 1
    { user_id: "u", key: "freshStart", tier: 1 },
    { user_id: "u", key: "gone", tier: 2 }
  ]);
  assert.deepEqual(updates, [[3, "u", "dayStreak"], [2, "u", "steadyRhythm"]]);
  // Frozen ladders match today's, and every old threshold is on its new ladder.
  lib.DEFS.filter(d => ladders.OLD[d.key]).forEach(d => {
    assert.deepEqual(Array.from(ladders.NEW[d.key]), d.tiers, d.key);
    ladders.OLD[d.key].forEach(x => assert.ok(d.tiers.includes(x), d.key + " keeps " + x));
  });
});

test("full month: every day of a calendar month, the one in progress only once it is complete", function() {
  const sept = [];
  for (let i = 1; i <= 30; i++) sept.push("2026-09-" + String(i).padStart(2, "0"));
  assert.equal(lib.fullMonths(sept), 1);
  assert.equal(lib.fullMonths(sept.slice(1)), 0);
  assert.equal(lib.fullMonths(sept.concat(["2026-10-01", "2026-10-02"])), 1);
  const feb = [];
  for (let i = 1; i <= 28; i++) feb.push("2027-02-" + String(i).padStart(2, "0"));
  assert.equal(lib.fullMonths(feb), 1);
});

test("learned, chapter and book done count graded cards; deep memory counts live deep ones", function() {
  const c = (id, lesson, cls, more) => Object.assign({ id, lesson, cls, archived: 0, due: 1, ext: "x" + id, mastered: 0, deep: 0 }, more);
  const cards = [
    c("a", "l1", "k1", { deep: 1 }), c("b", "l1", "k1"), c("c", "l2", "k1", { due: null }),
    c("d", "l3", "k2"), c("e", "l4", "k3", { ext: null }),
    c("f", "l5", "k4", { archived: 1, deep: 1 })
  ];
  const r = byKey(lib.computeAchievements(facts({ cards }), TODAY));
  assert.equal(r.cardsLearned.value, 5);
  assert.equal(r.chapterDone.value, 3, "l1, l3 and l4; l2 has a new card; archived l5 is set aside");
  assert.equal(r.bookDone.value, 1, "k2 only: k1 has a new card, k3 is not from a book");
  assert.equal(r.deepMemory.value, 1);
  assert.ok(r.deepMemory.lossable && !r.chapterDone.lossable && !r.bookDone.lossable);
});

test("sharp session: 20+ quiz answers at 90%; second chance: missed then right in one session", function() {
  const a = [];
  for (let i = 0; i < 20; i++) a.push(answer(T0 + i * 30, { source: "quiz", correct: i < 18 ? 1 : 0, card: "q" + i }));
  a.push(answer(T0 + 20 * 30, { source: "quiz", correct: 1, card: "q18" }));
  a.push(answer(T0 + 21 * 30, { source: "quiz", correct: 1, card: "q18" }));
  let r = byKey(lib.computeAchievements(facts({ attempts: a }), TODAY));
  assert.equal(r.sharpSession.value, 1);
  assert.equal(r.secondChance.value, 1, "q18 once; q19 never came back right; a repeat right does not count twice");
  a.push(answer(T0 + 22 * 30, { source: "quiz", correct: 0, card: "q0" }), answer(T0 + 23 * 30, { source: "quiz", correct: 0, card: "q1" }));
  r = byKey(lib.computeAchievements(facts({ attempts: a }), TODAY));
  assert.equal(r.sharpSession.value, 0, "19 of 24 is under 90%");
  // A miss in one session and a right answer in the next is not a second chance.
  const split = [answer(T0, { correct: 0 }), answer(T0 + 11 * 60, { correct: 1 })];
  assert.equal(byKey(lib.computeAchievements(facts({ attempts: split }), TODAY)).secondChance.value, 0);
});

test("one-off achievements became counts: sessions, weeks, books, events", function() {
  const a = [];
  for (let s = 0; s < 2; s++)
    for (let i = 0; i < 30; i++) a.push(answer(T0 + s * 3600 + i * 60, { ms: 60000, cls: "k" + (i % 3), ext: "e", card: "c" + i }));
  const r = byKey(lib.computeAchievements(facts({ attempts: a, secondLooks: 5, passagesSolved: 10 }), TODAY));
  assert.equal(r.deepSession.value, 2);
  assert.equal(r.mixedPractice.value, 2);
  assert.equal(r.fromTheBook.value, 3);
  assert.equal(r.secondLook.tier, 2);
  assert.equal(r.passageSolved.tier, 1);
  assert.equal(r.deepSession.show.cur, 2, "after the first, the line counts toward the next level");
});
