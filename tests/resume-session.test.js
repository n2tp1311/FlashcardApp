"use strict";
// Resume an unfinished session: a flashcard session is saved on the device after every grade,
// and Home's Today tile offers it back in place of Study now until the day turns. app.js's own
// functions, under the real stylesheet.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
function fn(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}
const strings = {
  "resume.go": "Continue · {n} cards left", "resume.go_one": "Continue · 1 card left",
  "resume.lessons": "{n} lessons", "resume.drop": "Drop it and start a new session",
  "resume.gone": "gone", "setup.loadFailed": "failed",
  "studyNow.minutes": "~{n} min", "studyNow.underMinute": "<1 min"
};
const harness = `
var currentUser = { id: "u1" };
var STRINGS = ${JSON.stringify(strings)};
function t(k, p) {
  p = p || {};
  var key = p.n === 1 && STRINGS[k + "_one"] ? k + "_one" : k;
  return (STRINGS[key] || k).replace(/\\{(\\w+)\\}/g, function(_, n) { return p[n]; });
}
function escHtml(s) { return String(s).replace(/</g, "&lt;"); }
var ETA_FALLBACK_MS = { flashcard: 10000, quiz: 15000 };
var state = {}, toasts = [], refreshed = 0, started = 0, active = "home", seen = null, bulk;
function showToast(m) { toasts.push(m); }
function _refreshDashHeroCards() { refreshed++; }
function getActiveScreen() { return active; }
function startFlashcards() { started++; state.sessionMs = 0; }
var store = {
  getBulkCards: function() { return bulk(); },
  getDifficultyMap: function(ids) { var m = {}; ids.forEach(function(id) { m[id] = { d: 1 }; }); return Promise.resolve(m); },
  markCardsSeen: function(ids) { seen = ids; }
};
${fn("resumeKey")}${fn("saveResumeSession")}${fn("clearResumeSession")}${fn("readResumeSession")}${fn("resumeSessionHtml")}${fn("resumeStudySession")}
var RESUME_MIN_LEFT = 3;
function card(id) { return { id: id, known: null }; }
function session(n, graded, extra) {
  state = Object.assign({ studyMode: "flashcard", cram: null, sessionMs: 61000,
    studyScope: { lessonIds: ["l1", "l2"], lessons: [{ id: "l1", title: "Ch 1", cards: [] }, { id: "l2", title: "Ch 2" }], title: "" },
    studyCards: [], studySessionLog: {}, studySessionNewSet: { c0: true } }, extra || {});
  for (var i = 0; i < n; i++) state.studyCards.push(card("c" + i));
  for (var j = 0; j < graded; j++) state.studySessionLog["c" + j] = "known";
}
function saved() { return JSON.parse(localStorage.getItem("fc-resume-u1") || "null"); }
function tile() {
  document.body.innerHTML = '<section class="dash-tile" style="width:340px">' + resumeSessionHtml({ medianMs: { flashcard: 20000 } }) + '</section>';
  return document.body.innerText.replace(/\\s+/g, " ").trim();
}
`;

let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { if (browser) await browser.close(); });

async function fresh() {
  const p = await browser.newPage();
  // localStorage needs a real origin; a route serves one blank page for it.
  await p.route("http://resume.test/", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }));
  await p.goto("http://resume.test/");
  await p.addStyleTag({ path: path.join(root, "client", "style.css") });
  await p.addScriptTag({ content: harness });
  return p;
}

test("saved after a grade, only for a flashcard session with enough left to be worth coming back to", async () => {
  const p = await fresh();
  const r = await p.evaluate(() => {
    var out = {};
    session(10, 0); saveResumeSession(); out.none = saved();
    session(10, 2); saveResumeSession(); out.two = saved();
    session(10, 8); saveResumeSession(); out.tooFew = saved();
    session(10, 2, { studyMode: "quiz" }); saveResumeSession(); out.quiz = saved();
    session(10, 2, { cram: { id: "x" } }); saveResumeSession(); out.cram = saved();
    session(10, 3, { studyMode: "flashcard-write" }); saveResumeSession(); out.write = saved();
    return out;
  });
  assert.equal(r.none, null, "nothing graded yet is nothing to resume");
  assert.deepEqual(r.two.ids.length, 10);
  assert.deepEqual(r.two.lessons, [{ id: "l1", title: "Ch 1" }, { id: "l2", title: "Ch 2" }], "titles only, not the cards");
  assert.equal(r.two.sessionMs, 61000);
  assert.deepEqual(r.two.newIds, ["c0"]);
  assert.equal(r.two.day, new Date().toISOString().slice(0, 10));
  assert.equal(r.tooFew, null, "two left: not worth a button");
  assert.equal(r.quiz, null);
  assert.equal(r.cram, null);
  assert.equal(r.write.mode, "flashcard-write");
  await p.close();
});

