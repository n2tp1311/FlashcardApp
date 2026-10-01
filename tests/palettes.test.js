const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "client", "style.css"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "client", "index.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "..", "client", "app.js"), "utf8");

function block(selector) {
  const start = css.indexOf(selector + " {");
  assert.ok(start >= 0, "missing CSS block " + selector);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const tokens = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[m[1]] = m[2].toLowerCase();
  for (const m of body.matchAll(/--soft-mix:\s*(\d+)%/g)) tokens["soft-mix"] = Number(m[1]);
  return tokens;
}

function lum(hex) {
  const c = [1, 3, 5].map(function(i) { return parseInt(hex.slice(i, i + 2), 16) / 255; })
    .map(function(x) { return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function mixHex(a, b, pct) {
  const A = [1, 3, 5].map(function(i) { return parseInt(a.slice(i, i + 2), 16); });
  const B = [1, 3, 5].map(function(i) { return parseInt(b.slice(i, i + 2), 16); });
  return "#" + A.map(function(x, i) {
    return Math.round(x * pct / 100 + B[i] * (1 - pct / 100)).toString(16).padStart(2, "0");
  }).join("");
}

// The soft tints are color-mix() of a hue into the palette's --surface (see style.css);
// resolve them here the way the browser does so their text can be checked.
function resolveSoft(t) {
  for (const k of ["success", "danger", "warning", "confident"]) {
    const pct = t["soft-mix"] + (k === "confident" ? 5 : 0);
    t[k + "-soft"] = mixHex(t[k + "-hue"], t.surface, pct);
  }
  return t;
}

function ratio(a, b) {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const PALETTES = JSON.parse(app.match(/var PALETTES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
const baseLight = block(":root");
const baseDark = Object.assign({}, baseLight, block('[data-theme="dark"]'));

function tokensFor(palette, mode) {
  const base = mode === "dark" ? baseDark : baseLight;
  if (palette === "parchment") return resolveSoft(Object.assign({}, base, { "primary-soft": base["primary-light"] }));
  const sel = ':root[data-palette="' + palette + '"]' + (mode === "dark" ? '[data-theme="dark"]' : ':not([data-theme="dark"])');
  const t = Object.assign({}, base, block(sel));
  t["primary-soft"] = t["primary-light"];
  return resolveSoft(t);
}

// Text colours that sit on page surfaces, and the soft-button pairs. Every one must stay
// readable (WCAG AA 4.5:1) in every palette, in both modes.
const PAIRS = [
  ["text", "surface"], ["text", "bg"], ["text", "surface2"],
  ["text2", "surface"], ["text2", "bg"], ["text2", "surface2"],
  ["primary", "surface"], ["primary", "bg"], ["primary", "primary-light"],
  ["success", "surface"], ["danger", "surface"], ["warning", "surface"],
  ["card-back-text", "card-back"], ["card-back-dim", "card-back"],
  ["success-soft-text", "success-soft"], ["danger-soft-text", "danger-soft"],
  ["warning-soft-text", "warning-soft"], ["confident-soft-text", "confident-soft"],
];

for (const palette of PALETTES) {
  for (const mode of ["light", "dark"]) {
    test(palette + " " + mode + " keeps every text colour readable", function() {
      const t = tokensFor(palette, mode);
      for (const [fg, bg] of PAIRS) {
        assert.ok(t[fg] && t[bg], palette + " " + mode + " lacks --" + fg + " or --" + bg);
        const r = ratio(t[fg], t[bg]);
        assert.ok(r >= 4.5, palette + " " + mode + ": --" + fg + " on --" + bg + " is " + r.toFixed(2) + ":1");
      }
      // Badges and selected pills still put white text on --primary-fill.
      assert.ok(ratio("#ffffff", t["primary-fill"]) >= 4.5, palette + " " + mode + ": white on --primary-fill");
    });
  }
}

test("Preferences offers exactly the palettes app.js knows", function() {
  const offered = [...html.matchAll(/class="pill palette-pill" data-value="([\w-]+)"/g)].map(function(m) { return m[1]; });
  assert.deepEqual(offered, PALETTES);
  for (const palette of PALETTES) {
    assert.ok(app.includes('"pref.palette.' + palette + '"'), "missing label for " + palette);
  }
});
