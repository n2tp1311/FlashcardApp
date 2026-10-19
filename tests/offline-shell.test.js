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

// A fetch that never settles is what a weak signal looks like; waiting on it was a white
// screen. Run the worker's fetch handler with a fake clock, network and cache.
function fetchWith(network, cached) {
  const handlers = {};
  const timers = [];
  const stored = {};
  const ctx = {
    self: { addEventListener: function(t, f) { handlers[t] = f; }, location: { origin: "https://app.test" } },
    URL: URL, Promise: Promise,
    setTimeout: function(f, ms) { timers.push({ f: f, ms: ms }); },
    fetch: function() { return network; },
    caches: {
      match: function() { return Promise.resolve(cached); },
      open: function() { return Promise.resolve({ put: function(k, v) { stored.put = v; return Promise.resolve(); } }); }
    }
  };
  vm.runInNewContext(read("sw.js"), ctx);
  let answer, waited;
  handlers.fetch({
    request: { url: "https://app.test/app.js", method: "GET", mode: "no-cors" },
    respondWith: function(p) { answer = p; },
    waitUntil: function(p) { waited = p; }
  });
  return { answer: answer, waited: waited, timers: timers, stored: stored, wait: vm.runInNewContext("NETWORK_WAIT_MS", ctx) };
}
const tick = () => new Promise((r) => setImmediate(r));

test("a network that hangs is answered from the cache after a few seconds", async function() {
  const cached = { from: "cache" };
  const w = fetchWith(new Promise(function() {}), cached);
  let got = null;
  w.answer.then(function(r) { got = r; });
  await tick();
  assert.equal(got, null, "the network still gets its chance first");
  assert.ok(w.wait >= 2000 && w.wait <= 5000, String(w.wait));
  w.timers.forEach(function(t) { t.f(); });
  await tick(); await tick();
  assert.equal(got, cached);
});

test("a network that answers in time wins and refreshes the cache; with no cache the app waits", async function() {
  const fresh = { ok: true, type: "basic", clone: function() { return { copy: true }; } };
  const w = fetchWith(Promise.resolve(fresh), { from: "cache" });
  assert.equal(await w.answer, fresh);
  await w.waited;
  assert.deepEqual(w.stored.put, { copy: true });

  const slow = fetchWith(new Promise(function() {}), undefined);
  let got = null;
  slow.answer.then(function(r) { got = r; });
  slow.timers.forEach(function(t) { t.f(); });
  await tick(); await tick();
  assert.equal(got, null, "nothing cached: keep waiting rather than answer with an error");
});

// "online" alone left queued answers waiting: iOS seldom fires it, and a reopened app
// fires nothing.
test("queued answers are sent when the app comes back to the screen, and every minute", function() {
  const js = read("app.js");
  const block = js.slice(js.indexOf("if (IS_SERVER) {\n  window.addEventListener(\"online\", SQLiteAdapter.flushPending);"));
  const head = block.slice(0, block.indexOf("\n}\n"));
  assert.match(head, /visibilitychange[\s\S]*SQLiteAdapter\.flushPending\(\)/);
  assert.match(head, /setInterval\([\s\S]*flushPending\(\)[\s\S]*60000\)/);
});
