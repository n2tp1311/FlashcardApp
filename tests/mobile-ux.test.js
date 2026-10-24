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

test("on a phone the grades are the bottom row and Prev/Next sit above them", async function() {
  for (const opts of [{}, { webkit: true }]) {
    await withApp(async function(page) {
      const r = await page.evaluate(async function() {
        state.currentLesson = { id: "l1", title: "Words", format: "term-def" };
        state.studyCards = [1, 2, 3].map((i) => ({ id: "t" + i, lesson_id: "l1", format: "term-def", data: { term: "term " + i, def: "def " + i } }));
        state.studyIndex = 0;
        startFlashcards();
        document.getElementById("fc-scene").click();
        await new Promise((r) => setTimeout(r, 300));
        const box = (id) => document.getElementById(id).getBoundingClientRect();
        return { next: box("btn-fc-next").bottom, prev: box("btn-fc-prev").bottom, grade: box("btn-fc-easy").top, gradeBottom: box("btn-fc-easy").bottom, screen: innerHeight };
      });
      assert.ok(r.grade >= r.next && r.grade >= r.prev, JSON.stringify(r));
      assert.ok(r.gradeBottom <= r.screen, "the grades stay on screen: " + JSON.stringify(r));
      await page.screenshot({ path: path.join(root, "test-results", "fc-nav-phone" + (opts.webkit ? "-webkit" : "") + ".png") });
    }, opts);
  }
});

const LONG = " — a longer option that wraps onto two or three lines on a small phone screen";
const QUIZ4 = [1, 2, 3, 4].map((i) => ({
  id: "q" + i, lesson_id: "l1", format: "mcq",
  data: { question: "Question " + i + ": which statement about regularization is right?", correct: "Right answer " + i + LONG, distractors: ["Wrong A" + LONG, "Wrong B" + LONG, "Wrong C" + LONG] }
}));

test("after a wrong answer the right option is scrolled above the answer sheet, waits for Next; the next question starts at the top", async function() {
  await withApp(async function(page) {
    const r = await page.evaluate(async function(cards) {
      state.currentLesson = { id: "l1", title: "Quiz", format: "mcq" };
      state.quizCards = cards;
      startQuiz();
      const card = state.quizCards[0];
      // Make the right answer the last option, the one the sheet covers.
      const opts = state.quizOptions;
      const wrong = opts.findIndex((o) => o !== card.data.correct);
      const rightAt = opts.indexOf(card.data.correct);
      if (rightAt !== opts.length - 1) { opts.splice(rightAt, 1); opts.push(card.data.correct); }
      const els = document.querySelectorAll("#quiz-options .quiz-opt .opt-text");
      opts.forEach((o, i) => { if (els[i]) els[i].textContent = o; });
      answerQuiz(opts.findIndex((o) => o !== card.data.correct));
      await new Promise((r) => setTimeout(r, 400));
      const right = document.querySelector("#quiz-options .quiz-opt.correct").getBoundingClientRect();
      const sheet = document.getElementById("quiz-sheet").getBoundingClientRect();
      const out = { rightBottom: right.bottom, sheetTop: sheet.top, scrolled: scrollY, nextShown: !!document.getElementById("quiz-next-btn") };
      await new Promise((r) => setTimeout(r, QUIZ_ADVANCE_MS + 300));
      out.index = state.quizIndex;
      document.getElementById("quiz-next-btn").click();
      await new Promise((r) => setTimeout(r, 50));
      out.afterNext = scrollY;
      return out;
    }, QUIZ4);
    assert.ok(r.rightBottom <= r.sheetTop, JSON.stringify(r));
    assert.equal(r.nextShown, true, "a wrong answer waits for Next");
    assert.equal(r.index, 0);
    assert.equal(r.afterNext, 0);
  }, { viewport: { width: 375, height: 667 } });
});

test("a right answer moves on by itself even with a passage; opening the passage stops it and shows Next", async function() {
  await withApp(async function(page) {
    const r = await page.evaluate(async function(cards) {
      cards = cards.map((c) => Object.assign({}, c, { source: "The passage from the book that the card was written from." }));
      state.currentLesson = { id: "l1", title: "Quiz", format: "mcq" };
      state.quizCards = cards;
      startQuiz();
      answerQuiz(state.quizOptions.indexOf(state.quizCards[0].data.correct));
      const shownAt = !!document.getElementById("quiz-next-btn");
      await new Promise((r) => setTimeout(r, QUIZ_ADVANCE_MS + 200));
      const moved = state.quizIndex;
      answerQuiz(state.quizOptions.indexOf(state.quizCards[1].data.correct));
      document.querySelector("#quiz-source summary").click();
      await new Promise((r) => setTimeout(r, QUIZ_ADVANCE_MS + 200));
      return { shownAt, moved, index: state.quizIndex, next: !!document.getElementById("quiz-next-btn") };
    }, QUIZ4);
    assert.deepEqual(r, { shownAt: false, moved: 1, index: 1, next: true });
  });
});

test("the Home heading stays on one line in Vietnamese on a small phone", async function() {
  for (const width of [375, 390]) {
    await withApp(async function(page) {
      const r = await page.evaluate(function() {
        applyLanguage("vi");
        showScreen("home");
        const h = document.querySelector("#screen-home .home-section-title").getBoundingClientRect();
        const select = document.getElementById("class-sort-select").getBoundingClientRect();
        return { h: h.height, text: document.querySelector("#screen-home .home-section-title").textContent, page: document.documentElement.scrollWidth, select: select.right };
      });
      assert.equal(r.text, "Lớp của bạn");
      assert.ok(r.h < 32, JSON.stringify(r));
      assert.ok(r.page <= width && r.select <= width, JSON.stringify(r));
    }, { webkit: true, viewport: { width, height: 800 } });
  }
});

