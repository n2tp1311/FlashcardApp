const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "client", "app.js"), "utf8");

// Pull the two pure functions out of app.js by their structural boundary (top-level
// "function name(" up to the next top-level line), so the test runs the shipped code.
function extract(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  const end = app.indexOf("\n}\n", start);
  return app.slice(start, end + 3);
}

function load(maxReviewsPerDay) {
  const ctx = { state: { maxReviewsPerDay: maxReviewsPerDay } };
  vm.createContext(ctx);
  vm.runInContext(extract("applyReviewCap") + extract("filterCardsBySetup"), ctx);
  return ctx.filterCardsBySetup;
}

const past = Math.floor(Date.now() / 1000) - 60;
const cards = [{ id: "a", srs_due_at: past }, { id: "b", srs_due_at: past - 10 }, { id: "c", srs_due_at: null }];

test("Due Only is capped by the reviews left today", function() {
  const filter = load(1);
  assert.deepEqual(filter(cards, "due", {}, {}, 0).map(function(c) { return c.id; }), ["b"]);
  assert.equal(filter(cards, "due", {}, {}, 1).length, 0);
});

// Study Setup uses the uncapped count to explain an empty result as the cap, not the filter.
test("ignoreCap returns every due card even when today's limit is used up", function() {
  const filter = load(1);
  assert.equal(filter(cards, "due", {}, {}, 5, true).length, 2);
});

test("no limit set means no cap", function() {
  assert.equal(load(null)(cards, "due", {}, {}, 99).length, 2);
});

test("both languages explain the cap", function() {
  assert.equal((app.match(/"setup\.reviewCapReached":/g) || []).length, 2);
});
