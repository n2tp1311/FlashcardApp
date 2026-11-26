"use strict";
// A scrolling flex column (the sidebar's class list, a dialog, a dialog's body) shrinks its
// children before it scrolls. With many classes, two-line names ran into the next row; in a
// short window, dialog footers and pickers were cut. Every dialog and a long class list are
// opened in a short window, and no child of those columns may be shorter than its content.
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

// Each row of those columns, keyed by its place, with its height. A row squeezed in a short
// window is shorter there than in a tall one; content that pokes out of a row it was always
// that size is a different matter, so the two windows are compared, not height to content.
function heights() {
  const out = {};
  document.querySelectorAll(".modal, .modal-body, .sidebar, .sidebar-class-list, .bulk-import-preview").forEach((c, ci) => {
    const cs = getComputedStyle(c);
    if (cs.display !== "flex" || cs.flexDirection !== "column" || c.offsetParent === null) return;
    [...c.children].forEach((k, ki) => {
      if (k.offsetParent === null || getComputedStyle(k).overflowY !== "visible") return;
      out[(c.id || c.className) + " > " + (k.id || k.className || k.tagName) + " #" + ci + "." + ki] = k.getBoundingClientRect().height;
    });
  });
  return out;
}

async function measure(page, height, script, fn) {
  await page.setViewportSize({ width: 1280, height });
  return page.evaluate(script, fn);
}

function shrunk(tall, short) {
  return Object.keys(short).filter((k) => k in tall && tall[k] - short[k] > 0.5)
    .map((k) => k + " " + Math.round(short[k]) + "/" + Math.round(tall[k]));
}

test("the sidebar's class rows keep their height when the list scrolls", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.renderSidebarClasses === "function");
    await page.evaluate(() => {
      document.getElementById("sidebar-classes-label").classList.remove("hidden");
      renderSidebarClasses(["Why We Sleep", "The Art of War", "The Signal and The Noise", "Matrix Cookbook",
        "Quantitative Methods for Business", "A Comprehensive Guide to YAML", "AP Statistics",
        "Elements of Statistical Learning", "Causal Inference: The Mixtape", "Thinking, Fast and Slow",
        "Introduction to Probability", "Deep Learning"].map((name, i) => ({ id: "c" + i, name, due_count: i % 3 ? 0 : 25 })));
    });
    const read = (fn) => new Function("return (" + fn + ")()")();
    const tall = await measure(page, 2400, read, heights.toString());
    const short = await measure(page, 520, read, heights.toString());
    const scrolls = await page.evaluate(() => { const l = document.getElementById("sidebar-class-list"); return l.scrollHeight > l.clientHeight; });
    assert.ok(scrolls, "the list is long enough to scroll");
    assert.ok(Object.keys(short).some((k) => k.startsWith("sidebar-class-list > sidebar-class-item")));
    assert.deepEqual(shrunk(tall, short), []);
  } finally { await page.close(); }
});

test("no dialog squeezes its footer, pickers or hints in a short window", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.openModal === "function");
    const ids = await page.evaluate(() => [...document.querySelectorAll(".modal[id^=modal-]")].map((m) => m.id.replace(/^modal-/, "")));
    assert.ok(ids.length >= 20, "every dialog is opened (" + ids.length + ")");
    const found = [];
    for (const id of ids) {
      const read = ({ id, fn }) => {
        // Some dialogs' close handlers expect state their opener set; this only needs them shut.
        modalStack.length = 0;
        document.querySelectorAll(".modal").forEach((m) => m.classList.add("hidden"));
        openModal(id);
        return new Function("return (" + fn + ")()")();
      };
      const tall = await measure(page, 2400, read, { id, fn: heights.toString() });
      const short = await measure(page, 420, read, { id, fn: heights.toString() });
      shrunk(tall, short).forEach((b) => found.push(id + ": " + b));
    }
    assert.deepEqual(found, []);
  } finally { await page.close(); }
});
