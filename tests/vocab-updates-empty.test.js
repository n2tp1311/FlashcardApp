"use strict";
// Vocabulary and Updates are titled as the sidebar names them, and an empty page shows the
// sidebar's icon, a title and how things get there, instead of one grey line.
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

for (const lang of ["en", "vi"]) {
  test("titles match the sidebar and empty states explain themselves (" + lang + ")", async function() {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(base + "/");
      await page.waitForFunction(() => typeof window.renderVocabularyQueue === "function");
      const out = await page.evaluate((lang) => {
        applyLanguage(lang);
        const txt = (sel) => document.querySelector(sel).textContent.trim();
        state.vocabularyRequests = [];
        renderVocabularyQueue();
        const emptyIntroHidden = document.getElementById("vocabulary-intro").classList.contains("hidden");
        const vocab = document.getElementById("vocabulary-empty");
        const vocabEmpty = { shown: !vocab.classList.contains("hidden"), icon: !!vocab.querySelector(".empty-icon svg"),
          title: txt("#vocabulary-empty .empty-title"), body: txt("#vocabulary-empty .empty-body") };
        state.vocabularyRequests = [{ id: "a", status: "pending", selected_text: "bank", context_text: "" }];
        renderVocabularyQueue();
        const fullIntroShown = !document.getElementById("vocabulary-intro").classList.contains("hidden");
        state.upstreamData = { count: { total: 0 }, cards: [] };
        showUpstreamData();
        const up = document.getElementById("upstream-empty");
        return {
          vocabTitle: txt("#screen-vocabulary .screen-title"), vocabNav: txt("#sidebar-vocabulary-link"),
          upTitle: txt("#screen-upstream .screen-title"), upNav: txt("#sidebar-upstream-link").replace(/\d+/g, "").trim(),
          emptyIntroHidden, fullIntroShown, vocabEmpty,
          upEmpty: { shown: !up.classList.contains("hidden"), icon: !!up.querySelector(".empty-icon svg"),
            title: txt("#upstream-empty .empty-title"), body: txt("#upstream-empty .empty-body") },
          errHidden: document.getElementById("upstream-error").classList.contains("hidden"),
          titleWeight: getComputedStyle(vocab.querySelector(".empty-title")).fontWeight,
        };
      }, lang);
      assert.equal(out.vocabTitle, out.vocabNav);
      assert.equal(out.upTitle, out.upNav);
      assert.equal(out.vocabTitle, lang === "en" ? "Vocabulary" : "Từ vựng");
      assert.equal(out.upTitle, lang === "en" ? "Updates" : "Cập nhật");
      assert.ok(out.emptyIntroHidden, "the intro is hidden while the list is empty");
      assert.ok(out.fullIntroShown, "the intro comes back with a word in the list");
      for (const e of [out.vocabEmpty, out.upEmpty]) {
        assert.ok(e.shown && e.icon, "shown with an icon");
        assert.ok(e.title.length > 0 && e.body.length > e.title.length, "a title and a how-to line");
      }
      assert.match(out.vocabEmpty.body, lang === "en" ? /Save as English word/ : /Lưu làm từ vựng tiếng Anh/);
      assert.ok(out.errHidden);
      assert.equal(out.titleWeight, "600");
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}

test("a failed load shows its error apart from the empty state, which keeps its text", function() {
  const app = require("fs").readFileSync(path.join(root, "client", "app.js"), "utf8");
  assert.doesNotMatch(app, /upstream-empty"\)[^;]*\.querySelector\("p"\)\.textContent/);
  assert.doesNotMatch(app, /emptyEl\.querySelector\("p"\)\.textContent = err\.message/);
  for (const k of ["vocabulary.emptyHow", "upstream.emptyHow"]) assert.equal(app.split('"' + k + '":').length - 1, 2, k);
});
