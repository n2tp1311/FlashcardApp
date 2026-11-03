const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "client", "app.js"), "utf8");
function extract(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}
function load() {
  const ctx = {
    t: function(k, v) { return k + (v ? "|" + Object.keys(v).map(function(x) { return x + "=" + v[x]; }).join(",") : ""); },
    escHtml: function(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
  };
  vm.createContext(ctx);
  vm.runInContext(["studyOrderEtas", "studyOrderEtaText"].map(extract).join(""), ctx);
  return ctx;
}
const D = 86400, NOW = 1000 * D;
const ETA = { pacePerDay: 10, masterDays: 20, classes: [
  { id: "a", total: 100, unmastered: 60, readyAt: null }, { id: "b", total: 50, unmastered: 50, readyAt: null },
  { id: "c", total: 30, unmastered: 5, readyAt: NOW + 3 * D }, { id: "d", total: 30, unmastered: 0, readyAt: null },
  { id: "e", total: 0, unmastered: 0, readyAt: null }, { id: "f", total: 9, unmastered: 2, readyAt: NOW - 4 * D }] };
const ORDER = [{ id: "a", available: 25 }, { id: "b", available: 50 }, { id: "c", available: 0 },
  { id: "d", available: 0 }, { id: "e", available: 0 }, { id: "f", available: 0 }];

test("a class is done when it and every class above it are, at the pace", () => {
  const e = load().studyOrderEtas(ORDER, ETA, NOW);
  assert.equal(e.a.doneAt, NOW + 2 * D);            // 3 days of 10, today the first
  assert.equal(e.b.doneAt, NOW + 7 * D);            // 75 cards: 8 days
  assert.equal(e.b.masteredAt, NOW + 27 * D);
  assert.equal(load().studyOrderEtas([{ id: "a", available: 4 }], ETA, NOW).a.doneAt, NOW, "within today's pace: today");
});

test("reordering moves the dates", () => {
  const e = load().studyOrderEtas([ORDER[1], ORDER[0]].concat(ORDER.slice(2)), ETA, NOW);
  assert.equal(e.b.doneAt, NOW + 4 * D);
  assert.equal(e.a.doneAt, NOW + 7 * D);
});

test("mastered no earlier than the learned cards can be", () => {
  const eta = JSON.parse(JSON.stringify(ETA));
  eta.classes[0].readyAt = NOW + 90 * D;
  assert.equal(load().studyOrderEtas(ORDER, eta, NOW).a.masteredAt, NOW + 90 * D);
});

test("Completed classes: a date, Mastered, or today when it is overdue; an empty class stays Completed", () => {
  const ctx = load(), e = ctx.studyOrderEtas(ORDER, ETA, NOW);
  assert.equal(e.c.masteredAt, NOW + 3 * D);
  assert.equal(e.d.mastered, true);
  assert.equal(e.e, undefined);
  assert.equal(e.f.masteredAt, NOW);
  const fmt = s => "@" + (s - NOW) / D;
  assert.equal(ctx.studyOrderEtaText(ORDER[3], e.d, fmt), "studyNow.mastered");
  assert.equal(ctx.studyOrderEtaText(ORDER[4], e.e, fmt), "studyNow.completed");
  assert.equal(ctx.studyOrderEtaText(ORDER[2], e.c, fmt), 'studyNow.completed<span class="sn-eta">studyNow.etaMastered|date=@3</span>');
  assert.equal(ctx.studyOrderEtaText(ORDER[0], e.a, fmt), 'studyNow.newLeft|n=25<span class="sn-eta">studyNow.etaDone|date=@2</span><span class="sn-eta">studyNow.etaMastered|date=@22</span>');
});

test("no pace or no answer from the server: the row reads as before", () => {
  const ctx = load();
  const e = ctx.studyOrderEtas(ORDER, Object.assign({}, ETA, { pacePerDay: 0 }), NOW);
  assert.equal(e.a, undefined);
  assert.equal(ctx.studyOrderEtaText(ORDER[0], e.a, String), "studyNow.newLeft|n=25");
  assert.deepEqual(Object.keys(ctx.studyOrderEtas(ORDER, null, NOW)), []);
});
