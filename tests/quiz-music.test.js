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
  vm.runInContext(["QUIZ_MUSIC_BPM", "QUIZ_MUSIC_SLOW_BPM", "QUIZ_MUSIC_BPM_STEP", "QUIZ_MUSIC_RAMP_STEPS",
    "QUIZ_MUSIC_LEVEL", "QUIZ_MUSIC_DEFAULT_VOLUME", "QUIZ_MUSIC_ELEMENTS", "QUIZ_MUSIC_CHORDS", "QUIZ_MUSIC_KINDS"].map(constant).join("\n") +
    ["quizMusicPref", "quizMusicVolume", "quizMusicGain", "quizMusicWanted", "quizMusicSame", "quizMusicDraw",
     "quizMusicNewSong", "quizMusicSetTempo", "quizMusicKindNow", "quizMusicOnAnswer", "quizMusicApplyPending",
     "quizMusicGlide", "quizMusicScaleStep", "quizMusicLeadNote"].map(fn).join(""), ctx);
  return ctx;
}

// A repeatable stand-in for Math.random.
function seeded(seed) {
  let x = seed;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}
function rig(values) { let i = 0; return () => values[i++ % values.length]; }

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

test("a change comes after 3, 4 or 5 correct answers, drawn evenly", function() {
  const c = context({});
  assert.deepEqual([0, 0.34, 0.67, 0.999].map((v) => c.quizMusicDraw(() => v)), [3, 4, 5, 5]);
  const rand = seeded(7), seen = { 3: 0, 4: 0, 5: 0 };
  for (let i = 0; i < 3000; i++) seen[c.quizMusicDraw(rand)]++;
  for (const n of [3, 4, 5]) assert.ok(seen[n] > 850 && seen[n] < 1150, n + " drawn " + seen[n] + " of 3000");
});

test("the first four changes bring drums, bass, melody and chords in, then changes never stop", function() {
  const c = context({});
  const song = c.quizMusicNewSong(rig([0]));   // every draw is 3
  const changes = [];
  for (let i = 0; i < 300; i++) {
    const e = c.quizMusicOnAnswer(song, true, seeded(i + 1));
    if (e) { changes.push(e); c.quizMusicApplyPending(song, 0); }
  }
  assert.deepEqual(changes.slice(0, 4), ["drums", "bass", "lead", "harm"]);
  assert.ok(changes.length >= 60, "300 right answers in a row still change the music: " + changes.length);
  for (let i = 1; i < changes.length; i++) assert.notEqual(changes[i], changes[i - 1], "the same element twice in a row");
  for (const e of ["drums", "bass", "lead", "harm"]) {
    assert.ok(changes.slice(4).filter((x) => x === e).length > 5, e + " keeps changing after the first four");
    assert.ok(song.kind[e] > 0 && song.kind[e] < c.QUIZ_MUSIC_KINDS[e].length, e + " stays off its plain kind while the run lasts");
  }
  assert.equal(song.bpm, 128, "a run of right answers never speeds it up");
});

test("a change moves to another kind, and adding a kind needs nothing but the entry", function() {
  const c = context({});
  const song = c.quizMusicNewSong(rig([0]));
  for (const e of ["drums", "bass", "lead", "harm"]) song.kind[e] = 2;
  song.last = "harm";
  const picks = new Set();
  for (let i = 0; i < 400; i++) {
    song.toNext = 1; song.pending = {};
    const e = c.quizMusicOnAnswer(song, true, seeded(i + 3));
    assert.notEqual(song.pending[e], 2, "another kind, not the one playing");
    picks.add(e + song.pending[e]); song.last = "harm";
  }
  for (const e of ["drums", "bass", "lead"])
    for (let k = 1; k < c.QUIZ_MUSIC_KINDS[e].length; k++) if (k !== 2) assert.ok(picks.has(e + k), e + " kind " + k + " is reachable");
});

