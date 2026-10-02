const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "client", "style.css"), "utf8");

function block(selector) {
  const at = css.indexOf("\n" + selector + " {");
  assert.ok(at >= 0, "missing " + selector);
  return css.slice(at, css.indexOf("\n}", at));
}

function luminance(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

test("dark mode keeps class colours muted at rest and lights up the card under the pointer", function() {
  assert.match(block(":root"), /--class-filter: saturate\(0\.6\);/);
  assert.match(block(":root"), /--class-filter-hot: saturate\(0\.6\);/, "light mode does not change on hover");
  assert.doesNotMatch(block('[data-theme="dark"]'), /--class-filter:/, "dark mode rests at the same damping");
  assert.match(block('[data-theme="dark"]'), /--class-filter-hot: brightness\(1\.4\) saturate\(1\.05\);/);
  assert.match(css, /:is\(\.class-card, \.class-list-row\):is\(:hover, :focus-visible, \.selected\) [^{]+\{ filter: var\(--class-filter-hot\); \}/);
});

test("the class progress fill keeps its width animation alongside the filter fade", function() {
  assert.match(css, /\.progress-mini-fill\[id\^="cls-prog-fill-"\] \{ transition: transform var\(--bar-fill-transition\), filter 0\.25s ease; \}/);
});

test("the dark due badge is full amber with dark text at AA contrast", function() {
  const dark = block('[data-theme="dark"]');
  const bg = dark.match(/--due-bg: (#[0-9a-f]{6});/)[1];
  const fg = dark.match(/--due-text: (#[0-9a-f]{6});/)[1];
  const ratio = (luminance(bg) + 0.05) / (luminance(fg) + 0.05);
  assert.ok(ratio >= 4.5, "contrast " + ratio.toFixed(2));
  assert.match(block(".due-badge"), /background: var\(--due-bg\);/);
});

test("dark accuracy pills use the theme's own semantic colours", function() {
  ["high", "mid", "low"].forEach(function(level) {
    assert.match(css, new RegExp('\\[data-theme="dark"\\] :is\\(\\.class-acc-pill, \\.lesson-acc-pill\\)\\.acc-' + level + " +\\{ background: var\\(--"));
  });
});
