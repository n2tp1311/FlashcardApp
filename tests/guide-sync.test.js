"use strict";
// docs/GUIDE.md is studied as a class (KnowledgeApp refreshes it nightly from the committed
// guide), so a feature the guide does not describe is a lesson that teaches the old app.
// These read git history: every feature change since the guide existed must reach it.
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

let commits = null;
try {
  const first = git(["log", "--diff-filter=A", "--format=%H", "--", "docs/GUIDE.md"]).trim().split("\n").pop();
  if (first) {
    // Oldest first: hash, subject+body, then the files it touched.
    const out = git(["log", "--reverse", "--format=%x00%H%x01%B%x01", "--name-only", first + "^..HEAD"]);
    commits = out.split("\0").filter(Boolean).map(function(chunk) {
      const parts = chunk.split("\x01");
      return { hash: parts[0].slice(0, 7), message: parts[1], files: parts[2].split("\n").filter(Boolean) };
    });
  }
} catch (e) {
  commits = null;
}
const skip = commits ? false : "no git history with docs/GUIDE.md";

function touchesGuide(c) { return c.files.indexOf("docs/GUIDE.md") !== -1; }

// Commits still waiting for the guide: those after the latest guide commit. A forgotten
// update is repaired by a later guide commit, not by rewriting pushed history.
function waiting(needsGuide) {
  let pending = [];
  commits.forEach(function(c) {
    if (needsGuide(c)) pending.push(c.hash);
    if (touchesGuide(c)) pending = [];
  });
  return pending;
}

test("a docs commit that records a feature also updates the guide", { skip }, function() {
  assert.deepStrictEqual(waiting(function(c) {
    return c.files.some(function(f) { return f === "docs/features.md" || f === "docs/decisions.md"; });
  }), [], "update docs/GUIDE.md along with features.md / decisions.md");
});

test("every code change is followed by a guide update, or says the guide is unchanged", { skip }, function() {
  assert.deepStrictEqual(waiting(function(c) {
    return c.files.some(function(f) { return /^(client|server)\//.test(f); })
      && !/^Guide: unchanged/m.test(c.message);
  }), [], "describe the change in docs/GUIDE.md, or add a 'Guide: unchanged' line to a commit " +
    "that changes nothing the guide describes (a refactor)");
});
