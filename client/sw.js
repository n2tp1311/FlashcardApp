// Offline shell for the installed app. Network first for everything, so a deploy is picked
// up on the next load; the cache answers when the network does not, or has not within
// NETWORK_WAIT_MS. On a weak signal a request neither fails nor answers, and waiting on it
// left a white screen for as long as the phone held the connection open; the late answer
// still refreshes the cache, so the next launch has it. KaTeX is the one
// cache-first asset: versioned, large, and what turned every formula into raw "$\hat\beta$"
// on a weak signal while it came from a CDN. The API is never cached: writes already queue
// offline in the app, and a stale read would show progress that is not the server's.
var CACHE = "fc-shell-v1";
var NETWORK_WAIT_MS = 3000;
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
  var net = fetch(req).then(function(res) {
    if (res.ok && res.type === "basic") {
      var copy = res.clone();
      return caches.open(CACHE).then(function(c) { return c.put(key, copy); }).then(function() { return res; }, function() { return res; });
    }
    return res;
  });
  e.respondWith(new Promise(function(resolve) {
    var answered = false;
    function answer(res) { if (!answered) { answered = true; resolve(res); } }
    net.then(answer, function() {
      caches.match(key).then(function(hit) { answer(hit || Response.error()); });
    });
    // Too slow: the cached copy if there is one, otherwise keep waiting for the network.
    setTimeout(function() {
      caches.match(key).then(function(hit) { if (hit) answer(hit); });
    }, NETWORK_WAIT_MS);
  }));
  e.waitUntil(net.catch(function() {}));
});

// Study reminders (server/lib/reminders.js). The payload is { title, body, url }; the tag
// makes a new reminder replace an unread one rather than stack under it.
self.addEventListener("push", function(e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(self.registration.showNotification(data.title || "Flashcards", {
    body: data.body || "", icon: "/logo.svg", badge: "/logo.svg", tag: "study-reminder",
    data: { url: data.url || "/" }
  }));
});

// Tapping a reminder focuses the app if it is open, otherwise opens it.
self.addEventListener("notificationclick", function(e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list) {
    for (var i = 0; i < list.length; i++) {
      if (new URL(list[i].url).origin === self.location.origin && "focus" in list[i]) return list[i].focus();
    }
    return self.clients.openWindow(url);
  }));
});
