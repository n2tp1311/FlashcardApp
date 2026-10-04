const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "client", "style.css"), "utf8");

function fn(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}

function returnFrom(returnScreen) {
  const calls = [];
  const ctx = {
    state: { studyScope: returnScreen ? { returnScreen } : null },
    calls,
  };
  ["dismissGradeUndo", "clearTimeout", "clearFlashcardTranslation", "renderHome", "renderUpstream",
   "renderDashboard", "renderCards", "renderLessons"].forEach(function(n) {
    ctx[n] = function() { calls.push(n); };
  });
  ctx.showScreen = function(s) { calls.push("show:" + s); };
  vm.createContext(ctx);
  vm.runInContext(fn("returnFromStudy") + fn("studyReturnTarget"), ctx);
  ctx.returnFromStudy();
  return calls.filter(function(c) { return /^render|^show:/.test(c); });
}

test("leaving a session redraws the screen it returns to, the lesson's card list included", function() {
  assert.deepEqual(returnFrom(null), ["show:lesson", "renderCards"]);
  assert.deepEqual(returnFrom("lesson"), ["show:lesson", "renderCards"]);
  assert.deepEqual(returnFrom("class"), ["show:class", "renderLessons"]);
  assert.deepEqual(returnFrom("dashboard"), ["show:dashboard", "renderDashboard"]);
  assert.deepEqual(returnFrom("upstream"), ["show:upstream", "renderUpstream"]);
});

test("a due quiz opened from the Dashboard returns there, and the button says so", function() {
  assert.match(fn("openDueReview"), /startDueQuiz\(lesson, dueCards, "dashboard"\)/);
  ["lesson", "home", "class", "upstream", "dashboard"].forEach(function(s) {
    const key = { lesson: "Lesson", home: "Home", class: "Class", upstream: "Updates", dashboard: "Dashboard" }[s];
    assert.equal((app.match(new RegExp('"results\\.backTo' + key + '":', "g")) || []).length, 2, key);
  });
  assert.match(app, /setStudyBackLabels\(\);\n  showScreen\("results"\)/);
  assert.match(app, /setStudyBackLabels\(\);\n  showScreen\("flashcard-summary"\)/);
});

test("the search swipe-down listener finds its element", function() {
  const sel = app.match(/document\.querySelector\("(#modal-search \.search-modal)"\)/);
  assert.ok(sel, "swipe-down must look the modal up by a selector that exists");
  assert.match(html, /id="modal-search"[^>]*>\s*<div class="modal search-modal"/);
});

test("the hidden compatibility header is gone and the Dashboard opens directly", function() {
  assert.doesNotMatch(html, /Keep for compatibility/);
  assert.doesNotMatch(html, /id="btn-dashboard"/);
  assert.doesNotMatch(app, /getElementById\("btn-dashboard"\)/);
  assert.equal((html.match(/<kbd class="kbd">A<\/kbd><span data-i18n="nav\.dashboard">/g) || []).length, 0);
});

