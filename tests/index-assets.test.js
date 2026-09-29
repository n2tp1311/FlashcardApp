const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

// index.html is also served at /share/:token, where a relative "app.js" resolves to
// /share/app.js — which that route answers with index.html itself.
test("index.html references local assets by absolute path", function() {
  const html = fs.readFileSync(path.join(__dirname, "..", "client", "index.html"), "utf8");
  const refs = [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map(function(m) { return m[1]; });
  const relative = refs.filter(function(ref) {
    return ref && !/^(https?:|data:|#|\/)/.test(ref);
  });
  assert.deepEqual(relative, []);
});
