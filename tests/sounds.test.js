const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "client", "app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "client", "index.html"), "utf8");
const start = app.indexOf("var soundCtx = null;");
const end = app.indexOf("function relativeTime(");
assert.ok(start > 0 && end > start, "answer-sound block not found in app.js");
const block = app.slice(start, end);

function sandbox(opts) {
  opts = opts || {};
  const log = { oscillators: [], resumed: 0 };
  function param() { return { setValueAtTime() {}, exponentialRampToValueAtTime() {} }; }
  function FakeCtx() {
    if (opts.throwOnCreate) throw new Error("no audio");
    this.currentTime = 0;
    this.state = "suspended";
    this.destination = {};
  }
  FakeCtx.prototype.resume = function() { log.resumed++; return Promise.resolve(); };
  FakeCtx.prototype.createGain = function() { return { gain: param(), connect() {} }; };
  FakeCtx.prototype.createOscillator = function() {
    const o = { frequency: param(), connect() {}, start() {}, stop() {} };
    o.frequency.setValueAtTime = function(f) { log.oscillators.push(f); };
    return o;
  };
  const ctx = {
    window: { AudioContext: opts.noAudio ? undefined : FakeCtx },
    navigator: { audioSession: { type: "auto" } },
    state: { sounds: opts.sounds !== false }
  };
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  return { ctx, log };
}

test("correct plays two mallet strikes, wrong plays one knock", function() {
  const s = sandbox();
  s.ctx.playSound("correct");
  assert.deepEqual(s.log.oscillators, [523.25, 2093, 659.25, 2637]);
  s.log.oscillators.length = 0;
  s.ctx.playSound("wrong");
  assert.deepEqual(s.log.oscillators, [196, 784]);
  assert.equal(s.ctx.navigator.audioSession.type, "ambient", "must follow the iPhone silent switch");
  assert.ok(s.log.resumed > 0, "a suspended context must be resumed");
});

test("sounds off, no Web Audio, or a failing context all stay silent without throwing", function() {
  const off = sandbox({ sounds: false });
  off.ctx.playSound("correct");
  assert.equal(off.log.oscillators.length, 0);
  sandbox({ noAudio: true }).ctx.playSound("wrong");
  sandbox({ throwOnCreate: true }).ctx.playSound("correct");
});

test("only checked answers play a sound; self-grades stay silent", function() {
  const quiz = app.slice(app.indexOf("function answerQuiz("), app.indexOf("function answerQuiz(") + 1200);
  assert.match(quiz, /playSound\(cheer\.tone === "combo" \? "combo" : isCorrect \? "correct" : "wrong", state\.quizStreak - 1\)/);
  const retype = app.slice(app.indexOf("function submitForcedRetype("), app.indexOf("function confirmLatexRetype("));
  assert.match(retype, /playSound\("correct"\)/);
  assert.match(retype, /playSound\("wrong"\)/);
  const mark = app.slice(app.indexOf("function markCard("), app.indexOf("function markCard(") + 3000);
  assert.ok(!mark.includes("playSound("), "flashcard self-grades must not play answer sounds");
});

test("Sound effects is a saved preference, on by default", function() {
  assert.ok(html.includes('id="pref-sounds"'));
  assert.match(app, /haptics: true,\n  sounds: true,/);
  assert.match(app, /haptics: haptics, sounds: sounds,/);
  assert.equal(app.split('"pref.sounds"').length - 1, 2, "needs English and Vietnamese");
});

test("a run of right answers climbs a whole tone per step, capped at six", function() {
  const s = sandbox();
  s.ctx.playSound("correct", 1);
  assert.ok(Math.abs(s.log.oscillators[0] - 523.25 * Math.pow(2, 2 / 12)) < 1e-9);
  s.log.oscillators.length = 0;
  s.ctx.playSound("correct", 40);
  assert.ok(Math.abs(s.log.oscillators[0] - 523.25 * 2) < 1e-9, "capped at six whole tones");
  s.log.oscillators.length = 0;
  s.ctx.playSound("combo");
  assert.deepEqual(s.log.oscillators.filter((_, i) => i % 2 === 0), [523.25, 659.25, 783.99, 1046.5]);
});
