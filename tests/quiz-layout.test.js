const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "client", "style.css"), "utf8");

function fn(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}

function load(stored, throws) {
  const store = stored == null ? {} : { "fc-quiz-layout": stored };
  const classes = new Set();
  const attrs = {};
  const btn = { innerHTML: "", title: "", setAttribute: function(k, v) { attrs[k] = v; } };
  const opts = { classList: { toggle: function(c, on) { on ? classes.add(c) : classes.delete(c); } } };
  const ctx = {
    localStorage: { getItem: function(k) { if (throws) throw new Error("blocked"); return store[k] || null; } },
    document: { getElementById: function(id) { return id === "quiz-options" ? opts : btn; } },
    t: function(k) { return k; },
    ICON_LAYOUT_LIST: "LIST", ICON_LAYOUT_GRID: "GRID",
  };
  vm.createContext(ctx);
  vm.runInContext(fn("quizLayout") + fn("applyQuizLayout"), ctx);
  return { ctx, classes, attrs, btn };
}

test("answers are a list unless the grid was chosen", function() {
  assert.equal(load(null).ctx.quizLayout(), "list");
  assert.equal(load("grid").ctx.quizLayout(), "grid");
  assert.equal(load("nonsense").ctx.quizLayout(), "list");
  assert.equal(load(null, true).ctx.quizLayout(), "list");
});

test("the grid layout tags the options and the button offers the list back", function() {
  const g = load("grid");
  g.ctx.applyQuizLayout();
  assert.ok(g.classes.has("grid-mode"));
  assert.equal(g.btn.innerHTML, "LIST");
  assert.equal(g.btn.title, "quiz.layoutList");
  assert.equal(g.attrs["aria-pressed"], "true");

  const l = load(null);
  l.ctx.applyQuizLayout();
  assert.ok(!l.classes.has("grid-mode"));
  assert.equal(l.btn.innerHTML, "GRID");
  assert.equal(l.attrs["aria-pressed"], "false");
});

test("the quiz header has the button, both languages label it, and true/false keeps its row", function() {
  assert.match(html, /id="btn-quiz-layout"/);
  assert.equal((app.match(/"quiz\.layoutGrid":/g) || []).length, 2);
  assert.equal((app.match(/"quiz\.layoutList":/g) || []).length, 2);
  assert.match(css, /\.quiz-options\.grid-mode:not\(\.tf-mode\)\s*\{[^}]*display:\s*grid/);
  assert.match(app, /applyQuizLayout\(\);\n  opts\.forEach/);
});

test("the grid widens the quiz column and puts the answers in one row on a wide screen", function() {
  assert.match(css, /\.quiz-container:has\(> \.quiz-options\.grid-mode:not\(\.tf-mode\)\)\s*\{\s*max-width:\s*1400px/);
  assert.match(css, /\.quiz-options\.grid-mode:not\(\.tf-mode\)\s*\{[^}]*grid-auto-flow:\s*column/);
  // Tiles of different text lengths line up along the top, numbers in one row.
  assert.match(css, /\.quiz-options\.grid-mode:not\(\.tf-mode\) \.quiz-opt\s*\{[^}]*justify-content:\s*flex-start/);
  assert.match(css, /@media \(max-width: 900px\)\s*\{\s*\.quiz-options\.grid-mode:not\(\.tf-mode\)\s*\{\s*grid-auto-flow:\s*row/);
});
