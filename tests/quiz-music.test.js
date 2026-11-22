const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");

function fn(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}
function constant(name) {
  const m = app.match(new RegExp("\\nvar " + name + " = [^;]+;"));
  assert.ok(m, "missing " + name);
  return m[0];
}

function context(store) {
  const ctx = vm.createContext({
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
  });
  vm.runInContext(["QUIZ_MUSIC_LEVEL", "QUIZ_MUSIC_DEFAULT_VOLUME", "QUIZ_MUSIC_UNLOCK"].map(constant).join("\n") +
    fn("quizMusicPref") + fn("quizMusicVolume") + fn("quizMusicGain") + fn("quizMusicParts") + fn("quizMusicWanted"), ctx);
  return ctx;
}

test("music starts off and is remembered once turned on", function() {
  assert.equal(context({}).quizMusicPref(), false);
  assert.equal(context({ "fc-quiz-music": "on" }).quizMusicPref(), true);
  assert.equal(context({ "fc-quiz-music": "off" }).quizMusicPref(), false);
});

test("the volume defaults to the middle and stays within 0-100", function() {
  assert.equal(context({}).quizMusicVolume(), 50);
  assert.equal(context({ "fc-quiz-music-volume": "80" }).quizMusicVolume(), 80);
  assert.equal(context({ "fc-quiz-music-volume": "400" }).quizMusicVolume(), 100);
  assert.equal(context({ "fc-quiz-music-volume": "-3" }).quizMusicVolume(), 0);
  assert.equal(context({ "fc-quiz-music-volume": "junk" }).quizMusicVolume(), 50);
  const c = context({});
  assert.equal(c.quizMusicGain(50, 1), 0.22);
  assert.equal(c.quizMusicGain(100, 1), 0.44);
  assert.equal(c.quizMusicGain(0, 1), 0);
  assert.ok(Math.abs(c.quizMusicGain(50, 0.3) - 0.066) < 1e-9, "a read term ducks it");
});

test("a streak adds parts: the beat alone, then the arpeggio at 3, then clap and pluck at 6", function() {
  const c = context({});
  const parts = (n) => Array.from(c.quizMusicParts(n)).sort().join(",");
  assert.equal(parts(0), "bass,hat,kick");
  assert.equal(parts(2), "bass,hat,kick");
  assert.equal(parts(3), "arp,bass,hat,kick");
  assert.equal(parts(6), "arp,bass,clap,hat,kick,pluck");
});

test("it plays only when on, on the quiz screen, visible, and not while the mic listens", function() {
  const w = context({}).quizMusicWanted;
  assert.equal(w(true, true, false, false), true);
  assert.equal(w(false, true, false, false), false);
  assert.equal(w(true, false, false, false), false, "leaving the quiz stops it");
  assert.equal(w(true, true, true, false), false, "a hidden tab stops it");
  assert.equal(w(true, true, false, true), false, "the microphone would hear it");
});

test("the controls, the M key and the hooks are wired", function() {
  for (const id of ["btn-quiz-music", "quiz-music-volume", "btn-quiz-music-reset"])
    assert.ok(html.includes('id="' + id + '"'), id);
  assert.ok(!html.includes('id="quiz-music-pop"'), "the volume lives in the settings menu, not its own popover");
  assert.match(app, /e\.key === "m" \|\| e\.key === "M"\) && !e\.ctrlKey[^\n]+toggleQuizMusic\(\)/);
  assert.match(fn("answerQuiz"), /quizMusicAnswer\(isCorrect\)/);
  assert.match(fn("speakWith"), /quizMusicDuck\(true\)[\s\S]+quizMusicDuck\(false\)/);
  assert.equal((fn("syncQuizVoice").match(/syncQuizMusic\(\)/g) || []).length, 2, "both exits of syncQuizVoice");
  assert.match(fn("toggleQuizVoice"), /syncQuizMusic\(\)/);
  // The slider holds the focus, and the screen's key handler skips keys typed into a control.
  assert.match(app, /\["quiz-settings-menu", "quiz-card-menu"\]\.forEach[\s\S]{0,200}"keydown"[\s\S]{0,200}"Escape"[\s\S]{0,200}closeAllDropdowns\(\)/);
  for (const k of ["quiz.musicOn", "quiz.musicOff", "quiz.musicVolume", "quiz.musicVolumeLabel", "quiz.musicReset"])
    assert.equal(app.split('"' + k + '":').length - 1, 2, k + " in both languages");
});
