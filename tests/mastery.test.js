const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const stats = fs.readFileSync(path.join(root, "server", "routes", "stats.js"), "utf8");
const mastery = fs.readFileSync(path.join(root, "server", "lib", "mastery.js"), "utf8");

function extract(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}

const ctx = {
  t: function(k, v) { return k + (v ? "|" + Object.keys(v).map(function(x) { return x + "=" + v[x]; }).join(",") : ""); },
  escHtml: function(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
};
vm.createContext(ctx);
vm.runInContext('var MASTERY_ORDER = ["mastered", "known", "learning"];' + extract("renderMasteryBar"), ctx);

test("segments are sized by share of the lesson, mastered first, new left as the track", function() {
  const wrap = { innerHTML: "" };
  ctx.renderMasteryBar(wrap, { total: 8, known: 3, mastery: { mastered: 2, known: 1, learning: 4, new: 1 } });
  assert.match(wrap.innerHTML, /mastery-mastered" style="width:25\.00%"[\s\S]*mastery-known" style="width:12\.50%"[\s\S]*mastery-learning" style="width:50\.00%"/);
  assert.doesNotMatch(wrap.innerHTML, /mastery-new/);
  assert.match(wrap.innerHTML, /mastery\.text\|pct=25/);
  assert.match(wrap.innerHTML, /role="img" aria-label="mastery\.tooltip\|mastered=2,remembered=1,learning=4,fresh=1,flagged=3,total=8"/);
});

test("empty buckets draw no segment", function() {
  const wrap = { innerHTML: "" };
  ctx.renderMasteryBar(wrap, { total: 4, known: 0, mastery: { mastered: 0, known: 0, learning: 0, new: 4 } });
  assert.doesNotMatch(wrap.innerHTML, /<i /);
  assert.match(wrap.innerHTML, /pct=0/);
});

test("server buckets: no FSRS state is new, learning/relearning, then 21-day review interval splits known from mastered", function() {
  assert.match(mastery, /const MASTERED_INTERVAL_SEC = 21 \* 86400;/);
  assert.match(mastery, /cs\.fsrs_state = 2 AND " \+\s*"cs\.srs_due_at - COALESCE\(cs\.fsrs_last_review_at, cs\.updated_at\) >= \?\)"/);
  assert.match(stats, /WHEN cs\.card_id IS NULL OR cs\.fsrs_stability IS NULL THEN 'new'/);
  assert.match(stats, /WHEN cs\.fsrs_state IN \(1,3\) THEN 'learning'/);
  assert.match(stats, /"    WHEN " \+ MASTERED_SQL \+ " THEN 'mastered'"/);
  assert.match(stats, /res\.json\(\{ total, known, mastery: lessonMastery\(req\.params\.id, req\.session\.userId\) \}\)/);
  assert.match(stats, /res\.json\(\{ total, known, mastery: classMastery\(req\.params\.id, req\.session\.userId\) \}\)/);
  assert.match(stats, /masteryCounts\("c\.lesson_id IN \(SELECT id FROM lessons WHERE class_id = \?\)", classId, userId\)/);
});

test("a nearly mastered deck never reads 100%", function() {
  const wrap = { innerHTML: "" };
  ctx.renderMasteryBar(wrap, { total: 240, known: 0, mastery: { mastered: 239, known: 1, learning: 0, new: 0 } });
  assert.match(wrap.innerHTML, /mastery\.text\|pct=99/);
  ctx.renderMasteryBar(wrap, { total: 240, known: 0, mastery: { mastered: 240, known: 0, learning: 0, new: 0 } });
  assert.match(wrap.innerHTML, /mastery\.text\|pct=100/);
});

test("lesson rows use the mastery bar when the server sends it, the old bar otherwise", function() {
  assert.match(extract("_renderLessonItems"), /if \(p\.mastery\) \{\s*renderMasteryBar\(wrap, p\);\s*return;\s*\}/);
  assert.equal(app.split('"mastery.tooltip":').length - 1, 2);
});

test("the class page draws one mastery bar for the whole class above its lessons", function() {
  const html = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
  assert.match(html, /<\/header>\s*<div id="class-mastery" class="class-mastery hidden"><\/div>\s*<div class="lesson-sort-bar">/);
  const fn = extract("_renderClassMastery");
  assert.match(fn, /store\.getProgress\("class", classId\)/);
  assert.match(fn, /state\.currentClass\.id !== classId\) return;\s*renderMasteryBar\(el, p\);/);
  assert.match(extract("renderLessons"), /_renderClassMastery\(state\.currentClass\.id\);/);
});
