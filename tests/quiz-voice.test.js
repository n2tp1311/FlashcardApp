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

const pure = vm.createContext({});
vm.runInContext(fn("voiceCommand") + fn("quizVoiceHint"), pure);
const cmd = (s, n, tf) => JSON.parse(JSON.stringify(pure.voiceCommand(s, n == null ? 4 : n, !!tf)));

test("a letter, a number or its word answers, in English and Vietnamese", function() {
  const cases = {
    "B": 1, "bee": 1, "be": 1, "Option C.": 2, "answer 2": 1, "số hai": 1, "câu bê": 1,
    "đáp án một": 0, "một": 0, "bốn": 3, "4": 3, "a": 0, "đáp án a": 0, "xê": 2, "đê": 3,
    "three": 2, ["Bốn".normalize("NFD")]: 3,
  };
  for (const [said, idx] of Object.entries(cases)) assert.deepEqual(cmd(said), { answer: idx }, said);
  assert.deepEqual(cmd("năm", 5), { answer: 4 });
  assert.deepEqual(cmd("E", 5), { answer: 4 });
});

test("an answer past the options shown answers nothing", function() {
  assert.equal(cmd("4", 3), null);
  assert.equal(cmd("năm", 4), null);
  assert.equal(cmd("c", 2, true), null);
  // The true/false hint offers no letters.
  assert.equal(cmd("b", 2, true), null);
  assert.equal(cmd("bee", 2, true), null);
});

test("Chrome's spellings of a lone number count", function() {
  assert.deepEqual(cmd("to"), { answer: 1 });
  assert.deepEqual(cmd("too"), { answer: 1 });
  assert.deepEqual(cmd("for"), { answer: 3 });
  assert.deepEqual(cmd("won"), { answer: 0 });
});

test("true/false takes đúng/sai and true/false, and only on a true/false card", function() {
  assert.deepEqual(cmd("đúng", 2, true), { answer: 0 });
  assert.deepEqual(cmd("sai", 2, true), { answer: 1 });
  assert.deepEqual(cmd("True", 2, true), { answer: 0 });
  assert.deepEqual(cmd("False", 2, true), { answer: 1 });
  assert.deepEqual(cmd("2", 2, true), { answer: 1 });
  assert.equal(cmd("đúng"), null);
  assert.equal(cmd("không đúng", 2, true), null);
});

test("next and stop are commands; a bare dừng on a true/false card is not", function() {
  for (const s of ["next", "Next question", "tiếp", "tiếp theo", "câu tiếp theo"]) assert.deepEqual(cmd(s), { cmd: "next" }, s);
  for (const s of ["stop", "dừng", "dừng lại"]) assert.deepEqual(cmd(s), { cmd: "stop" }, s);
  // "dừng" misheard as "đúng" would answer True for good.
  assert.equal(cmd("dừng", 2, true), null);
  assert.deepEqual(cmd("dừng lại", 2, true), { cmd: "stop" });
});

test("anything else is not guessed at", function() {
  for (const s of ["", "the cat", "b c", "two three", "a b", "constructor", "to be"]) assert.equal(cmd(s), null, s);
});

test("the hint follows the number of options", function() {
  assert.deepEqual(JSON.parse(JSON.stringify(pure.quizVoiceHint(4))), { nums: "1–4", letters: "A–D" });
  assert.deepEqual(JSON.parse(JSON.stringify(pure.quizVoiceHint(3))), { nums: "1–3", letters: "A–C" });
  assert.deepEqual(JSON.parse(JSON.stringify(pure.quizVoiceHint(1))), { nums: "1", letters: "A" });
});

test("the setting is per device and off unless chosen", function() {
  const run = (store, throws) => {
    const ctx = { localStorage: { getItem: function(k) { if (throws) throw new Error("blocked"); return store[k] || null; } } };
    vm.createContext(ctx);
    vm.runInContext(fn("quizVoiceOn"), ctx);
    return ctx.quizVoiceOn();
  };
  assert.equal(run({ "fc-quiz-voice": "1" }), true);
  assert.equal(run({ "fc-quiz-voice": "0" }), false);
  assert.equal(run({}), false);
  assert.equal(run({}, true), false);
});

