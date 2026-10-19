const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const path = require("node:path");
const { chromium, webkit } = require("playwright");

// Fixes from the 2026-10-19 mobile UX audit, each run in the real client on a phone-sized
// page (no server: the store is stubbed where a test needs it).
const root = path.join(__dirname, "..");
let listener, base, browser, safari;
test.before(async function() {
  await new Promise((ok) => {
    const server = express();
    server.use(express.static(path.join(root, "client")));
    listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); });
  });
  browser = await chromium.launch({ headless: true });
});
test.after(async function() { if (browser) await browser.close(); if (safari) await safari.close(); listener.close(); });

// opts.webkit: Safari's engine, for layout that Chromium lays out differently.
async function withApp(fn, opts) {
  opts = Object.assign({}, opts);
  let engine = browser;
  if (opts.webkit) { delete opts.webkit; engine = safari || (safari = await webkit.launch({ headless: true })); }
  const page = await engine.newPage(Object.assign({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" }, opts));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.showScreen === "function" && typeof window.openModal === "function");
    await fn(page);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

// A finger from the left edge to the middle of the screen.
function edgeSwipe(page) {
  return page.evaluate(function() {
    function touch(x) { return new Touch({ identifier: 1, target: document.body, clientX: x, clientY: 400 }); }
    document.dispatchEvent(new TouchEvent("touchstart", { touches: [touch(5)], changedTouches: [touch(5)], bubbles: true }));
    document.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [touch(200)], bubbles: true }));
  });
}

test("an edge swipe with a dialog open closes the dialog and leaves the screen behind it", async function() {
  await withApp(async function(page) {
    await page.evaluate(function() {
      showScreen("lesson");
      openModal("card-cloze");
    });
    await edgeSwipe(page);
    const r = await page.evaluate(() => ({ screen: getActiveScreen(), open: !document.getElementById("modal-overlay").classList.contains("hidden") }));
    assert.deepEqual(r, { screen: "lesson", open: false });
    // With no dialog the same swipe is Back.
    await edgeSwipe(page);
    assert.equal(await page.evaluate(() => getActiveScreen()), "class");
  });
});

test("an edge swipe over an edited dialog asks before discarding", async function() {
  await withApp(async function(page) {
    await page.evaluate(function() {
      showScreen("lesson");
      openModal("card-cloze");
      document.getElementById("card-cloze-input").value = "typed, not saved";
    });
    await edgeSwipe(page);
    const r = await page.evaluate(() => ({ screen: getActiveScreen(), cloze: !document.getElementById("modal-card-cloze").classList.contains("hidden") }));
    assert.deepEqual(r, { screen: "lesson", cloze: true });
  });
});

test("Home that cannot load its classes says why, offers Try again, and loads once back online", async function() {
  await withApp(async function(page) {
    await page.evaluate(function() {
      window.__fail = true;
      store.getClasses = function() { return window.__fail ? Promise.reject(new Error("offline")) : Promise.resolve([]); };
      showScreen("home");
      renderHome();
    });
    await page.waitForSelector("#home-load-failed:not(.hidden)");
    assert.match(await page.textContent("#home-load-failed"), /Couldn't load your classes\.\s*Try again/);
    await page.evaluate(function() { window.__fail = false; window.dispatchEvent(new Event("online")); });
    await page.waitForSelector("#home-load-failed.hidden", { state: "attached" });
    assert.equal(await page.isVisible("#empty-home"), true);
  });
});

test("a list already on Home stays when a later reload fails", async function() {
  await withApp(async function(page) {
    await page.evaluate(function() {
      store.getClasses = function() { return Promise.resolve([{ id: "c1", name: "Statistics", archived: 0 }]); };
      showScreen("home");
      renderHome();
    });
    await page.waitForFunction(() => document.querySelector("#class-list > *"));
    await page.evaluate(function() {
      store.getClasses = function() { return Promise.reject(new Error("offline")); };
      renderHome();
    });
    await page.waitForTimeout(100);
    assert.equal(await page.isVisible("#home-load-failed"), false);
    assert.match(await page.textContent("#class-list"), /Statistics/);
  });
});

test("Home reloads when the app returns after the UTC day changed or ten minutes away", async function() {
  await withApp(async function(page) {
    const r = await page.evaluate(function() {
      const t = Date.parse("2026-10-19T23:58:00Z");
      return {
        none: homeStaleOnReturn(null, t),
        minute: homeStaleOnReturn(t, t + 60000),
        midnight: homeStaleOnReturn(t, Date.parse("2026-10-20T00:01:00Z")),
        tenMin: homeStaleOnReturn(Date.parse("2026-10-19T10:00:00Z"), Date.parse("2026-10-19T10:10:00Z"))
      };
    });
    assert.deepEqual(r, { none: false, minute: false, midnight: true, tenMin: true });
    const loads = await page.evaluate(async function() {
      let n = 0;
      store.getClasses = function() { n++; return Promise.resolve([]); };
      showScreen("home");
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.__vis });
      window.__vis = "hidden"; document.dispatchEvent(new Event("visibilitychange"));
      homeHiddenAt -= 11 * 60 * 1000;
      window.__vis = "visible"; document.dispatchEvent(new Event("visibilitychange"));
      const afterLong = n;
      window.__vis = "hidden"; document.dispatchEvent(new Event("visibilitychange"));
      window.__vis = "visible"; document.dispatchEvent(new Event("visibilitychange"));
      return [afterLong, n];
    });
    assert.deepEqual(loads, [1, 1], "reloaded after the long absence, not after a quick glance away");
  });
});

