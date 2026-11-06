"use strict";
// Preferences › Style: Classic, Playful and Neo-brutalism. A style brings its own colours in
// both modes, so every text colour is checked here, and the real app is run to check that a
// style turns the palette and high contrast off and that Classic gives them back.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const express = require("express");

const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "client", "style.css"), "utf8");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");

function block(selector) {
  const start = css.indexOf(selector + " {");
  assert.ok(start >= 0, "missing CSS block " + selector);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const t = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) t[m[1]] = m[2].toLowerCase();
  return t;
}
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const BLOCKS = [];
for (const style of ["playful", "brutal"]) {
  BLOCKS.push([style + " light", ':root[data-style="' + style + '"]:not([data-theme="dark"])']);
  BLOCKS.push([style + " dark", ':root[data-style="' + style + '"][data-theme="dark"]']);
}

test("every style's text is readable on its own surfaces, in both modes", function() {
  for (const [name, sel] of BLOCKS) {
    const t = block(sel);
    const soft = t["primary-soft-text"] || t.primary;
    const pairs = [
      ["text", t.text, t.bg], ["text", t.text, t.surface], ["text2", t.text2, t.surface], ["text3", t.text3, t.surface],
      ["text3 on bg", t.text3, t.bg], ["primary", t.primary, t.surface], ["primary on bg", t.primary, t.bg],
      ["soft button", soft, t["primary-light"]], ["white on fill", "#ffffff", t["primary-fill"]],
      ["white on fill hover", "#ffffff", t["primary-fill-hover"]],
      ["card back", t["card-back-text"], t["card-back"]], ["card back dim", t["card-back-dim"], t["card-back"]]
    ];
    for (const [label, fg, bg] of pairs) {
      assert.ok(fg && bg, name + " " + label + " is missing");
      assert.ok(ratio(fg, bg) >= 4.5, name + " " + label + " " + fg + " on " + bg + " is " + ratio(fg, bg).toFixed(2) + ":1");
    }
  }
});

test("each style comes after every palette, so it wins at equal specificity", function() {
  const lastPalette = css.lastIndexOf(":root[data-palette=");
  for (const [, sel] of BLOCKS) assert.ok(css.indexOf(sel + " {") > lastPalette, sel);
});

test("the style's strings exist in English and Vietnamese", function() {
  for (const k of ["pref.style", "pref.styleClassic", "pref.stylePlayful", "pref.styleBrutal", "pref.styleHint"]) {
    assert.equal(app.split('"' + k + '":').length - 1, 2, k);
  }
});

let base, listener;
test.before(() => new Promise((ok) => {
  const server = express();
  server.use(express.static(path.join(root, "client")));
  listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); });
}));
test.after(() => listener.close());

test("a style replaces the palette and high contrast, Classic gives them back, and it survives a reload", async function() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, reducedMotion: "reduce", colorScheme: "dark" });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.showPrefsPage === "function");
    await page.evaluate(() => document.getElementById("btn-open-preferences").click());
    await page.click("#pref-nav-appearance");
    await page.click('#pref-theme [data-value="dark"]');
    await page.click('#pref-palette [data-value="sage"]');
    await page.evaluate(() => { const c = document.getElementById("pref-contrast"); c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); });
    const attrs = () => page.evaluate(() => ["data-style", "data-palette", "data-contrast"].map((a) => document.documentElement.getAttribute(a)));
    assert.deepEqual(await attrs(), [null, "sage", "high"]);
    assert.equal(await page.isVisible("#pref-palette"), true);

    await page.click('#pref-style [data-value="brutal"]');
    assert.deepEqual(await attrs(), ["brutal", null, null]);
    assert.equal(await page.isVisible("#pref-palette"), false);
    assert.equal(await page.isVisible(".pref-style-only"), true);
    const look = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return { bg: s.getPropertyValue("--bg").trim(), radius: s.getPropertyValue("--radius").trim() };
    });
    assert.deepEqual(look, { bg: "#16140f", radius: "4px" });

    await page.click('#pref-style [data-value="playful"]');
    assert.match(await page.evaluate(() => getComputedStyle(document.body).fontFamily), /ui-rounded/);

    await page.click('#pref-style [data-value="classic"]');
    assert.deepEqual(await attrs(), [null, "sage", "high"], "Classic brings the palette and contrast back");
    assert.equal(await page.isVisible(".pref-style-only"), false);

    await page.click('#pref-style [data-value="playful"]');
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem("fc-preferences") || "{}").style === "playful"));
    await page.reload();
    await page.waitForFunction(() => typeof window.showPrefsPage === "function");
    assert.deepEqual(await attrs(), ["playful", null, null]);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
