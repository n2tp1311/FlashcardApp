"use strict";
// The grade undo bar sits at the bottom, in thumb reach, but above the sticky grading row
// so it never covers the buttons a misclick came from.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "client", "style.css"), "utf8");

function rule(selector) {
  const start = css.indexOf("\n" + selector + " {");
  assert.ok(start >= 0, "missing " + selector);
  return css.slice(start, css.indexOf("\n}", start));
}

test("undo bar is anchored to the bottom, above the grading row", () => {
  const r = rule(".grade-undo");
  assert.match(r, /bottom:[^;]*var\(--grade-row-h/);
  assert.doesNotMatch(r, /\btop:/);
});

test("watchGradeRow publishes the sticky row's height, 0 when not stuck", () => {
  const start = app.indexOf("\nfunction watchGradeRow(");
  const src = app.slice(start, app.indexOf("\n}\n", start) + 3);
  let cb, set = {};
  const row = { offsetHeight: 96 };
  let position = "sticky";
  const ctx = {
    document: { querySelector: () => row, documentElement: { style: { setProperty: (k, v) => { set[k] = v; } } } },
    getComputedStyle: () => ({ position }),
    ResizeObserver: function (f) { cb = f; this.observe = () => {}; },
  };
  vm.createContext(ctx);
  vm.runInContext(src + "watchGradeRow();", ctx);
  cb();
  assert.equal(set["--grade-row-h"], "96px");
  position = "static"; cb();
  assert.equal(set["--grade-row-h"], "0px");
  position = "sticky"; row.offsetHeight = 0; cb();
  assert.equal(set["--grade-row-h"], "0px");
  assert.match(app, /\nwatchGradeRow\(\);\n/);
});
