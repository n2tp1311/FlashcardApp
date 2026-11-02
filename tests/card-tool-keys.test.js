const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");

function load(buttons) {
  const start = app.indexOf("\nvar CARD_TOOL_KEYS");
  assert.ok(start >= 0, "missing CARD_TOOL_KEYS");
  const end = app.indexOf("\n}\n", app.indexOf("function cardToolKey(", start)) + 3;
  const ctx = { document: { getElementById: id => buttons[id] || null } };
  vm.createContext(ctx);
  vm.runInContext(app.slice(start, end), ctx);
  return ctx;
}

function button(hidden) {
  return { disabled: false, clicks: 0, classList: { contains: c => c === "hidden" && hidden },
           click() { this.clicks++; } };
}

const key = (k, extra) => Object.assign({ key: k, ctrlKey: false, metaKey: false, altKey: false, repeat: false }, extra);

test("E, F and D press Edit, Flag and Delete on the screen in view", function() {
  const b = { "btn-fc-edit-card": button(), "btn-fc-flag-card": button(), "btn-fc-delete-card": button(),
              "btn-quiz-edit-card": button(), "btn-quiz-flag-card": button(), "btn-quiz-delete-card": button() };
  const ctx = load(b);
  assert.equal(ctx.cardToolKey(key("e"), "flashcard"), true);
  assert.equal(ctx.cardToolKey(key("F"), "flashcard"), true);
  assert.equal(ctx.cardToolKey(key("d"), "quiz"), true);
  assert.deepEqual(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.clicks])), {
    "btn-fc-edit-card": 1, "btn-fc-flag-card": 1, "btn-fc-delete-card": 0,
    "btn-quiz-edit-card": 0, "btn-quiz-flag-card": 0, "btn-quiz-delete-card": 1 });
});

test("a hidden flag, a modifier or a held key does nothing", function() {
  const b = { "btn-fc-flag-card": button(true), "btn-fc-delete-card": button() };
  const ctx = load(b);
  assert.equal(ctx.cardToolKey(key("f"), "flashcard"), false);
  assert.equal(ctx.cardToolKey(key("d", { metaKey: true }), "flashcard"), false);
  assert.equal(ctx.cardToolKey(key("d", { repeat: true }), "flashcard"), false);
  assert.equal(ctx.cardToolKey(key("x"), "flashcard"), false);
  assert.equal(b["btn-fc-flag-card"].clicks + b["btn-fc-delete-card"].clicks, 0);
});

test("both study screens bind the keys and list them in the keymap", function() {
  assert.match(app, /cardToolKey\(e, "flashcard"\)\) e\.preventDefault\(\)/);
  assert.match(app, /cardToolKey\(e, "quiz"\)\) e\.preventDefault\(\)/);
  for (const [k, label] of [["E", "study.editCard"], ["F", "flag.button"], ["D", "study.deleteCard"]])
    assert.equal(html.split(`<kbd class="kbd">${k}</kbd><span data-i18n="${label}">`).length - 1, 2);
});
