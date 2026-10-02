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

const ctx = {
  state: {},
  t: function(k, v) { return k + (v ? "|" + Object.keys(v).map(function(x) { return x + "=" + v[x]; }).join(",") : ""); },
  escHtml: function(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); },
  futureDueBuckets: function(d) { return d.days; }
};
vm.createContext(ctx);
vm.runInContext("var DASH_DUE_SHOWN = 4;" +
  ["dashLessonTableRows", "dashNeedsAttention", "sortDashLessons", "dashLessonTableHtml", "heroDueTile"].map(extract).join(""), ctx);

const LESSONS = [
  { id: "a", class_id: "k", title: "Alpha", class_name: "K", cards: 10, mastered: 5 },
  { id: "b", class_id: "k", title: "Beta", class_name: "K", cards: 4, mastered: 0 },
  { id: "c", class_id: "k", title: "Gamma", class_name: "K", cards: 0, mastered: 0 },
  { id: "d", class_id: "k", title: "Delta", class_name: "K", cards: 8, mastered: 8 }
];
const BREAKDOWN = [
  { id: "a", total_attempts: 40, correct_attempts: 30 },
  { id: "b", total_attempts: 20, correct_attempts: 6 },
  { id: "d", total_attempts: 10, correct_attempts: 10 },
  { id: "zz", total_attempts: 5, correct_attempts: 5 }   // an archived class's lesson: not in lessons
];
const DUE = [{ id: "a", dueCount: 2 }, { id: "d", dueCount: 5 }];
const STRUGGLING = [{ id: "b", hardRatio: 0.6 }];

function rows() { return ctx.dashLessonTableRows(LESSONS, BREAKDOWN, DUE, STRUGGLING); }

test("one row per lesson, merging accuracy, due and struggling by lesson id", function() {
  const r = rows();
  assert.deepEqual(Array.from(r, x => x.id), ["a", "b", "c", "d"]);
  const a = r[0], b = r[1], c = r[2];
  assert.equal(a.accuracy, 75); assert.equal(a.attempts, 40); assert.equal(a.due, 2); assert.equal(a.hardRatio, null);
  assert.equal(b.accuracy, 30); assert.equal(b.hardRatio, 0.6);
  assert.equal(c.accuracy, null); assert.equal(c.attempts, 0);
});

test("needs attention: anything due or struggling, most due first", function() {
  const attn = ctx.sortDashLessons(rows().filter(ctx.dashNeedsAttention), "attention");
  assert.deepEqual(Array.from(attn, x => x.id), ["d", "a", "b"]);
});

test("column sorts; a lesson with nothing to show goes last either way", function() {
  assert.deepEqual(Array.from(ctx.sortDashLessons(rows(), "accuracy", "asc"), x => x.id), ["b", "a", "d", "c"]);
  assert.deepEqual(Array.from(ctx.sortDashLessons(rows(), "accuracy", "desc"), x => x.id), ["d", "a", "b", "c"]);
  assert.deepEqual(Array.from(ctx.sortDashLessons(rows(), "mastered", "desc"), x => x.id), ["d", "a", "b", "c"]);
  assert.deepEqual(Array.from(ctx.sortDashLessons(rows(), "name", "asc"), x => x.id), ["a", "b", "d", "c"]);
});

test("table: sort headers only when sortable, due opens a review, names are escaped", function() {
  const plain = ctx.dashLessonTableHtml(rows(), { days: 60 });
  assert.doesNotMatch(plain, /dash-lsort/);
  const r = rows();
  r[0].title = "<img src=x>";
  const out = ctx.dashLessonTableHtml(r, { sortable: true, sortKey: "accuracy", sortDir: "asc", days: 60 });
  assert.match(out, /class="dash-lsort is-on" data-sort="accuracy" aria-sort="ascending">dashboard\.colAccuracy ↑/);
  assert.match(out, /&lt;img src=x>/);
  assert.doesNotMatch(out, /<img/);
  assert.match(out, /data-due-lesson="a" data-due-class="k"/);
  assert.match(out, /dashboard\.strugglingHint\|pct=60,n=60/);
  assert.match(out, /dash-lacc is-bad[^>]*>30%/);
  assert.match(out, /data-label="dashboard\.colMastered">—</);  // no cards
});