test("Vietnamese: no English left in the markup that was missed, and errors stay in Vietnamese", async function() {
  await withApp(async function(page) {
    const r = await page.evaluate(function() {
      applyLanguage("vi");
      return {
        nav: document.getElementById("sidebar").getAttribute("aria-label"),
        alt: document.getElementById("card-image-preview").alt,
        interleaved: document.getElementById("pill-order-interleaved").textContent.trim(),
        suggest: document.getElementById("btn-suggest-tags").textContent,
        codeless: serverError({ error: "Not found" }, "FALLBACK"),
        coded: serverError({ error: "testAt must be a time within the next year", code: "cramTestAt" }, "FALLBACK"),
        terms: [t("class.suggestTags"), t("studyNow.flashcard"), t("studyNow.quiz"), t("done.known"), t("leech.tag"), t("count.due", { n: 3 })]
      };
    });
    assert.deepEqual(r, {
      nav: "Điều hướng chính", alt: "Xem trước", interleaved: "Xen kẽ ✦", suggest: "Gợi ý nhãn",
      codeless: "FALLBACK", coded: "Chọn thời gian thi trong vòng một năm tới.",
      terms: ["Gợi ý nhãn", "Thẻ ghi nhớ", "Trắc nghiệm", "Đã thuộc", "Thẻ khó nhớ", "3 thẻ đến hạn"]
    });
    // English keeps the server's own words, which say more than the fallback.
    assert.equal(await page.evaluate(() => { applyLanguage("en"); return serverError({ error: "Not found" }, "FALLBACK"); }), "Not found");
  });
});

test("Back from a lesson returns to the same place in a long class, even when the list loads late", async function() {
  await withApp(async function(page) {
    const r = await page.evaluate(async function() {
      const fill = () => {
        const list = document.getElementById("lesson-list");
        list.innerHTML = "";
        for (let i = 0; i < 300; i++) { const d = document.createElement("div"); d.style.height = "120px"; d.textContent = "Lesson " + i; list.appendChild(d); }
      };
      window.renderLessons = function() { document.getElementById("lesson-list").innerHTML = ""; setTimeout(fill, 200); };
      state.currentClass = { id: "c1", name: "Big class" };
      showScreen("class");
      fill();
      window.scrollTo(0, 24000);
      const before = scrollY;
      state.currentLesson = { id: "l240", title: "Lesson 240" };
      showScreen("lesson");
      const inLesson = scrollY;
      document.getElementById("btn-lesson-back").click();
      await new Promise((r) => setTimeout(r, 600));
      return { before, inLesson, after: scrollY };
    });
    assert.equal(r.inLesson, 0, "a new screen still opens at the top");
    assert.equal(r.after, r.before);
  });
});

test("a new account is invited to make a class, not told it is done; filters that hide everything say so", async function() {
  await withApp(async function(page) {
    const r = await page.evaluate(function() {
      const plan = { reviews: 0, newCards: 0, dueLeft: 0, extra: 0, uncapped: true };
      const box = document.createElement("div");
      box.innerHTML = studyNowHtml(plan, { medianMs: {} }, true);
      const fresh = box.textContent;
      box.innerHTML = studyNowHtml(plan, { medianMs: {} }, false);
      const done = box.textContent;
      // Through the Home hero too, which is where the card total comes from.
      state.studyNowDue = 0;
      const today = { count: 0, activity: { studyMs: 0, newCards: 0, reviews: 0 }, medianMs: {} };
      box.innerHTML = streakTimeHeroCard(null, null, { cards: 0 }, null, today);
      const hero = box.textContent;
      let opened = 0;
      document.getElementById("btn-new-class").addEventListener("click", () => opened++);
      showScreen("home");
      state.showArchived = false;
      state.homeClasses = [];
      _renderClassItems([]);
      const none = { text: document.querySelector("#empty-home p").textContent, button: !document.getElementById("btn-empty-new-class").classList.contains("hidden") };
      document.getElementById("btn-empty-new-class").click();
      state.homeClasses = [{ id: "c1", name: "Stats", archived: 0 }];
      _renderClassItems([]);
      const filtered = { text: document.querySelector("#empty-home p").textContent, button: !document.getElementById("btn-empty-new-class").classList.contains("hidden") };
      return { fresh, done, hero, none, filtered, opened, lessonButton: !!document.querySelector("#empty-class [data-new-lesson]") };
    });
    assert.match(r.fresh, /No cards yet/);
    assert.match(r.fresh, /New Class/);
    assert.match(r.done, /All done for today/);
    assert.match(r.hero, /No cards yet/);
    assert.deepEqual(r.none, { text: "No classes yet. Create your first class to get started.", button: true });
    assert.deepEqual(r.filtered, { text: "No classes match these filters.", button: false });
    assert.equal(r.opened, 1);
    assert.equal(r.lessonButton, true);
  });
});