test("a wrong answer undoes the last change and slows down; right answers bring 128 back, never more", function() {
  const c = context({});
  const song = c.quizMusicNewSong(rig([0]));
  for (let i = 0; i < 6; i++) c.quizMusicOnAnswer(song, true, rig([0]));
  c.quizMusicApplyPending(song, 0);
  assert.deepEqual([song.kind.drums, song.kind.bass], [1, 1]);
  assert.equal(c.quizMusicOnAnswer(song, false, rig([0.5])), null);
  assert.equal(song.pending.bass, 0, "the element changed last goes back to plain");
  assert.equal(song.toNext, 4, "the count to the next change starts over");
  assert.equal(song.bpmTarget, 120);
  for (let i = 0; i < 64; i++) c.quizMusicGlide(song);
  assert.equal(song.bpm, 120, "glides down over two bars");
  const targets = [];
  for (let i = 0; i < 6; i++) { c.quizMusicOnAnswer(song, true, rig([0.5])); targets.push(song.bpmTarget); }
  assert.deepEqual(targets, [122, 124, 126, 128, 128, 128]);
  c.quizMusicApplyPending(song, 0);
  assert.ok(song.kind.bass > 0, "the next change first brings back what was undone");
  c.quizMusicOnAnswer(song, false, rig([0.5]));
  c.quizMusicOnAnswer(song, false, rig([0.5]));
  c.quizMusicApplyPending(song, 0);
  assert.deepEqual([song.kind.bass, song.kind.drums], [0, 0], "each wrong answer undoes one more change");
  assert.equal(c.quizMusicOnAnswer(song, false, rig([0.5])), null, "with nothing left to undo, only the tempo drops");
});

test("new chords wait for the phrase; other changes land on the next bar with a cymbal", function() {
  const c = context({});
  const song = c.quizMusicNewSong(rig([0]));
  song.pending = { harm: 2, bass: 3 };
  assert.equal(c.quizMusicApplyPending(song, 16), true);
  assert.deepEqual([song.kind.bass, song.kind.harm, "harm" in song.pending], [3, 0, true]);
  c.quizMusicApplyPending(song, 64 % 64);
  assert.equal(song.kind.harm, 2);
  song.pending = { lead: 0 };
  assert.equal(c.quizMusicApplyPending(song, 32), false, "going back to plain is not marked");
});

test("every kind is well formed, and every melody stays in C major in a singing range", function() {
  const c = context({}), K = c.QUIZ_MUSIC_KINDS;
  K.drums.forEach((d, i) => Object.keys(d).forEach((p) => {
    if (p !== "fill") assert.match(d[p], /^[xo.]{16}$/, "drums " + i + " " + p);
  }));
  K.bass.forEach((b, i) => b.forEach((n) => assert.ok(n[0] >= 0 && n[0] < 16 && [0, 7, 12].includes(n[1]), "bass " + i)));
  K.harm.forEach((h) => { assert.equal(h.length, 4); h.forEach((ch) => assert.ok(c.QUIZ_MUSIC_CHORDS[ch], ch)); });
  assert.equal(K.lead[0], null, "the plain song has no melody");
  const major = [0, 2, 4, 5, 7, 9, 11];
  K.lead.slice(1).forEach((lead, li) => K.harm.forEach((prog) => {
    const song = c.quizMusicNewSong(rig([0]));
    assert.equal(lead.length, 4, "lead " + (li + 1) + " has four bars");
    lead.forEach((bar, b) => bar.forEach((n) => {
      assert.ok(n[0] + n[2] <= 16, "lead " + (li + 1) + " note stays in its bar");
      const m = c.quizMusicLeadNote(song, n[1], c.QUIZ_MUSIC_CHORDS[prog[b]]);
      assert.ok(major.includes(m % 12), "lead " + (li + 1) + " over " + prog.join("-") + ": " + m);
      assert.ok(m >= 55 && m <= 76, "lead " + (li + 1) + " note " + m + " (about 200-660 Hz)");
    }));
  }));
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
  assert.match(fn("startQuiz"), /quizMusic\.song = null/, "each quiz starts from the plain song");
  assert.match(fn("quizMusicAnswer"), /quizMusicOnAnswer\(quizMusicSong\(\), correct, Math\.random\)/);
  assert.match(fn("speakWith"), /quizMusicDuck\(true\)[\s\S]+quizMusicDuck\(false\)/);
  assert.equal((fn("syncQuizVoice").match(/syncQuizMusic\(\)/g) || []).length, 2, "both exits of syncQuizVoice");
  assert.match(fn("toggleQuizVoice"), /syncQuizMusic\(\)/);
  // The slider holds the focus, and the screen's key handler skips keys typed into a control.
  assert.match(app, /\["quiz-settings-menu", "quiz-card-menu", "fc-card-menu"\]\.forEach[\s\S]{0,200}"keydown"[\s\S]{0,200}"Escape"[\s\S]{0,200}closeAllDropdowns\(\)/);
  for (const k of ["quiz.musicOn", "quiz.musicOff", "quiz.musicVolume", "quiz.musicVolumeLabel", "quiz.musicReset"])
    assert.equal(app.split('"' + k + '":').length - 1, 2, k + " in both languages");
});