test("Home offers it in place of Study now, until another day, and dropping it clears it", async () => {
  const p = await fresh();
  let r = await p.evaluate(() => { session(10, 3); saveResumeSession(); return tile(); });
  assert.equal(r, "Continue · 7 cards left 2 lessons · ~2 min Drop it and start a new session");
  r = await p.evaluate(() => { session(10, 3, { studyScope: { lessonIds: ["l1"], lessons: [{ id: "l1", title: "<b>Ch 1" }], title: "" } }); saveResumeSession(); tile(); return document.querySelector("small").innerHTML; });
  assert.equal(r, "&lt;b&gt;Ch 1 · ~2 min", "a lesson title is escaped");
  r = await p.evaluate(() => { session(4, 1, { studyScope: { lessonIds: ["l1"], lessons: [], title: "Study now" } }); saveResumeSession(); return tile(); });
  assert.equal(r, "Continue · 3 cards left Study now · ~1 min Drop it and start a new session");

  // Yesterday's session is gone, and the stale entry with it.
  r = await p.evaluate(() => {
    var s = saved(); s.day = "2000-01-01"; localStorage.setItem("fc-resume-u1", JSON.stringify(s));
    return { text: tile(), left: localStorage.getItem("fc-resume-u1") };
  });
  assert.deepEqual(r, { text: "", left: null });
  r = await p.evaluate(() => { localStorage.setItem("fc-resume-u1", "{not json"); return tile(); });
  assert.equal(r, "", "a broken entry is ignored");
  await p.close();
});

test("resuming reloads the cards, keeps the grades and the time, and opens on the first ungraded card", async () => {
  const p = await fresh();
  const r = await p.evaluate(async () => {
    session(8, 3); state.studySessionLog.c4 = "learning"; saveResumeSession();
    state = {};
    // c1 was deleted meanwhile; c2 was edited.
    bulk = function() { return Promise.resolve([card("c5"), card("c0"), { id: "c2", known: 1, data: "edited" }, card("c3"), card("c4"), card("c6"), card("c7"), card("x")]); };
    tile();
    resumeStudySession(document.querySelector("[data-resume]"));
    await new Promise((ok) => setTimeout(ok, 30));
    return { ids: state.studyCards.map((c) => c.id), index: state.studyIndex, log: state.studySessionLog, started: started,
      ms: state.sessionMs, newSet: state.studySessionNewSet, known: state.studyKnownMap, edited: state.studyCards[1].data,
      scope: state.studyScope, seen: seen, mode: state.studyMode, write: state.typeToCompare };
  });
  assert.deepEqual(r.ids, ["c0", "c2", "c3", "c4", "c5", "c6", "c7"]);
  assert.equal(r.index, 2, "c3 is the first card not yet graded");
  assert.deepEqual(r.log, { c0: "known", c2: "known", c4: "learning" });
  assert.equal(r.started, 1);
  assert.equal(r.ms, 61000, "the time before counts in the summary");
  assert.deepEqual(r.newSet, { c0: true });
  assert.deepEqual(r.known, { c2: true });
  assert.equal(r.edited, "edited", "the card as it is now, not as saved");
  assert.equal(r.scope.returnScreen, "home");
  assert.deepEqual(r.seen, r.ids);
  assert.equal(r.mode, "flashcard");
  assert.equal(r.write, false);
  await p.close();
});

test("a deleted lesson ends the saved session; a network failure keeps it for another try", async () => {
  const p = await fresh();
  const r = await p.evaluate(async () => {
    var out = {};
    session(10, 3); saveResumeSession();
    bulk = function() { return Promise.reject(new Error("offline")); };
    tile(); resumeStudySession(document.querySelector("[data-resume]"));
    await new Promise((ok) => setTimeout(ok, 30));
    out.offline = { kept: !!saved(), toasts: toasts.slice(), loading: document.querySelector("[data-resume]").classList.contains("is-loading") };
    toasts = [];
    bulk = function() { var e = new Error("Not found"); e.status = 404; return Promise.reject(e); };
    resumeStudySession(document.querySelector("[data-resume]"));
    await new Promise((ok) => setTimeout(ok, 30));
    out.gone = { kept: !!saved(), toasts: toasts.slice(), refreshed: refreshed };
    return out;
  });
  assert.deepEqual(r.offline, { kept: true, toasts: ["failed"], loading: false });
  assert.deepEqual(r.gone, { kept: false, toasts: ["gone"], refreshed: 1 });
  await p.close();
});

test("wiring: saved on grade and undo, cleared on a new session and at the summary, shown in the Today tile", () => {
  assert.match(fn("markCard"), /state\.studySessionLog\[card\.id\] = [^\n]*\n  saveResumeSession\(\);/);
  assert.match(fn("restoreGradedCard"), /state\.studySessionLog\[id\] = undo\.prevLog;\n  saveResumeSession\(\);/);
  assert.match(fn("launchStudy"), /clearResumeSession\(\);/);
  assert.match(fn("showFlashcardSummary"), /clearResumeSession\(\);/);
  assert.match(fn("heroTodayTile"), /\(resumeSessionHtml\(today\) \|\| studyNowHtml\(/);
  assert.match(app, /e\.target\.closest\("\[data-resume\]"\)[\s\S]{0,120}resumeStudySession\(btn\)/);
  assert.match(app, /closest\("\[data-resume-drop\]"\)\) \{ clearResumeSession\(\); _refreshDashHeroCards\(\); \}/);
  for (const k of ["resume.go", "resume.lessons", "resume.drop", "resume.gone"]) {
    assert.equal(app.split('"' + k + '":').length - 1, 2, k + " in English and Vietnamese");
  }
});