test("Preferences: an invalid Max reviews does not stop other changes saving; the goal choices fit", async function() {
  await withApp(async function(page) {
    const r = await page.evaluate(async function() {
      applyLanguage("vi");
      document.getElementById("btn-open-preferences").click();
      showPrefsPage("plan");
      await new Promise((r) => setTimeout(r, 100));
      const pills = [...document.querySelectorAll("#pref-daily-goal .pill")];
      const dialog = document.getElementById("modal-preferences").getBoundingClientRect();
      const fits = pills.every((p) => { const b = p.getBoundingClientRect(); return b.width > 0 && b.right <= dialog.right + 0.5; });
      document.getElementById("pref-max-reviews").value = "1.5";
      document.querySelector('#pref-daily-goal .pill[data-value="30"]').click();
      savePrefsNow();
      return { fits, goal: state.dailyGoal, error: !!document.getElementById("pref-max-reviews-error"), max: state.maxReviewsPerDay };
    });
    assert.deepEqual(r, { fits: true, goal: 30, error: true, max: null });
  }, { viewport: { width: 375, height: 667 } });
});

test("a screen reader hears only the face that shows: the answer waits for the flip", async function() {
  await withApp(async function(page) {
    await page.evaluate(function() {
      state.currentLesson = { id: "l1", title: "Stats", format: "term-def" };
      state.typeToCompare = false;
      state.studyCards = [{ id: "c1", lesson_id: "l1", format: "term-def", data: { term: "median", def: "the middle value" } }];
      state.studyIndex = 0;
      startFlashcards();
    });
    const read = () => page.locator("#fc-card").ariaSnapshot();
    const before = await read();
    assert.match(before, /median/);
    assert.doesNotMatch(before, /middle value/);
    await page.click("#fc-scene");
    const after = await read();
    assert.match(after, /middle value/);
    assert.doesNotMatch(after, /median/);
  });
});

// Cheers arrive after the answers are written, a second or so late, and once pushed Back to
// Lesson from 560px to 1034px: below a phone's screen, and moving under a finger on its way.
test("late cheers leave the session-end buttons on screen, at the same place", async function() {
  await withApp(async function(page) {
    for (const [screen, box, button] of [["results", "results-done", "btn-results-back"],
                                         ["flashcard-summary", "summary-done", "btn-summary-back"]]) {
      const r = await page.evaluate(function(a) {
        showScreen(a.screen);
        window.scrollTo(0, 0);
        renderSessionDone(a.box, 0.9, [{ tone: "good", label: "Cards", value: 20 }, { tone: "good", label: "Right", value: 18 }]);
        const btn = document.getElementById(a.button);
        const before = btn.getBoundingClientRect().bottom;
        document.querySelector("#" + a.box + " .session-cheers").innerHTML =
          '<div class="session-cheer" style="height:120px">streak</div>'.repeat(5);
        return { before, after: btn.getBoundingClientRect().bottom, inner: innerHeight };
      }, { screen, box, button });
      assert.ok(r.after <= r.inner, screen + ": the button is on screen (" + r.after + " > " + r.inner + ")");
      assert.ok(Math.abs(r.after - r.before) < 1, screen + ": it did not move");
    }
  }, { viewport: { width: 375, height: 667 } });
});

// "Marked reviewed: <a long card name>" was one nowrap line, and pushed Undo past the right
// edge of a 390px screen.
test("a long undo message is cut short, and Undo stays on screen", async function() {
  await withApp(async function(page) {
    const r = await page.evaluate(function() {
      showUndoBar("Marked reviewed: " + "relative frequency histogram of a quantitative variable ".repeat(3));
      const btn = document.getElementById("btn-grade-undo").getBoundingClientRect();
      const pill = document.getElementById("grade-undo").getBoundingClientRect();
      return { btnRight: btn.right, btnWidth: btn.width, pillRight: pill.right, width: innerWidth };
    });
    assert.ok(r.btnRight <= r.width - 16, "Undo ends inside the screen: " + r.btnRight);
    assert.ok(r.btnWidth >= 44, "Undo keeps its size: " + r.btnWidth);
    assert.ok(r.pillRight <= r.width - 16);
  });
});

// Home asked twice per class (its lessons, to count them, and its progress) and the class
// screen twice per lesson (every card, to count them, and its progress).
test("Home and the class screen draw every count and bar from a single progress request", async function() {
  await withApp(async function(page) {
    const r = await page.evaluate(async function() {
      const calls = { lessons: 0, cards: 0, one: 0, classes: 0, lessonBatch: 0 };
      const prog = { total: 4, known: 1 };
      store.getLessons = function() { calls.lessons++; return Promise.resolve([]); };
      store.getCards = function() { calls.cards++; return Promise.resolve([]); };
      store.getProgress = function() { calls.one++; return Promise.resolve(prog); };
      store.getClassesProgress = function(ids) { calls.classes++; const m = {}; ids.forEach(id => { m[id] = prog; }); return Promise.resolve(m); };
      store.getLessonsProgress = function(ids) { calls.lessonBatch++; const m = {}; ids.forEach(id => { m[id] = prog; }); return Promise.resolve(m); };
      store.getClasses = function() {
        return Promise.resolve([1, 2, 3, 4, 5, 6].map(i => ({ id: "k" + i, name: "Class " + i, archived: 0, lesson_count: i })));
      };
      const tick = () => new Promise(ok => setTimeout(ok, 50));
      showScreen("home");
      renderHome();
      await tick();
      const meta = document.getElementById("cls-meta-k3").textContent;
      const bar = document.getElementById("cls-prog-wrap-k3").style.display;
      _renderHomeClassList();
      await tick();
      const afterResort = calls.classes;

      store.getDueLessons = function() { return Promise.resolve({ due: [], dueCounts: {}, schedule: {} }); };
      state.lessonFilter = "all";
      _renderLessonItems([1, 2, 3].map(i => ({ id: "l" + i, class_id: "k1", title: "Lesson " + i, format: "term-def", card_count: i * 10 })), {});
      await tick();
      return { calls, meta, bar, afterResort, lessonMeta: document.getElementById("les-meta-l2").textContent,
               lessonBar: document.getElementById("les-prog-wrap-l2").style.display };
    });
    assert.deepEqual(r.calls, { lessons: 0, cards: 0, one: 0, classes: 1, lessonBatch: 1 });
    assert.match(r.meta, /3/);
    assert.equal(r.bar, "");
    assert.equal(r.afterResort, 1, "a re-sort reuses the progress Home loaded");
    assert.match(r.lessonMeta, /20/);
    assert.equal(r.lessonBar, "");
  });
});

