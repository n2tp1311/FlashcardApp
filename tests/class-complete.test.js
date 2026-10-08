const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");

function extract(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}

function load() {
  const ctx = {
    t: function(k, v) { return k + (v ? "|" + Object.keys(v).map(function(x) { return x + "=" + v[x]; }).join(",") : ""); },
    escHtml: function(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
  };
  vm.createContext(ctx);
  vm.runInContext(["classDoneLevel", "classProgressHtml", "classGoalText", "classMedalTip"].map(extract).join(""), ctx);
  return ctx;
}

const m = (mastered, known, learning, fresh) => ({ mastered, known, learning: learning || 0, new: fresh || 0 });

test("local mode: every card marked Know It is Learned, never Mastered", function() {
  const ctx = load();
  assert.equal(ctx.classDoneLevel({ known: 240, total: 240 }), "learned");
  assert.equal(ctx.classDoneLevel({ known: 239, total: 240 }), null);
  assert.equal(ctx.classDoneLevel({ known: 0, total: 0 }), null);
  assert.equal(ctx.classDoneLevel(null), null);
});

test("server mode: Learned once nothing is New or Learning, Mastered once every card is", function() {
  const ctx = load();
  assert.equal(ctx.classDoneLevel({ known: 3, total: 240, mastery: m(72, 168) }), "learned");
  assert.equal(ctx.classDoneLevel({ known: 240, total: 240, mastery: m(72, 167, 1) }), null);
  assert.equal(ctx.classDoneLevel({ known: 240, total: 240, mastery: m(72, 167, 0, 1) }), null);
  assert.equal(ctx.classDoneLevel({ known: 3, total: 240, mastery: m(240, 0) }), "mastered");
  assert.equal(ctx.classDoneLevel({ known: 0, total: 0, mastery: m(0, 0) }), null);
});

test("an incomplete class never reads 100%", function() {
  const ctx = load();
  assert.equal(ctx.classProgressHtml({ known: 239, total: 240 }), "count.knownProgress|known=239,total=240,pct=99");
  assert.equal(ctx.classProgressHtml({ known: 240, total: 240 }), "count.knownProgress|known=240,total=240,pct=100");
});

test("both the grid card and the list row carry the medallion and the shared progress setter", function() {
  assert.equal(app.split('store.getProgress("class", cls.id).then(function(p) { setClassProgress(cls.id, p); });').length - 1, 2);
  assert.equal(app.split('<span class="class-done-medal hidden" id="cls-done-\' + cls.id + \'" role="img"></span>').length - 1, 2);
  assert.match(extract("setClassProgress"), /setClassDoneMedal\(classId, p\);[^]*if \(p\.mastery\) \{\s*renderMasteryBar\(wrap, p\);[^]*?return;\s*\}/);
});

test("the medallion's tooltip names its level, in both languages", function() {
  for (const k of ["class.learnedTooltip", "class.masteredTooltip", "class.completeTooltip"]) {
    assert.equal(app.split('"' + k + '":').length - 1, 2, k);
  }
  assert.doesNotMatch(app, /"class\.complete":/);
});

test("the hover buttons make room for the badge instead of covering it", function() {
  const css = fs.readFileSync(path.join(root, "client", "style.css"), "utf8");
  assert.doesNotMatch(css, /\.class-card:hover \.class-done-medal \{ opacity: 0; \}/);
  assert.match(css, /\.class-card\.has-medal \.class-card-actions \{ right: 46px; \}/);
});

test("the empty badge names what is left: new cards, cards in Learning, or both", function() {
  const ctx = load();
  assert.equal(ctx.classGoalText({ known: 240, total: 240, mastery: m(20, 211, 9) }), "class.goalLearning|n=0,l=9");
  assert.equal(ctx.classGoalText({ known: 0, total: 240, mastery: m(0, 228, 0, 12) }), "class.goalNew|n=12,l=0");
  assert.equal(ctx.classGoalText({ known: 0, total: 240, mastery: m(0, 219, 9, 12) }), "class.goalNewLearning|n=12,l=9");
  assert.equal(ctx.classGoalText({ known: 230, total: 240 }), "class.goalKnown|n=10");
  for (const lang of ["en", "vi"]) {
    const block = app.slice(app.indexOf(lang === "en" ? '"class.learnedTooltip": "Every' : '"class.learnedTooltip": "Mọi'));
    for (const k of ["goalLearning", "goalNew", "goalNewLearning", "goalKnown"]) assert.match(block.slice(0, 1200), new RegExp('"class\\.' + k + '":'), lang + " " + k);
  }
});

test("a tap on the badge shows its tip instead of opening the class", function() {
  const ctx = load();
  const shown = [];
  ctx.showToast = function(msg) { shown.push(msg); };
  const medal = { title: "To earn the ✓, get every card in Learning right (9 left)" };
  const on = { target: { closest: (sel) => sel === ".class-done-medal" ? medal : null } };
  assert.equal(ctx.classMedalTip(on), true);
  assert.deepEqual(shown, [medal.title]);
  assert.equal(ctx.classMedalTip({ target: { closest: () => null } }), false, "elsewhere on the card opens the class");
  assert.match(app, /if \(!state\.homeSelectMode && classMedalTip\(e\)\) return;[\s\S]*if \(!state\.homeSelectMode && classMedalTip\(e\)\) return;/, "grid card and list row both");
});
