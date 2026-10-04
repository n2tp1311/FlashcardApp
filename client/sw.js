// Offline shell for the installed app. Network first for everything, so a deploy is picked
// up on the next load; the cache only answers when the network does not. KaTeX is the one
// cache-first asset: versioned, large, and what turned every formula into raw "$\hat\beta$"
// on a weak signal while it came from a CDN. The API is never cached: writes already queue
// offline in the app, and a stale read would show progress that is not the server's.
var CACHE = "fc-shell-v1";
var SHELL = ["/", "/app.js", "/style.css", "/vocabulary-term.js", "/logo.svg", "/manifest.json",
  "/vendor/katex/katex.min.js", "/vendor/katex/katex.min.css"];

self.addEventListener("install", function(e) {
  e.waitUntil(caches.open(CACHE).then(function(c) { return c.addAll(SHELL); }).catch(function() {}));
  self.skipWaiting();
});

self.addEventListener("activate", function(e) {
  e.waitUntil(caches.keys().then(function(keys) {
    return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
  }).then(function() { return self.clients.claim(); }));
});

function bypass(url, req) {
  return req.method !== "GET" || url.origin !== self.location.origin ||
    /^\/(api|auth|uploads|share|reset-password)(\/|$)/.test(url.pathname);
}

self.addEventListener("fetch", function(e) {
  var req = e.request;
  var url = new URL(req.url);
  if (bypass(url, req)) return;
  if (url.pathname.indexOf("/vendor/") === 0) {
    e.respondWith(caches.match(req).then(function(hit) {
      return hit || fetch(req).then(function(res) {
        if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function(c) { c.put(req, copy); }); }
        return res;
      });
    }));
    return;
  }
  // Navigations all store under "/": the app is one page whatever the path.
  var key = req.mode === "navigate" ? "/" : req;
  e.respondWith(fetch(req).then(function(res) {
    if (res.ok && res.type === "basic") { var copy = res.clone(); caches.open(CACHE).then(function(c) { c.put(key, copy); }); }
    return res;
  }).catch(function() {
    return caches.match(key).then(function(hit) { return hit || Response.error(); });
  }));
});