test("pills and tabs carry their ARIA state; form focus is visible; distractors stay legible", function() {
  assert.match(fn("setPrefLang"), /aria-pressed/);
  assert.match(fn("setStatsTab"), /aria-selected/);
  assert.match(html, /class="stats-tabs" role="tablist"/);
  assert.match(css, /\.form-input:focus-visible, \.form-textarea:focus-visible \{ box-shadow/);
  const op = css.match(/\.quiz-opt\.dimmed \{ opacity: ([\d.]+); \}/);
  assert.ok(op && Number(op[1]) >= 0.7);
});

test("a phone flashcard sizes from the viewport and says when there is more to scroll", function() {
  assert.match(css, /\.fc-scene \{ height: clamp\(220px, calc\(100dvh - 340px\), 520px\); \}/);
  assert.doesNotMatch(css, /\.fc-scene \{ height: 220px; \}/);
  assert.match(css, /\.fc-front, \.fc-back \{[^}]*padding: 44px 24px 24px;/);
  assert.match(css, /\.fc-content\.fc-more \{[^}]*mask-image/);
  const marks = [];
  const els = {};
  ["fc-front-content", "fc-back-content"].forEach(function(id, i) {
    els[id] = { textContent: i ? "x".repeat(200) : "short", scrollHeight: i ? 900 : 100, scrollTop: 0, clientHeight: 300,
      classList: { toggle: function(c, on) { marks.push(id + ":" + c + ":" + on); } } };
  });
  const ctx = { document: { getElementById: function(id) { return els[id]; } }, FC_LONG_TEXT: 140 };
  vm.createContext(ctx);
  vm.runInContext(fn("markFcOverflow"), ctx);
  ctx.markFcOverflow();
  assert.deepEqual(marks, ["fc-front-content:fc-long:false", "fc-front-content:fc-more:false",
                           "fc-back-content:fc-long:true", "fc-back-content:fc-more:true"]);
});

test("touch screens get 44px icon targets", function() {
  const coarse = css.slice(css.indexOf("Apple's 44pt minimum"));
  assert.match(coarse, /\.btn-icon, \.icon-btn, \.sort-dir-btn, \.btn-audio, \.modal-close \{ min-width: 44px; min-height: 44px; \}/);
  assert.match(html, /id="btn-fc-edit-card"[^\n]*\n\s*<span class="fc-toolbar-gap"/);
});

function upstreamCtx() {
  const acks = [];
  const timers = [];
  const els = {};
  const el = function(id) {
    return els[id] || (els[id] = { textContent: "", classList: { add: function() {}, remove: function() {} } });
  };
  const cards = [{ id: "a", upstream_change: "updated" }, { id: "b", upstream_change: "deleted" }];
  const ctx = {
    state: { upstreamData: { cards: cards.slice(), count: { total: 2, updated: 1, deleted: 1 } } },
    store: { acknowledgeCardUpdate: function(id) { acks.push(id); return Promise.resolve(); } },
    document: { getElementById: el },
    setTimeout: function(f) { timers.push(f); return timers.length; },
    clearTimeout: function() {},
    setUpstreamCount: function() {}, showUpstreamData: function() {}, showToast: function() {},
    upstreamConceptName: function(c) { return c.id; }, t: function(k) { return k; },
    UPSTREAM_UNDO_MS: 6000,
  };
  vm.createContext(ctx);
  vm.runInContext(["dropUpstreamCard", "restoreUpstreamCard", "markUpstreamReviewed", "flushUpstreamPending",
                   "showUndoBar", "hideUndoBar"].map(fn).join(""), ctx);
  return { ctx, acks, timers, cards };
}

test("Mark reviewed leaves the list in place and sends the acknowledgement only when undo expires", function() {
  const u = upstreamCtx();
  u.ctx.markUpstreamReviewed(u.cards[0]);
  assert.deepEqual(u.ctx.state.upstreamData.cards.map(function(c) { return c.id; }), ["b"]);
  assert.equal(u.ctx.state.upstreamData.count.total, 1);
  assert.deepEqual(u.acks, []);
  u.timers[0]();
  assert.deepEqual(u.acks, ["a"]);
});

test("Undo puts the card back where it was and sends nothing", function() {
  const u = upstreamCtx();
  u.ctx.markUpstreamReviewed(u.cards[0]);
  u.ctx.state.undoHandler();
  assert.deepEqual(u.ctx.state.upstreamData.cards.map(function(c) { return c.id; }), ["a", "b"]);
  assert.equal(u.ctx.state.upstreamData.count.updated, 1);
  assert.equal(u.ctx.state.upstreamPending, null);
  assert.deepEqual(u.acks, []);
});

test("a second mark, or leaving the screen, sends the pending one at once", function() {
  const u = upstreamCtx();
  u.ctx.markUpstreamReviewed(u.cards[0]);
  u.ctx.markUpstreamReviewed(u.cards[1]);
  assert.deepEqual(u.acks, ["a"]);
  assert.match(fn("showScreen"), /if \(id !== "upstream"\) flushUpstreamPending\(\);/);
});

test("Updates actions are real buttons with Delete set apart; wide list screens stop at --content-max", function() {
  const item = fn("renderUpstreamItem");
  assert.match(item, /b\.className = "btn btn-sm " \+ cls/);
  assert.match(item, /"btn-ghost btn-toolbar-danger upstream-delete"/);
  assert.doesNotMatch(item, /link-btn/);
  assert.match(css, /#screen-class, #screen-lesson, #screen-upstream \{\s*padding-left: max\(16px, calc\(\(100% - var\(--nav-w, 0px\) - var\(--content-max\)\) \/ 2\)\);/);
  assert.match(app, /'<div class="lesson-badges">'/);
});

function tr(lang, key) {
  const block = app.slice(app.indexOf("Object.assign(TRANSLATIONS." + lang + ", {"));
  const m = block.match(new RegExp('"' + key.replace(/\./g, "\\.") + '": "([^"]*)"'));
  return m && m[1];
}

test("a grade has one name everywhere, and the difficulty pill can no longer be read as one", function() {
  assert.equal(tr("en", "dashboard.gradeMedium"), tr("en", "study.knowIt"));
  assert.equal(tr("en", "dashboard.gradeEasy"), tr("en", "study.confident"));
  assert.equal(tr("vi", "dashboard.gradeMedium"), tr("vi", "study.knowIt"));
  ["difficulty.easy", "difficulty.medium", "difficulty.hard"].forEach(function(k) {
    ["study.learning", "study.hard", "study.knowIt", "study.confident"].forEach(function(g) {
      assert.notEqual(tr("en", k), tr("en", g), k + " vs " + g);
    });
  });
  assert.doesNotMatch(app + html, /Still Learning/);
});

test("imports have plain names, show progress, and errors stay until dismissed", function() {
  assert.equal(tr("en", "class.bulkImport"), "Paste lessons");
  assert.equal(tr("en", "lesson.bulkAdd"), "+ Paste cards");
  assert.match(html, /data-i18n="import\.importFile">Import file</);
  assert.match(app, /importLabel\.textContent = t\("import\.importing"\)/);
  const toast = fn("showToast");
  assert.match(toast, /if \(!error\) toastTimer = setTimeout/);
  assert.match(toast, /el\.setAttribute\("role", error \? "alert" : "status"\)/);
  const server = fs.readFileSync(path.join(root, "server", "routes", "exportImport.js"), "utf8");
  assert.match(server, /imported: \{ classes: classes\.length, lessons: importedLessons, cards: importedCards, classIds \}/);
});

test("Preferences is in four sections, and the data one hides with its rows in local mode", function() {
  const groups = html.match(/<h4 class="pref-group"[^>]*data-i18n="(pref\.group\w+)"/g) || [];
  assert.equal(groups.length, 4);
  assert.match(app, /"pref-backup", "pref-group-data"/);
  ["Appearance", "Study", "Sound", "Data"].forEach(function(g) { assert.ok(tr("vi", "pref.group" + g), g); });
});

test("on a phone the lesson header moves Select into the menu and shortens the due button", function() {
  assert.match(html, /id="btn-lesson-select-menu"/);
  const phone = css.slice(css.indexOf("Phone lesson header"));
  assert.match(phone, /#btn-select-cards \{ display: none; \}/);
  assert.match(phone, /#btn-review-due \.due-short \{ display: inline; \}/);
  assert.ok(tr("vi", "study.reviewDueShort"));
});

test("the sidebar sits outside every screen and its items take keyboard focus", function() {
  const nav = html.indexOf('<nav id="sidebar"');
  const home = html.indexOf('<div id="screen-home"');
  assert.ok(nav > 0 && nav < home, "sidebar must precede #screen-home, not live inside it");
  const items = html.match(/<li class="sidebar-nav-item[^>]*>/g);
  assert.equal(items.length, 6);
  items.forEach(function(li) { assert.match(li, /tabindex="0" role="link"/); });
  const render = fn("renderSidebarClasses");
  assert.match(render, /li\.tabIndex = 0/);
  assert.match(render, /li\.dataset\.classId/);
  assert.match(app, /closest\("\.sidebar-nav-item, \.sidebar-class-item"\)[\s\S]{0,120}item\.click\(\)/);
});

function fakeItem(id, classId) {
  const attrs = {}, classes = new Set();
  return {
    id: id, dataset: classId ? { classId: classId } : {},
    classList: { toggle: function(c, on) { if (on) classes.add(c); else classes.delete(c); }, has: function(c) { return classes.has(c); } },
    setAttribute: function(k, v) { attrs[k] = v; }, removeAttribute: function(k) { delete attrs[k]; },
    attrs: attrs,
  };
}

function sidebarAfter(screen, currentClass) {
  const navItems = ["sidebar-home-link", "sidebar-dashboard-link", "sidebar-upstream-link"].map(function(id) { return fakeItem(id); });
  const classItems = [fakeItem("", "c1"), fakeItem("", "c2")];
  const body = fakeItem("body");
  let fetched = 0;
  const ctx = {
    state: { currentClass: currentClass, sidebarClassesLoaded: true },
    document: {
      body: body,
      querySelectorAll: function(sel) { return sel.indexOf("class-list") >= 0 ? classItems : navItems; },
    },
    store: { getClasses: function() { fetched++; return { then: function() { return { catch: function() {} }; } }; } },
  };
  vm.createContext(ctx);
  const src = app.slice(app.indexOf("\nvar NAV_SCREENS"), app.indexOf("\nfunction syncSidebar("));
  vm.runInContext(src + fn("syncSidebar"), ctx);
  ctx.syncSidebar(screen);
  return { body: body.attrs, navItems: navItems, classItems: classItems, fetched: function() { return fetched; }, ctx: ctx };
}

test("showScreen docks the sidebar on list screens and marks where you are", function() {
  const dash = sidebarAfter("dashboard", null);
  assert.equal(dash.body["data-nav"], "page");
  assert.equal(dash.navItems[1].attrs["aria-current"], "page");
  assert.equal(dash.navItems[0].attrs["aria-current"], undefined);

  const cls = sidebarAfter("lesson", { id: "c2" });
  assert.equal(cls.classItems[1].attrs["aria-current"], "page");
  assert.ok(cls.classItems[1].classList.has("sidebar-nav-active"));
  assert.equal(cls.classItems[0].attrs["aria-current"], undefined);

  assert.equal(sidebarAfter("home", null).body["data-nav"], "home");
  assert.equal(sidebarAfter("quiz", { id: "c2" }).body["data-nav"], undefined);
  assert.equal(sidebarAfter("flashcard", null).body["data-nav"], undefined);
});

test("a reload straight into a class fills the sidebar's class list once", function() {
  const r = sidebarAfter("class", { id: "c1" });
  assert.equal(r.fetched(), 0);
  r.ctx.state.sidebarClassesLoaded = false;
  r.ctx.syncSidebar("class");
  r.ctx.syncSidebar("lesson");
  assert.equal(r.fetched(), 1);
});

test("list screens make room for the docked sidebar from 1024px; study screens never show it", function() {
  assert.match(css, /body:not\(\[data-nav\]\) :is\(\.sidebar, \.sidebar-overlay\) \{ display: none; \}/);
  assert.match(css, /@media \(min-width: 1024px\) \{ body\[data-nav\] \{ --nav-w: 240px; \} \}/);
  assert.match(css, /\.screen \{ margin-left: var\(--nav-w, 0px\); \}/);
  assert.match(css, /100% - var\(--nav-w, 0px\) - var\(--content-max\)/);
});

test("corner radii that match a token use the token", function() {
  assert.match(css, /--radius-pill: 999px;/);
  const literal = css.match(/border-radius: (?:999px|50px|20px|10px|7px|6px);/g);
  assert.equal(literal, null);
});
