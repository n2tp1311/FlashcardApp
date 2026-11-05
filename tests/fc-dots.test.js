"use strict";
// The study screen's row of dots follows the current card past the first 40.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const appJs = fs.readFileSync(path.join(__dirname, "..", "client", "app.js"), "utf8");
function extract(name) {
  const start = appJs.indexOf("function " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return appJs.slice(start, appJs.indexOf("\n}\n", start) + 3);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(extract("fcDotWindow"), ctx);

test("a short session shows every card from the first", () => {
  assert.equal(ctx.fcDotWindow(25, 20, 40), 0);
});

test("a long session keeps the current card's dot in view", () => {
  for (const i of [0, 19, 40, 41, 65]) {
    const start = ctx.fcDotWindow(66, i, 40);
    assert.ok(start <= i && i < start + 40, "card " + i + " outside " + start);
    assert.ok(start >= 0 && start + 40 <= 66);
  }
  assert.equal(ctx.fcDotWindow(66, 41, 40), 21);
});

test("the row draws from the window, not from card 0", () => {
  assert.match(extract("renderFcDots"), /for \(var i = start; i < end; i\+\+\)/);
});