function resultHarness(over) {
  const answered = [];
  const statuses = [];
  let clicked = 0;
  const ctx = Object.assign({
    quizVoice: { active: true, ttsUntil: 0 },
    QUIZ_VOICE_SETTLE_MS: 600,
    state: { quizCards: [{ format: "mcq" }], quizIndex: 0, quizOptions: ["w", "x", "y", "z"], quizAnswered: false, quizCardShownAt: 0 },
    document: { hidden: false, getElementById: function(id) { return id === "quiz-next-btn" ? { click: function() { clicked++; } } : null; } },
    window: {},
    Date: Date,
    String: String,
    armQuizVoiceIdle: function() {},
    quizVoiceOnScreen: function() { return true; },
    fcAnyOverlayOpen: function() { return false; },
    answerQuiz: function(i) { answered.push(i); },
    setQuizVoiceStatus: function(k, p) { statuses.push([k, p && p.text]); },
    voiceCommand: pure.voiceCommand,
  }, over || {});
  vm.createContext(ctx);
  vm.runInContext(fn("onQuizVoiceResult"), ctx);
  const say = (...alts) => {
    const r = alts.map(t => ({ transcript: t }));
    r.isFinal = true;
    ctx.onQuizVoiceResult({ resultIndex: 0, results: [r] });
  };
  return { ctx, say, answered, statuses, clicks: () => clicked };
}

test("a heard answer answers the card, from the best guess only", function() {
  let h = resultHarness();
  h.say("bê");
  assert.deepEqual(h.answered, [1]);
  assert.deepEqual(h.statuses[0], ["heard", "bê"]);
  // A second-best "đúng" under a said "dừng" must not answer True.
  h = resultHarness();
  h.ctx.state.quizCards = [{ format: "true-false" }];
  h.ctx.state.quizOptions = ["True", "False"];
  h.say("dừng", "đúng");
  assert.deepEqual(h.answered, []);
  assert.match(fn("startQuizVoice"), /rec\.maxAlternatives = 1;/);
});

test("nothing is answered on an answered card, under a modal, while speaking or just after a card appears", function() {
  let h = resultHarness();
  h.ctx.state.quizAnswered = true;
  h.say("2");
  assert.deepEqual(h.answered, []);

  h = resultHarness({ fcAnyOverlayOpen: function() { return true; } });
  h.say("2");
  assert.deepEqual(h.answered, []);

  h = resultHarness({ window: { speechSynthesis: { speaking: true } } });
  h.say("2");
  assert.deepEqual(h.answered, []);

  h = resultHarness();
  h.ctx.quizVoice.ttsUntil = Date.now() + 5000;
  h.say("2");
  assert.deepEqual(h.answered, []);

  h = resultHarness();
  h.ctx.state.quizCardShownAt = Date.now();
  h.say("2");
  assert.deepEqual(h.answered, []);
});

test("unclear speech says so and answers nothing; next presses Next", function() {
  let h = resultHarness();
  h.say("banana");
  assert.deepEqual(h.answered, []);
  assert.deepEqual(h.statuses, [["missed", "banana"]]);

  h = resultHarness();
  h.ctx.state.quizAnswered = true;
  h.say("tiếp");
  assert.equal(h.clicks(), 1);
});

test("the quiz has the button, the status line and the V key, in both languages", function() {
  assert.match(html, /id="btn-quiz-voice"/);
  assert.match(html, /id="quiz-voice-status"[^>]*aria-live="polite"/);
  assert.match(html, /<kbd class="kbd">V<\/kbd><span data-i18n="keymap\.quizVoice">/);
  assert.match(app, /e\.key === "v" \|\| e\.key === "V"\) && !e\.ctrlKey && !e\.metaKey && !e\.altKey && !e\.repeat\) \{ e\.preventDefault\(\); toggleQuizVoice\(\); \}/);
  for (const k of ["quiz.voiceOn", "quiz.voiceOff", "quiz.voiceListening", "quiz.voiceListeningTf", "quiz.voiceHeard",
    "quiz.voiceMissed", "quiz.voiceSayNext", "quiz.voicePaused", "quiz.voiceResume", "quiz.voiceBlocked",
    "quiz.voiceBlockedSub", "quiz.voiceUnavailable", "keymap.quizVoice"]) {
    assert.equal((app.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k);
  }
});

test("listening follows the screen, the language and the page being visible", function() {
  assert.match(fn("showScreen"), /syncQuizVoice\(\);/);
  assert.match(fn("applyLanguage"), /syncQuizVoice\(\);/);
  assert.match(app, /document\.addEventListener\("visibilitychange", syncQuizVoice\);/);
  // showScreen runs before the voice state exists.
  assert.match(fn("syncQuizVoice"), /if \(!quizVoice\) return;/);
  assert.match(fn("renderQuizCard"), /\.quiz-voice-next/);
  // A language change restarts once the aborted session has ended.
  assert.match(fn("syncQuizVoice"), /setTimeout\(syncQuizVoice, 300\)/);
  // Restarts after the first are not taps: a refusal then means tap to resume, not blocked.
  assert.match(fn("startQuizVoice"), /quizVoice\.fromGesture = false;/);
  assert.match(fn("speakQuizTerm"), /Math\.min\(6000,/);
  assert.match(html, /id="btn-quiz-voice"[^>]*data-i18n-title="quiz\.voiceOn"/);
});