// Exact values lived only in hover titles, which a phone never shows.
test("tapping a chart column, a line point, a grade segment or a heatmap day shows its value under the chart", async function() {
  await withApp(async function(page) {
    await page.evaluate(function() {
      const box = document.createElement("div");
      box.id = "charts-test";
      box.innerHTML = '<div id="w-col"></div><div id="w-line"></div><div id="w-stack"></div>';
      document.body.prepend(box);
      document.getElementById("w-col").innerHTML = chartColumnsSvg({ width: 340, values: [3, 0, 12], labels: ["Mon", "Tue", "Wed"], cls: "answers" });
      document.getElementById("w-line").innerHTML = chartLineSvg({ width: 340, values: [50, null, 80], labels: ["W1", "W2", "W3"],
        titles: ["W1: 50%", "W2", "W3: 80%"], min: 0, max: 100, ticks: [0, 50, 100], fmt: String, cls: "accuracy" });
      document.getElementById("w-stack").innerHTML = '<div class="chart-stack">' + '<div class="chart-stack-seg" style="flex:1" data-tip="Good: 7"></div></div>' +
        '<div class="heatmap" style="grid-template-columns:22px">' + heatmapCellHtml("heat-2", "Oct 3: 12 min, 40 cards") + '</div>';
    });
    const tapAt = async (sel, i) => { await page.locator(sel).nth(i).tap(); };
    const readout = (wrap) => page.evaluate((w) => [...document.querySelectorAll("#" + w + " .chart-readout")].map(e => e.textContent), wrap);
    // The empty column still answers: a 2px-wide bar, or no bar, was nothing to tap.
    await tapAt("#w-col .chart-hit", 1);
    assert.deepEqual(await readout("w-col"), ["Tue: 0"]);
    await tapAt("#w-col .chart-hit", 2);
    assert.deepEqual(await readout("w-col"), ["Wed: 12"]);
    assert.equal(await page.locator("#w-col .chart-hit.is-picked").count(), 1);
    await tapAt("#w-line .chart-hit", 1);
    assert.deepEqual(await readout("w-line"), ["W3: 80%"]);
    await tapAt("#w-stack .chart-stack-seg", 0);
    await tapAt("#w-stack .heatmap-cell", 0);
    assert.deepEqual(await readout("w-stack"), ["Good: 7", "Oct 3: 12 min, 40 cards"]);
  });
});

// Only the 78x20 name applied a preset, with its 22px delete 4px away.
test("a whole preset chip applies the preset, stays marked until a pill changes it, and holds no delete", async function() {
  await withApp(async function(page) {
    await page.evaluate(function() {
      showScreen("setup");
      state.studyScope = { lessons: [{ id: "l1" }] };
      state.setupDataPromise = new Promise(function() {});
      state.studyPresets = [{ id: "p1", name: "Due 25", count: "25", filter: "due", mode: "flashcard", order: "shuffle" },
                            { id: "p2", name: "All", count: "all", filter: "all", mode: "quiz", order: "in-order" }];
      renderSetupPresets();
    });
    assert.equal(await page.locator("#setup-presets-list .setup-preset-chip-remove").count(), 0);
    const chip = page.locator('#setup-presets-list .setup-preset-chip[data-preset-id="p1"]');
    const box = await chip.boundingBox();
    assert.ok(box.height >= 40, "chip height " + box.height);
    // The left edge, on the number badge, not the name.
    await page.touchscreen.tap(box.x + 6, box.y + box.height / 2);
    const after = await page.evaluate(() => ({
      count: setupPillValue("setup-count"), filter: setupPillValue("setup-filter"),
      pressed: [...document.querySelectorAll("#setup-presets-list .setup-preset-chip")].map(c => c.getAttribute("aria-pressed"))
    }));
    assert.deepEqual(after, { count: "25", filter: "due", pressed: ["true", "false"] });
    await page.locator('#setup-count .pill[data-value="50"]').tap();
    await page.waitForTimeout(20);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#setup-presets-list .setup-preset-chip.active")].length), 0);
  });
});

