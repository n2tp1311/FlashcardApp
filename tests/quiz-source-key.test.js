const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");

function load(panel) {
  const start = app.indexOf("\nfunction toggleQuizSource(");
  assert.ok(start >= 0, "missing toggleQuizSource");
  const ctx = { document: { getElementById: function(id) { return id === "quiz-source" ? panel : null; } } };
  vm.createContext(ctx);
  vm.runInContext(app.slice(start, app.indexOf("\n}\n", start) + 3), ctx);
  return ctx;
}

test("B opens From the book, and pressing it again closes it", function() {
  const panel = { open: false, scrolled: 0, scrollIntoView: function() { this.scrolled++; } };
  const ctx = load(panel);
  assert.equal(ctx.toggleQuizSource(), true);
  assert.equal(panel.open, true);
  assert.equal(panel.scrolled, 1);
  ctx.toggleQuizSource();
  assert.equal(panel.open, false);
});

test("B does nothing before the passage is shown", function() {
  assert.equal(load(null).toggleQuizSource(), false);
});

test("the quiz binds B and lists it in the keymap, in both languages", function() {
  assert.match(app, /e\.key === "b" \|\| e\.key === "B"\) && !e\.ctrlKey && !e\.metaKey && !e\.altKey && toggleQuizSource\(\)/);
  assert.match(html, /<kbd class="kbd">B<\/kbd><span data-i18n="keymap.fromTheBook">/);
  assert.equal((app.match(/"keymap\.fromTheBook":/g) || []).length, 2);
});
