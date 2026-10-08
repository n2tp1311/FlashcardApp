"use strict";

// Study reminders (lib/reminders.js). The settings -- on, time, streak nudge -- are saved
// with the other preferences; this route manages the devices that receive them, and the
// public key a browser needs to subscribe.

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const rem = require("../lib/reminders");
const router = express.Router();

function pusherOrNull() {
  try { return rem.webPush(db); } catch (e) { console.error("[reminders] push unavailable:", e.message); return null; }
}

function setTz(userId, tz) {
  const row = db.prepare("SELECT preferences FROM users WHERE id = ?").get(userId);
  let prefs = {};
  try { prefs = JSON.parse((row && row.preferences) || "{}"); } catch (_) {}
  prefs.reminderTz = rem.normalizeTz(tz);
  db.prepare("UPDATE users SET preferences = ? WHERE id = ?").run(JSON.stringify(prefs), userId);
}

// GET /api/reminders
router.get("/", requireAuth, (req, res) => {
  const p = pusherOrNull();
  const devices = db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?").get(req.session.userId).n;
  res.json({ available: !!p, publicKey: p ? p.publicKey : null, devices });
});

// POST /api/reminders/subscribe { subscription: PushSubscription JSON, tz: getTimezoneOffset() }
router.post("/subscribe", requireAuth, (req, res) => {
  const sub = req.body && req.body.subscription;
  const keys = sub && sub.keys;
  if (!sub || !rem.validEndpoint(sub.endpoint) || !keys ||
      typeof keys.p256dh !== "string" || typeof keys.auth !== "string" ||
      keys.p256dh.length > 200 || keys.auth.length > 100)
    return res.status(400).json({ error: "Invalid subscription" });
  const userId = req.session.userId;
  // A browser has one subscription per site: if another account on it had it, it is now ours.
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(sub.endpoint);
  db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)")
    .run(userId, sub.endpoint, keys.p256dh, keys.auth);
  setTz(userId, req.body.tz);
  res.json({ ok: true });
});

// POST /api/reminders/unsubscribe { endpoint }
router.post("/unsubscribe", requireAuth, (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (typeof endpoint !== "string") return res.status(400).json({ error: "endpoint required" });
  db.prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?").run(req.session.userId, endpoint);
  res.json({ ok: true });
});

// POST /api/reminders/test -- one sample reminder to this user's devices.
const lastTest = new Map();
router.post("/test", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const now = Date.now();
  if (now - (lastTest.get(userId) || 0) < 10000) return res.status(429).json({ error: "Wait a moment" });
  lastTest.set(userId, now);
  const p = pusherOrNull();
  if (!p) return res.status(503).json({ error: "Reminders are not available" });
  const row = db.prepare("SELECT preferences FROM users WHERE id = ?").get(userId);
  let prefs = {};
  try { prefs = JSON.parse((row && row.preferences) || "{}"); } catch (_) {}
  const sent = await rem.sendToUser(db, userId, rem.message("test", rem.settingsFrom(prefs)), p.send);
  res.json({ sent });
});

module.exports = router;
