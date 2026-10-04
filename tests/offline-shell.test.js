const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const CLIENT = path.join(__dirname, "..", "client");
const read = function(f) { return fs.readFileSync(path.join(CLIENT, f), "utf8"); };

// From a CDN, KaTeX was what failed on a weak signal and left formulas as raw "$\hat\beta$".
test("KaTeX is served from the app, not a CDN", function() {
  const html = read("index.html");
  assert.doesNotMatch(html, /jsdelivr|unpkg|cdnjs/);
  assert.match(html, /\/vendor\/katex\/katex\.min\.js/);
  assert.match(html, /\/vendor\/katex\/katex\.min\.css/);
});

test("every font the vendored KaTeX CSS names exists", function() {
  const css = read("vendor/katex/katex.min.css");
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map(function(m) { return m[1].replace(/["']/g, ""); });
  assert.ok(urls.length > 0);
  urls.forEach(function(u) {
    assert.ok(/\.woff2$/.test(u), u);
    assert.ok(fs.existsSync(path.join(CLIENT, "vendor/katex", u)), u);
  });
});

function worker() {
  const handlers = {};
  const ctx = { self: { addEventListener: function(t, f) { handlers[t] = f; }, location: { origin: "https://app.test" } }, URL: URL };
  vm.runInNewContext(read("sw.js"), ctx);
  return { ctx: ctx, handlers: handlers };
}

test("every precached shell file exists", function() {
  const w = worker();
  const shell = vm.runInNewContext("SHELL", w.ctx);
  shell.filter(function(p) { return p !== "/"; }).forEach(function(p) {
    assert.ok(fs.existsSync(path.join(CLIENT, p)), p);
  });
});

test("the worker never answers API, auth or share requests", function() {
  const w = worker();
  const bypass = function(u, method) {
    return vm.runInNewContext("bypass", w.ctx)(new URL(u), { method: method || "GET" });
  };
  ["/api/classes", "/auth/google", "/uploads/a.png", "/share/abc", "/reset-password"].forEach(function(p) {
    assert.equal(bypass("https://app.test" + p), true, p);
  });
  assert.equal(bypass("https://app.test/app.js", "POST"), true);
  assert.equal(bypass("https://cdn.other/x.js"), true);
  assert.equal(bypass("https://app.test/app.js"), false);
  assert.equal(bypass("https://app.test/apiary.png"), false);
});

test("the app registers the worker only where browsers allow it", function() {
  const js = read("app.js");
  assert.match(js, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(js, /location\.protocol === "https:" \|\| location\.hostname === "localhost"/);
});
