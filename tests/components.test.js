const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const read = function(f) { return fs.readFileSync(path.join(__dirname, "..", "client", f), "utf8"); };
const html = read("index.html"), app = read("app.js"), css = read("style.css");

function rule(selector) {
  const i = css.indexOf(selector + " {");
  assert.ok(i >= 0, "missing CSS rule " + selector);
  return css.slice(i, css.indexOf("}", i));
}

test("the grade row is one Show answer button until the card is flipped", function() {
  const row = html.slice(html.indexOf('id="fc-mark-btns"'), html.indexOf('id="btn-fc-next"'));
  assert.ok(row.indexOf('id="btn-fc-reveal"') >= 0, "Show answer must sit in the grade row");
  assert.match(css, /\.fc-mark-btns\.awaiting-reveal \.btn-mark:not\(\.fc-reveal-btn\) \{ display: none; \}/);
  assert.match(app, /setMarkButtonsEnabled\(false\);\n  setAwaitingReveal\(true\);/, "a new card must start awaiting the reveal");
  assert.match(app, /setMarkButtonsEnabled\(true\);\n    setAwaitingReveal\(false\);/, "the first flip must show the grades");
  assert.equal(app.split('"study.showAnswer"').length - 1, 2, "Show answer needs English and Vietnamese");
});

test("selected options are tonal and the screen's main action is filled", function() {
  assert.ok(!rule(".pill.active").includes("--primary-fill"), "a selected pill must not outrank the main action");
  assert.ok(!rule(".view-toggle-btn.active").includes("--primary-fill"));
  assert.ok(!css.includes(".pill.active, .pill:hover"), "hover must not look selected");
  assert.ok(rule(".btn-primary.btn-full, .modal-footer .btn-primary").includes("background: var(--primary-fill)"));
  assert.match(html, /class="btn btn-primary btn-full" id="btn-start-study"/);
});

test("on a phone the search bar is an icon and search opens at the top", function() {
  assert.match(css, /@media \(max-width: 480px\) \{\n  \.nav-search-bar \{[^}]*width: 44px/);
  assert.match(css, /#modal-search \{ align-items: flex-start;/);
});