// A phone set to English showed "1,234" and "Oct 19" inside Vietnamese sentences.
test("numbers and dates follow the app's language, not the phone's", async function() {
  await withApp(async function(page) {
    const r = await page.evaluate(function() {
      applyLanguage("vi");
      const box = document.createElement("div");
      document.body.appendChild(box);
      renderGradeDistribution([{ grade: "easy", cnt: 1234 }], box);
      const vi = { locale: appLocale(), legend: box.querySelector(".chart-legend").textContent, week: chartWeekLabel(5),
                   day: t("chart.dayMonth", { month: "Th10", day: 19 }) };
      applyLanguage("en");
      renderGradeDistribution([{ grade: "easy", cnt: 1234 }], box);
      return { vi, en: { locale: appLocale(), legend: box.querySelector(".chart-legend").textContent, day: t("chart.dayMonth", { month: "Oct", day: 19 }) } };
    });
    assert.equal(r.vi.locale, "vi-VN");
    assert.match(r.vi.legend, /1\.234/);
    assert.equal(r.vi.week, "5 tuần");
    assert.equal(r.vi.day, "19 Th10");
    assert.equal(r.en.locale, "en-US");
    assert.match(r.en.legend, /1,234/);
    assert.equal(r.en.day, "Oct 19");
  }, { locale: "en-US" });
});

// The user quizzes to review and uses flashcards to learn: Study now runs the due cards in the
// chosen mode, and the new ones wait on the summary as a flashcard session.
test("Study now reviews first in the chosen mode, then offers the new cards as flashcards", async function() {
  await withApp(async function(page) {
    const r = await page.evaluate(async function(cards) {
      const due = cards.slice(0, 2).map((c) => Object.assign({}, c, { srs_due_at: 1, last_studied_at: 1 }));
      const fresh = cards.slice(2).map((c) => Object.assign({}, c, { format: "term", data: { term: "T " + c.id, def: "D " + c.id } }));
      store.getStudyNowCards = () => Promise.resolve({ cards: due.concat(fresh), lessons: [{ id: "l1", title: "L", class_id: "c1" }] });
      store.getDifficultyMap = () => Promise.resolve({});
      state.studyNowMode = "quiz";
      showScreen("home");
      const btn = document.createElement("button");
      btn.dataset.studyNow = "all,2";
      document.body.appendChild(btn);
      startStudyNow(btn);
      await new Promise((r) => setTimeout(r, 100));
      const out = { first: getActiveScreen(), quizCount: state.quizCards.length };
      const bar = (p) => ({ text: document.getElementById(p + "-progress-text").textContent.split(" · ")[0], fill: document.getElementById(p + "-progress-fill").style.transform,
        marks: [...document.querySelectorAll("#" + p + "-progress-fill ~ .pb-mark")].map((m) => m.className.replace("pb-mark is-", "") + "@" + m.style.left),
        labels: document.getElementById(p + "-progress-labels").textContent, done: !!document.querySelector("#" + p + "-progress-fill ~ .pb-done") });
      out.reviewBar = bar("quiz");
      for (let i = 0; i < 2; i++) {
        answerQuiz(state.quizOptions.findIndex((o) => o !== state.quizCards[state.quizIndex].data.correct));
        document.getElementById("quiz-next-btn").click();
      }
      const learn = document.getElementById("btn-results-learn-new");
      out.results = getActiveScreen();
      out.learn = learn.classList.contains("hidden") ? null : learn.textContent;
      learn.click();
      out.then = getActiveScreen();
      out.newBar = bar("fc");
      out.studyIds = state.studyCards.map((c) => c.id);
      out.mode = state.studyMode;
      return out;
    }, QUIZ4);
    // One bar for the whole run: two reviews then two new cards, a notch between them.
    // Halves of two cards are too short for a middle tick: only the notch.
    assert.deepEqual(r.reviewBar, { text: "Review 1 / 2", fill: "scaleX(0.25)", marks: ["notch@50%"], labels: "Review 2New 2", done: false });
    assert.deepEqual(r.newBar, { text: "New 1 / 2", fill: "scaleX(0.75)", marks: ["notch@50%"], labels: "Reviewed ✓New 1/2", done: true });
    delete r.reviewBar; delete r.newBar;
    assert.deepEqual(r, { first: "quiz", quizCount: 2, results: "results", learn: "Learn 2 new cards",
      then: "flashcard", studyIds: ["q3", "q4"], mode: "flashcard" });
  });
});