test("due tile: total, most due first, the rest counted, and what falls due later", function() {
  const due = [1, 2, 3, 4, 5].map(i => ({ id: "l" + i, class_id: "k", title: "L" + i, class_name: "K", dueCount: i }));
  const out = ctx.heroDueTile(due, { windowDays: 14, days: [{ n: 0, cnt: 9 }, { n: 1, cnt: 2 }, { n: 5, cnt: 3 }] });
  assert.match(out, /dash-tile-num">15</);
  assert.deepEqual(out.match(/data-due-lesson="(l\d)"/g), ['data-due-lesson="l5"', 'data-due-lesson="l4"', 'data-due-lesson="l3"', 'data-due-lesson="l2"']);
  assert.match(out, /dashboard\.moreLessonsDue\|n=1/);
  assert.match(out, /dashboard\.dueLater\|n=5,days=14/);
  assert.match(ctx.heroDueTile([], null), /dashboard\.allCaughtUp/);
});

test("three tabs with panels; the old lesson lists and period note are gone", function() {
  for (const tab of ["overview", "charts", "lessons"]) {
    assert.match(html, new RegExp('id="dash-tab-' + tab + '" data-tab="' + tab + '" aria-controls="dash-panel-' + tab + '"'));
    assert.match(html, new RegExp('id="dash-panel-' + tab + '" role="tabpanel"'));
  }
  for (const gone of ["dash-lesson-wrap", "dash-due-list", "dash-struggle-list", "dash-period-note", "dash-ach-strip"]) {
    assert.doesNotMatch(html, new RegExp(gone));
    assert.doesNotMatch(app, new RegExp('"' + gone + '"'));
  }
  // The period pills sit with the charts they change.
  const charts = html.slice(html.indexOf('id="dash-panel-charts"'), html.indexOf('id="dash-panel-lessons"'));
  assert.match(charts, /id="dash-period-bar"/);
  assert.match(charts, /id="dash-studytime-card"/);
});

test("switching to Charts redraws at the real width; the period change refreshes the lesson table", function() {
  assert.match(extract("setDashTab"), /if \(tab === "charts"\) redrawDashCharts\(\);/);
  assert.match(app, /redrawDashCharts\(\);\n  \}, 200\);/);
  assert.match(app, /state\.dashLessonData\.struggling = analytics\.strugglingLessons \|\| \[\];\s*state\.dashLessonData\.days = days;\s*renderDashLessons\(\);/);
  assert.match(extract("_refreshDashHeroCards"), /gridId === "dash-summary-grid" \? state\._dashHeroDash : undefined/);
  assert.match(extract("_refreshDashHeroCards"), /renderDashStudyTime\(\);/);
});

test("server: every live lesson with its card and mastered counts", function() {
  assert.match(stats, /SUM\(CASE WHEN " \+ MASTERED_SQL \+ " THEN 1 ELSE 0 END\) AS mastered/);
  assert.match(stats, /\.all\(MASTERED_INTERVAL_SEC, uid, uid\)\.forEach\(r => \{ masteryMap\[r\.lesson_id\] = r; \}\);/);
  assert.match(stats, /dueByClass,\n    lessons,/);
});

test("new strings exist in both languages", function() {
  for (const k of ["tabOverview", "tabCharts", "tabLessons", "needsAttention", "allLessons", "colLesson", "colAccuracy", "colAnswers",
    "colMastered", "colDue", "struggling", "strugglingHint", "lessonsNote", "nothingNeedsAttention", "noLessons", "dueNow", "cardsDue",
    "moreLessonsDue", "dueLater", "achAll", "filterAll"]) {
    assert.equal(app.split('"dashboard.' + k + '":').length - 1, 2, k);
  }
});
