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
  vm.runInContext(["classComplete", "classProgressHtml"].map(extract).join(""), ctx);
  return ctx;
}

test("a class is complete only when every card is known", function() {
  const ctx = load();
  assert.equal(ctx.classComplete({ known: 240, total: 240 }), true);
  assert.equal(ctx.classComplete({ known: 239, total: 240 }), false);
  assert.equal(ctx.classComplete({ known: 0, total: 0 }), false);
  assert.equal(ctx.classComplete(null), false);
});

test("an incomplete class never reads 100%", function() {
  const ctx = load();
  const html = ctx.classProgressHtml({ known: 239, total: 240 });
  assert.equal(html, "count.knownProgress|known=239,total=240,pct=99");
  assert.doesNotMatch(html, /class-done-pill/);
});

test("a complete class shows the Complete pill and its card count", function() {
  const ctx = load();
  const html = ctx.classProgressHtml({ known: 240, total: 240 });
  assert.match(html, /<span class="class-done-pill"><svg[^]*class\.complete<\/span><span>count\.cards\|n=240<\/span>/);
});

test("both the grid card and the list row use the shared progress setter", function() {
  assert.equal(app.split('store.getProgress("class", cls.id).then(function(p) { setClassProgress(cls.id, p); });').length - 1, 2);
});

test("with the server's mastery counts, complete means every card mastered, not every card known", function() {
  const ctx = load();
  const m = (mastered) => ({ mastered: mastered, known: 240 - mastered, learning: 0, new: 0 });
  assert.equal(ctx.classComplete({ known: 240, total: 240, mastery: m(72) }), false);
  assert.equal(ctx.classComplete({ known: 3, total: 240, mastery: m(240) }), true);
  assert.doesNotMatch(ctx.classProgressHtml({ known: 240, total: 240, mastery: m(72) }), /class-done-pill/);
});

test("class cards draw the mastery bar when the server sends it, the Know It bar otherwise", function() {
  assert.match(extract("setClassProgress"), /if \(p\.mastery\) \{\s*renderMasteryBar\(wrap, p\);/);
  assert.equal(app.split('"class.masteredTooltip":').length - 1, 2);
});
