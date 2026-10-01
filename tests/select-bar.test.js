const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "client", "index.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "..", "client", "app.js"), "utf8");

// Every bulk-selection bar has one layout: close, count and Select all in the head, the
// actions after, primary last. Two of them live in index.html and one is built in app.js.
function bars() {
  const fromHtml = [...html.matchAll(/<div id="(home|lesson)-select-bar" class="select-bar hidden">([\s\S]*?)\n  <\/div>/g)]
    .map(function(m) { return [m[1], m[2]]; });
  const card = app.match(/'<div class="select-bar">' \+([\s\S]*?)'<\/div>';/);
  assert.equal(fromHtml.length, 2, "expected the home and lesson select bars in index.html");
  assert.ok(card, "card select bar not found in app.js");
  return fromHtml.concat([["card", card[1]]]);
}

test("select bars put close, count and Select all in the head, actions after", function() {
  for (const [name, body] of bars()) {
    const head = body.indexOf("select-bar-head"), actions = body.indexOf("select-bar-actions");
    assert.ok(head >= 0 && actions > head, name + ": head must come before actions");
    const close = body.indexOf("select-bar-close"), count = body.indexOf("select-count"), all = body.indexOf("select-all-label");
    assert.ok(head < close && close < count && count < all && all < actions, name + ": head order is close, count, Select all");
    assert.match(body.slice(close, close + 400), /aria-label=/, name + ": icon-only close needs an aria-label");
  }
});

test("the primary action is the last button in each bar", function() {
  for (const [name, body] of bars()) {
    const buttons = [...body.slice(body.indexOf("select-bar-actions")).matchAll(/class="btn btn-sm (btn-[\w-]+)"/g)].map(function(m) { return m[1]; });
    assert.ok(buttons.length > 0, name + ": no actions");
    const primary = buttons.indexOf("btn-primary");
    if (primary >= 0) assert.equal(primary, buttons.length - 1, name + ": primary must be last");
  }
});
