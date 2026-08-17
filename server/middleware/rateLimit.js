"use strict";

// In-memory only — this app is architecturally single-process (node-sqlite3-wasm
// loads one DB file into one process's memory, see server/db.js), so there's no
// multi-instance state-sharing concern a Redis-backed limiter would exist to solve.
//
// keyFn defaults to req.ip — the only option pre-auth (login/register/forgot-
// password, where there's no session yet). Routes that sit behind requireAuth
// should pass `keyFn: req => req.session.userId` instead: IP-keying an authenticated
// route means unrelated users sharing one IP (office/campus/dorm NAT, a VPN egress)
// share one quota and can 429 each other for a stranger's usage.
function rateLimit({ windowMs, max, message, keyFn }) {
  const getKey = keyFn || (req => req.ip);
  const hits = new Map(); // key -> timestamps[]

  // Without this, every distinct IP that ever hits the route leaves a permanent
  // entry (only its timestamp array gets pruned, never the key itself) — on a
  // long-lived process this grows without bound, especially under bot traffic.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    hits.forEach((timestamps, key) => {
      const kept = timestamps.filter(t => t > cutoff);
      if (kept.length === 0) hits.delete(key);
      else hits.set(key, kept);
    });
  }, Math.max(windowMs, 60000));
  sweep.unref();

  return function(req, res, next) {
    const key = getKey(req);
    const now = Date.now();
    const windowStart = now - windowMs;
    const timestamps = (hits.get(key) || []).filter(t => t > windowStart);
    if (timestamps.length >= max) {
      return res.status(429).json({ error: message || "Too many requests, try again later" });
    }
    timestamps.push(now);
    hits.set(key, timestamps);
    next();
  };
}

// Shared keyFn for routes behind requireAuth — kept here (not redefined per route
// file) so a future change to the session shape only needs updating in one place.
const byUser = req => req.session.userId;

module.exports = { rateLimit, byUser };