test("Study now's chip names the top class with new cards and opens the order sheet; Study now takes every class", async function() {
  await withApp(async function(page) {
    const r = await page.evaluate(async function() {
      const today = { count: 0, activity: { studyMs: 0, newCards: 0, reviews: 0 }, medianMs: {} };
      const est = { estimatedNewCards: 10, availableNewCards: 30, byClass: [
        { id: "k0", name: "Finished Book", available: 0 }, { id: "k1", name: "Deep Learning", available: 25 }, { id: "k2", name: "Statistics", available: 5 }] };
      state.studyNowDue = 12;
      state.studyNowDueLessons = [{ id: "l1", class_id: "k1", dueCount: 9 }, { id: "l2", class_id: "k2", dueCount: 3 }];
      state._dashHeroData = { streak: null, studyTime: null, summary: { cards: 40 }, newCardEstimate: est, today: today };
      showScreen("home");
      const grid = document.getElementById("home-summary-grid");
      grid.innerHTML = streakTimeHeroCard(null, null, { cards: 40 }, est, today);
      for (let el = grid; el; el = el.parentElement) el.classList.remove("hidden");
      const out = { chip: grid.querySelector("[data-study-now-classes]").textContent, go: grid.querySelector(".study-now b").textContent };
      grid.querySelector("[data-study-now-classes]").click();
      const sheet = document.getElementById("modal-study-order");
      out.open = !sheet.classList.contains("hidden");
      out.checkboxes = sheet.querySelectorAll("input").length;
      out.tap = sheet.querySelector(".study-now-pick").getBoundingClientRect().height;
      let sent = null;
      store.getStudyNowCards = function() { sent = [].slice.call(arguments); return Promise.resolve({ cards: [], lessons: [] }); };
      sheet.querySelector('[data-modal="study-order"]').click();
      out.closed = sheet.classList.contains("hidden");
      startStudyNow(grid.querySelector(".study-now"));
      await new Promise((r) => setTimeout(r, 20));
      out.sent = sent;
      est.byClass.forEach((c) => { c.available = 0; });
      grid.innerHTML = streakTimeHeroCard(null, null, { cards: 40 }, est, today);
      out.allDoneChip = grid.querySelector("[data-study-now-classes]").textContent;
      return out;
    });
    assert.equal(r.chip, "New cards from Deep Learning▾", "a Completed class at the top is passed over");
    assert.equal(r.go, "Study now · 22 cards", "reviews from every class, not a picked few");
    assert.equal(r.open, true);
    assert.equal(r.checkboxes, 0, "the sheet orders classes; it does not pick them");
    assert.ok(r.tap >= 44, "rows are a thumb's height: " + r.tap);
    assert.equal(r.closed, true);
    assert.deepEqual(r.sent, [null, 10], "every due card, and the day's new-card goal");
    assert.equal(r.allDoneChip, "Study order▾");
  });
});

test("a long class name on Study now's chip is cut short, not widening the page", async function() {
  await withApp(async function(page) {
    const r = await page.evaluate(function() {
      const today = { count: 0, activity: { studyMs: 0, newCards: 0, reviews: 0 }, medianMs: {} };
      const est = { estimatedNewCards: 10, availableNewCards: 30, byClass: [
        { id: "k1", name: "Advanced Analytics with Pyspark: Patterns for Learning from Data at Scale", available: 25 }, { id: "k2", name: "Statistics", available: 5 }] };
      state.studyNowDue = 3;
      state.studyNowDueLessons = [];
      state._dashHeroData = { summary: { cards: 40 }, newCardEstimate: est, today: today };
      showScreen("home");
      const grid = document.getElementById("home-summary-grid");
      grid.innerHTML = streakTimeHeroCard(null, null, { cards: 40 }, est, today);
      for (let el = grid; el; el = el.parentElement) el.classList.remove("hidden");
      const label = grid.querySelector(".study-now-classes-btn span");
      return { page: document.documentElement.scrollWidth, cut: label.scrollWidth > label.clientWidth };
    });
    assert.ok(r.page <= 390, "page is " + r.page + "px wide");
    assert.equal(r.cut, true);
  });
});

test("the order sheet saves every move as it lands, keeps a Completed class's place, and reopens in the saved order", async function() {
  await withApp(async function(page) {
    await page.evaluate(function() {
      const today = { count: 0, activity: { studyMs: 0, newCards: 0, reviews: 0 }, medianMs: {} };
      const est = { estimatedNewCards: 10, availableNewCards: 30, byClass: [
        { id: "k0", name: "Finished Book", available: 0 }, { id: "k1", name: "Deep Learning", available: 25 },
        { id: "k2", name: "Statistics", available: 5 }, { id: "k3", name: "Guide", available: 2 }] };
      state.studyNowDue = 0;
      state.studyNowDueLessons = [];
      state._dashHeroData = { summary: { cards: 40 }, newCardEstimate: est, today: today };
      window.__orders = [];
      store.setClassOrder = (ids) => { window.__orders.push(ids); return Promise.resolve({ ok: true }); };
      showScreen("home");
      const grid = document.getElementById("home-summary-grid");
      grid.innerHTML = streakTimeHeroCard(null, null, { cards: 40 }, est, today);
      for (let el = grid; el; el = el.parentElement) el.classList.remove("hidden");
      grid.querySelector("[data-study-now-classes]").click();
    });
    const rows = () => page.evaluate(() => [...document.querySelectorAll("#study-order-list li")].map((li) => li.dataset.classId + (li.classList.contains("is-done") ? ":done" : "")));
    assert.deepEqual(await rows(), ["k1", "k2", "k3", "k0:done"], "a class with no new cards left sinks to the bottom");
    assert.equal(await page.locator('#study-order-list li[data-class-id="k0"] small').textContent(), "Completed");
    assert.equal(await page.locator('#study-order-list li[data-class-id="k0"] [data-sn-handle]').count(), 0, "Completed is out of the drag");

    // Drag Guide to the top with the mouse, by its handle: saved on the drop.
    const handle = await page.locator('#study-order-list li[data-class-id="k3"] [data-sn-handle]').boundingBox();
    const top = await page.locator('#study-order-list li[data-class-id="k1"]').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, top.y + 6, { steps: 8 });
    await page.mouse.up();
    assert.deepEqual(await rows(), ["k3", "k1", "k2", "k0:done"]);

    // Past the last class still being learnt, a row stays above Completed; each step saves.
    await page.focus('#study-order-list li[data-class-id="k1"] [data-sn-handle]');
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    assert.deepEqual(await rows(), ["k3", "k2", "k1", "k0:done"]);
    await page.waitForFunction(() => document.getElementById("study-order-saved").textContent === "Saved ✓");

    // Closed without Done: the order is already saved.
    await page.keyboard.press("Escape");
    const r = await page.evaluate(() => ({ orders: window.__orders, byClass: state._dashHeroData.newCardEstimate.byClass.map((c) => c.id),
      hidden: document.getElementById("modal-study-order").classList.contains("hidden"),
      chip: document.querySelector("#home-summary-grid [data-study-now-classes]").textContent }));
    assert.equal(r.hidden, true);
    // Finished Book keeps the first place it held: new cards synced into it bring it back there.
    assert.deepEqual(r.orders, [["k0", "k3", "k1", "k2"], ["k0", "k3", "k2", "k1"]], "the last ArrowDown hit Completed and changed nothing");
    assert.deepEqual(r.byClass, ["k0", "k3", "k2", "k1"]);
    assert.equal(r.chip, "New cards from Guide▾");
    await page.click("#home-summary-grid [data-study-now-classes]");
    assert.deepEqual(await rows(), ["k3", "k2", "k1", "k0:done"], "the new order is what opens next");
  }, { isMobile: false, hasTouch: false });
});

