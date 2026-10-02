const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");

function extract(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}

function load() {
  const ctx = {
    t: function(k, v) { return k + (v ? "|" + Object.keys(v).map(function(x) { return x + "=" + v[x]; }).join(",") : ""); },
    escHtml: function(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  };
  vm.createContext(ctx);
  vm.runInContext("var CHART_PAD = { l: 34, r: 6, t: 8, b: 18 };" +
    ["chartScale", "chartTick", "chartLabelIndices", "chartWeeks", "chartWeekLabel", "chartXAxis", "chartColumnsSvg",
     "chartLineSvg", "chartKpisHtml", "futureDueBuckets", "gradeSegments"].map(extract).join(""), ctx);
  return ctx;
}

test("the y axis tops out at a round number in at most four steps", function() {
  const ctx = load();
  assert.deepEqual({ ...ctx.chartScale(2149) }, { top: 3000, step: 1000 }, "500s would take five steps");
  assert.deepEqual({ ...ctx.chartScale(151) }, { top: 200, step: 50 });
  assert.deepEqual({ ...ctx.chartScale(3) }, { top: 3, step: 1 }, "counts never get fractional steps");
  assert.deepEqual({ ...ctx.chartScale(0) }, { top: 1, step: 1 });
  assert.equal(ctx.chartTick(2500), "2.5k");
});

test("x labels thin out to fit, always keep the last, and never crowd it", function() {
  const ctx = load();
  assert.deepEqual([...ctx.chartLabelIndices(13, 200)], [0, 3, 6, 9, 12]);
  assert.deepEqual([...ctx.chartLabelIndices(15, 300)], [0, 3, 6, 9, 14]);
  assert.deepEqual([...ctx.chartLabelIndices(14, 200)], [0, 3, 6, 9, 13], "12 would sit on top of 13");
  assert.deepEqual([...ctx.chartLabelIndices(3, 600)], [0, 1, 2]);
});

test("a 90-day window draws weeks 12 back to this one: week 13 can never hold an answer", function() {
  assert.match(app, /var weeksBack = Math\.floor\(\(days - 1\) \/ 7\);/);
  const ctx = load();
  assert.deepEqual([...ctx.chartWeeks(Math.floor((90 - 1) / 7))], [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  assert.deepEqual([...ctx.chartWeeks(Math.floor((7 - 1) / 7))], [0]);
});

test("columns are drawn to scale at the container's pixel width, the hot one marked", function() {
  const ctx = load();
  const svg = ctx.chartColumnsSvg({ width: 300, labels: ["a", "b", "c"], values: [50, 0, 100], cls: "answers", hot: 2 });
  assert.match(svg, /width="300" height="150" viewBox="0 0 300 150"/);
  assert.equal((svg.match(/<rect /g) || []).length, 2, "a zero draws no bar");
  // top 100 over a 124px plot: 50 is 62px tall, 100 is the full 124px
  assert.match(svg, /class="chart-bar chart-bar-answers" x="[\d.]+" y="70\.0" width="[\d.]+" height="62\.0"/);
  assert.match(svg, /class="chart-bar chart-bar-answers is-hot" x="[\d.]+" y="8\.0" width="[\d.]+" height="124\.0"/);
});

test("the line skips weeks with no value and keeps the axis it was given", function() {
  const ctx = load();
  const svg = ctx.chartLineSvg({ width: 300, labels: ["a", "b", "c"], values: [80, null, 100], min: 60, max: 100, ticks: [60, 80, 100],
    cls: "accuracy", fmt: function(v) { return v + "%"; } });
  assert.equal((svg.match(/<circle /g) || []).length, 2);
  assert.match(svg, /<path class="chart-line chart-line-accuracy" d="M[\d.]+ 70\.0 L[\d.]+ 8\.0"/);
  assert.match(svg, />60%<\/text>[\s\S]*>100%<\/text>/);
});

test("the headline row compares this week with last week", function() {
  const ctx = load();
  const analytics = {
    weeklyTrend: [{ weeks_ago: 0, cnt: 1913, correct: 1798 }, { weeks_ago: 1, cnt: 1242, correct: 1118 }],
    newCardsWeeklyTrend: [{ weeks_ago: 0, cnt: 421 }, { weeks_ago: 1, cnt: 317 }],
    reviewTimeTrend: [{ weeks_ago: 0, samples: 10, avg_ms: 22000 }, { weeks_ago: 1, samples: 10, avg_ms: 20000 }]
  };
  const due = { windowDays: 2, days: [] };
  const out = ctx.chartKpisHtml(analytics, due);
  assert.match(out, /chart\.kpiAnswers[\s\S]*1,913[\s\S]*chart-delta up">▲ 54%/);
  assert.match(out, /94%[\s\S]*chart-delta up">▲ chart\.points\|n=4/);
  assert.match(out, /chart-delta flat">▲ 104/, "more new cards is not good or bad by itself");
  assert.match(out, /unit\.s\|n=22[\s\S]*chart-delta flat">▲ unit\.s\|n=2/);
  assert.match(out, /chart\.kpiDue\|n=2[\s\S]*>0</);
  const fresh = ctx.chartKpisHtml({ weeklyTrend: [{ weeks_ago: 0, cnt: 5, correct: 5 }], newCardsWeeklyTrend: [], reviewTimeTrend: [] }, null);
  assert.match(fresh, /chart\.noLastWeek/);
  assert.doesNotMatch(fresh, /chart\.kpiDue/, "no forecast, no due tile");
});

test("the grade split keeps Again first and folds quiz answers by result", function() {
  const ctx = load();
  const segs = ctx.gradeSegments([
    { source: "flashcard", grade: null, correct: 1, cnt: 10 },
    { source: "quiz", grade: null, correct: 0, cnt: 2 },
    { source: "flashcard", grade: "easy", correct: 1, cnt: 3 },
    { source: "flashcard", grade: null, correct: 0, cnt: 4 },
    { source: "quiz", grade: null, correct: 1, cnt: 5 }
  ]);
  assert.deepEqual(Array.from(segs, function(s) { return s.cls + ":" + s.cnt; }), ["again:4", "easy:3", "quiz-correct:5", "quiz-incorrect:2", "ungraded:10"]);
});

test("the section is a headline row, four weekly charts, then the rest", function() {
  const at = function(s) { const i = html.indexOf(s); assert.ok(i > 0, s); return i; };
  assert.ok(at('id="dash-chart-kpis"') < at('id="dash-trend-wrap"'));
  assert.ok(at('id="dash-trend-wrap"') < at('id="dash-retention-wrap"'));
  assert.ok(at('id="dash-retention-wrap"') < at('id="dash-newcards-trend-wrap"'));
  assert.ok(at('id="dash-newcards-trend-wrap"') < at('id="dash-reviewtime-wrap"'));
  assert.ok(at('id="dash-reviewtime-wrap"') < at('id="dash-heatmap-wrap"'));
  assert.ok(at('id="dash-heatmap-wrap"') < at('id="dash-grade-wrap"'));
  assert.match(html, /analytics-charts-grid is-four/);
  for (const k of ["chart.kpiAnswers", "chart.vsLastWeek", "chart.busiest", "chart.perWeek", "chart.point"]) {
    assert.equal(app.split('"' + k + '":').length - 1, 2, k);
  }
});
