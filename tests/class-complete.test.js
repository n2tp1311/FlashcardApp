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
  vm.runInContext(["classDoneLevel", "classProgressHtml"].map(extract).join(""), ctx);
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
  assert.match(extract("setClassProgress"), /setClassDoneMedal\(classId, p\);[^]*if \(p\.mastery\) \{ renderMasteryBar\(wrap, p\); return; \}/);
});

test("the medallion's tooltip names its level, in both languages", function() {
  for (const k of ["class.learnedTooltip", "class.masteredTooltip", "class.completeTooltip"]) {
    assert.equal(app.split('"' + k + '":').length - 1, 2, k);
  }
  assert.doesNotMatch(app, /"class\.complete":/);
});

test("the medallion hides under the hover buttons in the grid card's corner", function() {
  const css = fs.readFileSync(path.join(root, "client", "style.css"), "utf8");
  assert.match(css, /\.class-card:hover \.class-done-medal \{ opacity: 0; \}/);
});