test("a finger drags a class up the order sheet on a phone, without scrolling the page", async function() {
  await withApp(async function(page) {
    await page.evaluate(function() {
      const today = { count: 0, activity: { studyMs: 0, newCards: 0, reviews: 0 }, medianMs: {} };
      const est = { estimatedNewCards: 10, availableNewCards: 30, byClass: [
        { id: "k1", name: "Deep Learning", available: 25 }, { id: "k2", name: "Statistics", available: 5 }, { id: "k3", name: "Guide", available: 2 }] };
      state.studyNowDue = 0;
      state.studyNowDueLessons = [];
      state._dashHeroData = { summary: { cards: 40 }, newCardEstimate: est, today: today };
      window.__orders = [];
      store.setClassOrder = (ids) => { window.__orders.push(ids); return Promise.resolve({ ok: true }); };
      showScreen("home");
      const grid = document.getElementById("home-summary-grid");
      grid.innerHTML = streakTimeHeroCard(null, null, { cards: 40 }, est, today);
      for (let el = grid; el; el = el.parentElement) el.classList.remove("hidden");
      grid.querySelector("[data-study-now-classes]").click();
    });
    await page.waitForTimeout(400);
    const handle = await page.locator('#study-order-list li[data-class-id="k3"] [data-sn-handle]').boundingBox();
    const top = await page.locator('#study-order-list li[data-class-id="k1"]').boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const x = handle.x + handle.width / 2;
    const scrollBefore = await page.evaluate(() => scrollY);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: handle.y + handle.height / 2 }] });
    for (let y = handle.y + handle.height / 2; y > top.y + 6; y -= 10)
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: top.y + 6 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const r = await page.evaluate(() => ({ rows: [...document.querySelectorAll("#study-order-list li")].map((li) => li.dataset.classId), scroll: scrollY, orders: window.__orders }));
    assert.deepEqual(r.rows, ["k3", "k1", "k2"]);
    assert.deepEqual(r.orders, [["k3", "k1", "k2"]]);
    assert.equal(r.scroll, scrollBefore);
  });
});

test("in a Study now run the time left counts the new cards still to come, and ticks need four cards", async function() {
  await withApp(async function(page) {
    const r = await page.evaluate(function(cards) {
      const many = (n) => Array.from({ length: n }, (_, i) => Object.assign({}, cards[i % 4], { id: "r" + i }));
      state.studyScope = { lessonIds: ["l1"], lessons: [], returnScreen: "home", title: "Study now" };
      state.currentLesson = { id: "l1", title: "Quiz", format: "mcq" };
      state.pendingStudyNowRun = { reviews: 20, fresh: 1, phase: "review" };
      launchStudy(many(20), "quiz", "in-order");
      const marks = () => [...document.querySelectorAll("#quiz-progress-fill ~ .pb-mark")].map((m) => m.className.replace("pb-mark is-", ""));
      const out = { withNew: document.getElementById("quiz-progress-text").textContent, marks: marks() };
      state.pendingStudyNowRun = { reviews: 20, fresh: 30, phase: "review" };
      launchStudy(many(20), "quiz", "in-order");
      out.moreNew = document.getElementById("quiz-progress-text").textContent;
      out.marksBoth = marks();
      return out;
    }, QUIZ4);
    assert.equal(r.withNew.split(" · ")[0], "Review 1 / 20");
    assert.deepEqual(r.marks, ["mid", "notch"], "no middle tick in a one-card half");
    assert.deepEqual(r.marksBoth, ["mid", "notch", "mid"]);
    const minutes = (s) => Number(/~(\d+)/.exec(s)[1]);
    // Thirty more flashcards at the fallback 10 s add five minutes to the twenty reviews' time.
    assert.equal(minutes(r.moreNew) - minutes(r.withNew), 5);
  });
});

