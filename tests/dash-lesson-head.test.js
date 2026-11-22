"use strict";
// The Dashboard's lesson tables on a phone: rows stack into cards whose numbers carry their own
// labels, so the column headings (which are also the sort buttons) are hidden; on a wide screen
// they are the table's header. The phone rule once lost to the row's own display:flex.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const express = require("express");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
let base, listener, browser;
test.before(async () => {
  await new Promise((ok) => {
    const server = express();
    server.use(express.static(path.join(root, "client")));
    listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); });
  });
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { if (browser) await browser.close(); listener.close(); });

for (const [width, shown] of [[390, false], [1200, true]]) {
  test("lesson table headings at " + width + "px: " + (shown ? "shown" : "hidden"), async function() {
    const page = await browser.newPage({ viewport: { width: width, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(base + "/");
      await page.waitForFunction(() => typeof window.dashLessonTableHtml === "function");
      const out = await page.evaluate(() => {
        const rows = [{ id: "a", class_id: "k", title: "A", class_name: "K", cards: 10, mastered: 2, attempts: 5, accuracy: 80, due: 3, hardRatio: null }];
        const box = document.createElement("div");
        box.innerHTML = dashLessonTableHtml(rows, { days: 30 }) + dashLessonTableHtml(rows, { days: 30, sortable: true, sortKey: "due", sortDir: "desc" });
        document.body.appendChild(box);
        return [...box.querySelectorAll(".dash-lhead")].map((h) => getComputedStyle(h).display !== "none" && h.getBoundingClientRect().height > 0);
      });
      assert.deepEqual(out, [shown, shown]);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}

// The same slip anywhere: inside one @media block, `.a { display: none }` followed by
// `.b { display: <not none> }` where some element carries both classes. Equal specificity, so
// the later rule wins and the hidden thing shows.
test("no media block hides a class and then re-displays an element that also carries it", function() {
  const fs = require("fs");
  const css = fs.readFileSync(path.join(root, "client", "style.css"), "utf8");
  const src = fs.readFileSync(path.join(root, "client", "app.js"), "utf8") + fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
  const together = [...src.matchAll(/class="([^"]+)"/g)].map((m) => new Set(m[1].split(/\s+/)));
  const found = [];
  for (const m of css.matchAll(/@media[^{]*\{/g)) {
    let j = m.index + m[0].length, depth = 1;
    while (depth) { const c = css[j++]; if (c === "{") depth++; else if (c === "}") depth--; }
    const rules = [...css.slice(m.index + m[0].length, j - 1).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((r) => [r[1].split(",").map((s) => s.trim()), r[2]]);
    rules.forEach(([sels, decl], i) => {
      if (!/display:\s*none/.test(decl)) return;
      sels.filter((s) => /^\.[\w-]+$/.test(s)).forEach((a) => {
        rules.slice(i + 1).forEach(([sels2, decl2]) => {
          if (!/display:\s*(?!none)/.test(decl2)) return;
          sels2.filter((s) => /^\.[\w-]+$/.test(s) && s !== a).forEach((b) => {
            if (together.some((set) => set.has(a.slice(1)) && set.has(b.slice(1)))) found.push(m[0].trim() + " " + a + " then " + b);
          });
        });
      });
    });
  }
  assert.deepEqual(found, []);
});