const WIDE = "$$\\hat{\\beta} = \\arg\\min_{\\beta} \\sum_{i=1}^{n} \\left(y_i - \\beta_0 - \\sum_{j=1}^{p} x_{ij}\\beta_j\\right)^2 + \\lambda \\sum_{j=1}^{p} \\beta_j^2 + \\alpha \\sum_{j=1}^{p} |\\beta_j|$$";
const URL_TEXT = "See https://example.org/a/very/long/path/that/never/breaks/on/its/own/and/keeps/going/forever.html";
const MCQ = [1, 2, 3].map((i) => ({
  id: "m" + i, lesson_id: "l1", format: "mcq",
  data: { question: "Which objective is ridge plus lasso? " + WIDE, correct: "Elastic net " + WIDE, distractors: ["Ridge " + WIDE, "Lasso"], explanation: URL_TEXT + " " + WIDE }
}));

test("a wide formula or a long URL in a quiz scrolls inside itself; the page never pans sideways", async function() {
  await withApp(async function(page) {
    await page.waitForFunction(() => typeof katex !== "undefined");
    await page.evaluate(function(cards) {
      state.currentLesson = { id: "l1", title: "Regression", format: "mcq" };
      state.quizCards = cards;
      startQuiz();
    }, MCQ);
    const width = () => page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: innerWidth }));
    let w = await width();
    assert.ok(w.page <= w.screen, JSON.stringify(w));
    await page.evaluate(() => answerQuiz(state.quizOptions.indexOf("Lasso")));
    await page.waitForTimeout(100);
    w = await width();
    assert.ok(w.page <= w.screen, "after answering, with the explanation: " + JSON.stringify(w));
  }, { webkit: true });
});

test("a sideways drag on a formula wider than the card scrolls it instead of grading the card", async function() {
  await withApp(async function(page) {
    await page.waitForFunction(() => typeof katex !== "undefined");
    const r = await page.evaluate(async function(wide) {
      state.currentLesson = { id: "l1", title: "Regression", format: "term-def" };
      state.studyCards = [{ id: "t1", lesson_id: "l1", format: "term-def", data: { term: "Elastic net", def: wide } }];
      state.studyIndex = 0;
      startFlashcards();
      document.getElementById("fc-scene").click();
      await new Promise((r) => setTimeout(r, 400));
      let graded = 0;
      document.getElementById("btn-fc-known").addEventListener("click", () => graded++, true);
      const d = document.querySelector(".fc-back .katex-display");
      const scene = document.getElementById("fc-scene");
      function fire(type, x) {
        const t = new Touch({ identifier: 2, target: d, clientX: x, clientY: 300 });
        d.dispatchEvent(new TouchEvent(type, { touches: type === "touchend" ? [] : [t], changedTouches: [t], bubbles: true }));
      }
      fire("touchstart", 100); fire("touchmove", 160); fire("touchmove", 260); fire("touchend", 260);
      await new Promise((r) => setTimeout(r, 400));
      return { wide: d.scrollWidth > d.clientWidth, graded, moved: scene.style.transform };
    }, WIDE);
    assert.deepEqual(r, { wide: true, graded: 0, moved: "" });
  });
});

test("typing Vietnamese: Enter during composition does not answer; curly quotes and dashes match", async function() {
  await withApp(async function(page) {
    const r = await page.evaluate(function() {
      state.currentLesson = { id: "l1", title: "Words", format: "term-def" };
      state.studyCards = [{ id: "t1", lesson_id: "l1", format: "term-def", data: { term: "học", def: "to study" } }];
      state.studyIndex = 0;
      startFlashcards();
      const input = document.getElementById("fc-type-input");
      input.classList.remove("hidden"); input.disabled = false; input.focus();
      let flips = 0;
      document.getElementById("fc-scene").addEventListener("click", () => flips++, true);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }));
      const ime = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      Object.defineProperty(ime, "keyCode", { get: () => 229 });
      input.dispatchEvent(ime);
      const composing = flips;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      return {
        composing, after: flips,
        quotes: normalizeAnswerText("Don’t “stop” — now…") === normalizeAnswerText("don't \"stop\" - now..."),
        attrs: ["fc-type-input", "fc-retype-input", "search-input"].map((id) => {
          const el = document.getElementById(id);
          return [el.getAttribute("autocapitalize"), el.getAttribute("autocorrect"), el.getAttribute("spellcheck"), !!el.getAttribute("enterkeyhint")];
        })
      };
    });
    assert.equal(r.composing, 0, "Enter that confirms an IME syllable is not an answer");
    assert.equal(r.after, 1);
    assert.equal(r.quotes, true);
    assert.deepEqual(r.attrs, [["off", "off", "false", true], ["off", "off", "false", true], ["off", "off", "false", true]]);
  });
});