test("a Study now run that learns first puts the new half first on the bar and counts the reviews still to come", async function() {
  await withApp(async function(page) {
    const r = await page.evaluate(function(cards) {
      const many = (n) => Array.from({ length: n }, (_, i) => Object.assign({}, cards[i % 4], { id: "r" + i }));
      state.studyScope = { lessonIds: ["l1"], lessons: [], returnScreen: "home", title: "Study now" };
      state.currentLesson = { id: "l1", title: "Quiz", format: "mcq" };
      const labels = () => [...document.querySelectorAll("#quiz-progress-labels span")].map((s) => s.textContent + (s.className ? ":" + s.className : ""));
      state.pendingStudyNowRun = { reviews: 20, fresh: 30, first: "new", mode: "quiz", phase: "new" };
      launchStudy(many(30), "quiz", "in-order");
      const out = { text: document.getElementById("quiz-progress-text").textContent, labels: labels(),
        done: !!document.querySelector("#quiz-progress-fill ~ .pb-done") };
      state.pendingStudyNowRun = { reviews: 20, fresh: 1, first: "new", mode: "quiz", phase: "new" };
      launchStudy(many(1), "quiz", "in-order");
      out.oneText = document.getElementById("quiz-progress-text").textContent;
      state.pendingStudyNowRun = { reviews: 20, fresh: 30, first: "new", mode: "quiz", phase: "review" };
      launchStudy(many(20), "quiz", "in-order");
      out.after = labels();
      out.afterText = document.getElementById("quiz-progress-text").textContent;
      out.afterDone = document.querySelector("#quiz-progress-fill ~ .pb-done").style.width;
      return out;
    }, QUIZ4);
    assert.equal(r.text.split(" · ")[0], "New 1 / 30");
    assert.deepEqual(r.labels, ["New 1/30:is-now", "Review 20"]);
    assert.equal(r.done, false);
    const minutes = (s) => Number(/~(\d+)/.exec(s)[1]);
    // The 20 reviews still to come are quizzes, at the fallback 15 s: five minutes.
    assert.equal(minutes(r.oneText), 5, r.oneText);
    assert.deepEqual(r.after, ["Learned ✓:is-done", "Review 20:is-now"]);
    assert.equal(r.afterText.split(" · ")[0], "Review 1 / 20");
    assert.equal(r.afterDone, "60%");
  });
});

test("the quiz card shows when it comes back if right and if wrong, before the answer, and marks what happened", async function() {
  await withApp(async function(page) {
    const r = await page.evaluate(async function(cards) {
      const now = Math.floor(Date.now() / 1000);
      const day = 86400;
      // A card reviewed 12 days ago and due now; its previews as the server sends them.
      const seen = (c) => Object.assign({}, c, { srs_due_at: now - 60, fsrs_last_review_at: now - 60 - 12 * day,
        fsrs_preview_again: 600, fsrs_preview_hard: 15 * day, fsrs_preview_good: 30 * day });
      let reply = null;
      store.recordAttempt = () => new Promise((ok) => { reply = ok; });
      state.quizCountsAsKnown = false;
      state.currentLesson = { id: "l1", title: "Quiz", format: "mcq" };
      state.quizCards = [seen(cards[0]), seen(cards[1]), Object.assign({}, cards[2], { srs_due_at: now + day, fsrs_preview_hard: 600, fsrs_preview_again: 60 })];
      startQuiz();
      const read = () => [...document.querySelectorAll("#quiz-outcomes .quiz-out")].map((o) => (o.querySelector("svg line") ? "✗ " : o.querySelector("svg polyline") ? "✓ " : "") + o.textContent + (o.classList.contains("is-on") ? ":on" : o.classList.contains("is-off") ? ":off" : ""));
      const out = { before: read(), label: document.querySelector("#quiz-outcomes .quiz-out-ok").getAttribute("aria-label"),
        glyphs: /[✓✗]/.test(document.getElementById("quiz-outcomes").textContent) };
      answerQuiz(state.quizOptions.indexOf(state.quizCards[0].data.correct));
      out.right = read();
      reply({ ok: true, srs_due_at: now + 16 * day, notDue: false });
      await new Promise((r) => setTimeout(r, 0));
      out.rightServer = read();
      out.sheet = document.getElementById("quiz-sheet").textContent;
      pauseQuizAdvance(); document.getElementById("quiz-next-btn").click();
      answerQuiz(state.quizOptions.findIndex((o) => o !== state.quizCards[1].data.correct));
      out.wrong = read();
      document.getElementById("quiz-next-btn").click();
      out.notDue = read();
      out.notDuePad = getComputedStyle(document.querySelector(".quiz-question-wrap")).paddingBottom;
      state.quizIndex = 0; renderQuizCard();
      out.replay = read();
      state.quizCountsAsKnown = true; state.quizResults = []; state.quizIndex = 0; renderQuizCard();
      out.asKnown = read();
      return out;
    }, QUIZ4);
    assert.deepEqual(r.before, ["✗ 10 min", "✓ 15d"]);
    assert.equal(r.label, "If right: back in 15d");
    assert.equal(r.glyphs, false, "drawn as the app's icons, not ✓ ✗ characters in a fallback font");
    assert.deepEqual(r.right, ["✗ 10 min:off", "✓ 15d:on"]);
    assert.deepEqual(r.rightServer, ["✗ 10 min:off", "✓ 16d:on"], "the server's date wins once it arrives");
    assert.doesNotMatch(r.sheet, /15d|16d|was/, "the sheet no longer repeats it");
    assert.deepEqual(r.wrong, ["✗ 10 min:on", "✓ 15d:off"]);
    assert.deepEqual(r.notDue, [], "a card not due keeps its schedule");
    assert.equal(r.notDuePad, "28px");
    assert.deepEqual(r.replay, ["✗ 10 min:off", "✓ 15d:on"], "a replayed card shows what its answer did");
    assert.deepEqual(r.asKnown, ["✗ 10 min", "✓ 1 mo"], "quiz answers counted as Know It are rated Good");
  });
});
