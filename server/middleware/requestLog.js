"use strict";

// Logs to stdout (captured by Railway) so a future incident leaves a trail instead
// of getting lost — the 2026-08-13 perf incident had no request-level evidence by
// the time we went looking, only Railway's aggregate response-time graph.
const SLOW_MS = 2000;

function requestLog(req, res, next) {
  const start = Date.now();
  let logged = false;

  function log() {
    if (logged) return;
    logged = true;
    const durationMs = Date.now() - start;
    const marker = !res.writableEnded ? "[ABORTED]" : durationMs > SLOW_MS ? "[SLOW]" : "[req]";
    // Route PATTERN, not the matched path — req.path (or req.originalUrl) would
    // include literal param values, and several routes carry secrets or capability
    // tokens in the path itself (password-reset/share/invite tokens), not just the
    // query string. req.route is populated by the time the request finishes, so
    // this logs "/api/share/view/:token" rather than the live token value.
    // No route matched (404, wrong method) means we don't know the pattern — do NOT
    // fall back to the raw path, since an unmatched request to a token-bearing URL
    // (e.g. a typo'd method against /api/share/view/<token>) would leak it just the
    // same as logging req.path always would have.
    const routePath = req.route ? req.baseUrl + req.route.path : "(unmatched)";
    console.log(`${marker} ${req.method} ${routePath} ${res.statusCode} ${durationMs}ms`);
  }

  // "close" fires on abort/timeout even when "finish" never does; guarded by the
  // `logged` flag above since close also fires after a normal finish. A process
  // killed by the watchdog mid-request can't log at all — nothing runs post-exit.
  res.on("finish", log);
  res.on("close", log);
  next();
}

module.exports = { requestLog };
