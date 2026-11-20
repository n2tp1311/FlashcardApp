"use strict";
// The end screens: one filled button, and on a wide screen one screen with no scrolling.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "client", "style.css"), "utf8");
function extract(name) {
  const start = appJs.indexOf("function " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return appJs.slice(start, appJs.indexOf("\n}\n", start) + 3);
}

function fakeButton(hidden) {
  const cls = new Set(["btn", "btn-primary"].concat(hidden ? ["hidden"] : []));
  return { classList: { contains: (c) => cls.has(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) }, cls };
}

test("only the first shown of Learn new, Retry missed and Back is filled", () => {
  let buttons;
  const ctx = { document: { querySelectorAll: (sel) => { ctx.sel = sel; return buttons; } } };
  vm.createContext(ctx);
  vm.runInContext(extract("setResultsPrimary"), ctx);
  buttons = [fakeButton(true), fakeButton(false), fakeButton(false)];
  ctx.setResultsPrimary("results");
  assert.equal(ctx.sel, "#screen-results [data-primary]");
  assert.deepEqual(buttons.map((b) => b.cls.has("btn-primary")), [false, true, false]);
  assert.ok(buttons[2].cls.has("btn-outline"));
  buttons = [fakeButton(true), fakeButton(true), buttons[2]];
  ctx.setResultsPrimary("summary");
  assert.equal(ctx.sel, "#screen-flashcard-summary [data-primary]");
  assert.ok(buttons[2].cls.has("btn-primary") && !buttons[2].cls.has("btn-outline"));
});

test("both end screens mark their three filled-capable buttons and re-pick after a change", () => {
  for (const p of ["results", "summary"]) {
    for (const b of ["learn-new", "missed", "back"]) assert.match(indexHtml, new RegExp('id="btn-' + p + "-" + b + '" data-primary'));
  }
  assert.match(extract("setMissedButton"), /setResultsPrimary\(prefix\)/);
  assert.match(extract("setLearnNewButton"), /setResultsPrimary\(prefix\)/);
});

test("on a wide screen the end screens are a grid with the buttons in one row", () => {
  const block = css.slice(css.indexOf("/* End screens on a wide screen"));
  assert.match(block, /@media \(min-width: 1024px\)/);
  assert.match(block, /"ring done" "grade done" "detail done" "mem mem" "hint hint" "cap cap" "act act"/);
  assert.match(block, /"done done" "mem nr" "mem bd" "skip skip" "cram cram" "act act"/);
  assert.match(block, /\.results-actions \{ grid-area: act; flex-wrap: nowrap;/);
});

test("on a wide screen Study Setup is one row per section with Start at the right", () => {
  const css = fs.readFileSync(path.join(root, "client", "style.css"), "utf8");
  assert.match(css, /\.setup-container \{ max-width: none; margin: 0 12px; gap: 0; \}/);
  assert.match(css, /\.setup-section \{ display: grid; grid-template-columns: 180px minmax\(0, 1fr\);/);
  assert.match(css, /\.setup-section > :is\(\.setup-label, \.setup-label-row\) \{ grid-column: 1;/);
  assert.match(css, /\.setup-sticky-footer \{ flex-direction: row; justify-content: flex-end;/);
});

test("on a wide screen Cram is one framed band: countdown, readiness and Start on one row", () => {
  assert.match(css, /\.cram-body \{ max-width: none; margin: 16px 12px 0; display: grid; grid-template-columns: auto minmax\(0, 1fr\) 320px;/);
  assert.match(css, /#btn-cram-start \{ grid-column: 3; grid-row: 1; \}/);
  assert.match(css, /\.cram-body > \.cram-actions \{ grid-column: 3; grid-row: 2;/);
});

test("on a wide screen Vocabulary is two words to a row and each achievement group is a row", () => {
  assert.match(css, /\.vocabulary-page-intro, \.vocabulary-list, \.ach-page \{ max-width: none; \}/);
  assert.match(css, /\.vocabulary-list \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(560px, 1fr\)\);/);
  assert.match(css, /\.ach-group \{ grid-template-columns: 180px minmax\(0, 1fr\);/);
});

test("on a wide screen Stats puts the numbers and bars left, the weekly chart right", () => {
  assert.match(css, /#stats-overview\.active \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/);
  assert.match(css, /#stats-overview > \.diff-bar-label:has\(\+ #stats-trend-wrap\) \{ grid-column: 2; grid-row: 1; \}/);
  assert.match(css, /#stats-overview > #stats-trend-wrap \{ grid-column: 2; grid-row: 2 \/ span 6; \}/);
  // The chart's label and box must stay adjacent in the markup, or the :has() rule misses.
  assert.match(appJs, /t\("stats\.accuracyTrend"\) \+ '<\/div><div id="stats-trend-wrap"><\/div>'/);
});

test("on a wide screen a shared class's lessons are a grid of small tiles", () => {
  assert.match(css, /#screen-share \{ padding-left: 28px; padding-right: 28px; \}/);
  assert.match(css, /#share-lesson-list\.lesson-list \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(300px, 1fr\)\); gap: 8px 16px; \}/);
});

