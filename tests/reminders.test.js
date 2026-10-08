"use strict";
// Study reminders: the daily reminder comes at the chosen local time only on a day with cards
// due and nothing studied, the evening streak nudge only when the streak would end, each at
// most once a day; devices are registered only with real push services.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");
const express = require("express");

const root = path.join(__dirname, "..");
const R = require(path.join(root, "server/lib/reminders.js"));
const at = (h, m, d = 8) => Math.floor(Date.UTC(2026, 9, d, h, m) / 1000);
const VN = -420, NY = 240; // getTimezoneOffset(): UTC+7, UTC-4

test("the daily reminder's window is the hour after the chosen local time", function() {
  const s = R.settingsFrom({ reminders: { on: true, time: "20:00" }, reminderTz: VN });
  assert.equal(R.dailyKey(at(12, 59), s), null);
  assert.equal(R.dailyKey(at(13, 0), s), "2026-10-08", "20:00 in Vietnam is 13:00 UTC");
  assert.equal(R.dailyKey(at(13, 59), s), "2026-10-08");
  assert.equal(R.dailyKey(at(14, 0), s), null);
  const ny = R.settingsFrom({ reminders: { on: true, time: "20:00" }, reminderTz: NY });
  assert.equal(R.dailyKey(at(0, 30, 9), ny), "2026-10-08", "20:30 on the 8th in New York is the 9th in UTC");
  assert.equal(R.settingsFrom({ reminders: { time: "25:00" } }).minutes, R.DEFAULT_TIME);
  assert.equal(R.settingsFrom({}).on, false, "off until turned on");
});

test("the streak nudge goes at 9 PM local, but never later than 22:00 UTC", function() {
  const vn = R.settingsFrom({ reminders: { on: true }, reminderTz: VN });
  assert.equal(R.streakKey(at(13, 59), vn), null);
  assert.equal(R.streakKey(at(14, 0), vn), "2026-10-08", "9 PM in Vietnam");
  const ny = R.settingsFrom({ reminders: { on: true }, reminderTz: NY });
  assert.equal(R.streakKey(at(22, 0), ny), "2026-10-08", "6 PM in New York: the streak's day ends at 8 PM there");
  assert.equal(R.streakKey(at(1, 0, 9), ny), null, "9 PM in New York is already the next streak day");
});

test("only real push services are accepted as endpoints", function() {
  for (const ok of ["https://fcm.googleapis.com/fcm/send/abc", "https://web.push.apple.com/QH", "https://updates.push.services.mozilla.com/wpush/v2/x",
                    "https://wns2-par02p.notify.windows.com/w/?token=x"])
    assert.equal(R.validEndpoint(ok), true, ok);
  for (const bad of ["http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://169.254.169.254/latest", "https://evil.com/fcm.googleapis.com",
                     "https://fcm.googleapis.com.evil.com/x", "https://push.apple.com.evil.com/", "notaurl", null, "https://fcm.googleapis.com/" + "x".repeat(1000)])
    assert.equal(R.validEndpoint(bad), false, String(bad).slice(0, 60));
});

test("messages are in the user's language and name no hour", function() {
  const en = R.message("streak", R.settingsFrom({}), { streak: 14, due: 5 });
  assert.equal(en.body, "Study today to keep your 14-day streak. 5 cards are ready.");
  assert.doesNotMatch(en.body, /midnight|\d:\d\d/);
  const vi = R.message("daily", R.settingsFrom({ language: "vi" }), { due: 12, minutes: 4 });
  assert.equal(vi.body, "12 thẻ đang chờ ôn. Khoảng 4 phút.");
  assert.equal(R.message("daily", R.settingsFrom({}), { due: 1, minutes: null }).body, "1 card is ready to review.");
});

// --- The scheduler and routes, on the real schema in memory ---
const dbFile = path.join(root, "server", "db.js");
const realLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent && parent.filename === dbFile) {
    if (request === "node-sqlite3-wasm") {
      const { Database } = realLoad.call(this, request, parent, isMain);
      return { Database: class extends Database { constructor() { super(); } } };
    }
    if (request === "fs") return { ...fs, rmSync() {}, mkdirSync() {}, existsSync: () => true };
  }
  return realLoad.call(this, request, parent, isMain);
};
const db = require(dbFile);
Module._load = realLoad;
const authFile = require.resolve(path.join(root, "server/middleware/auth.js"));
require.cache[authFile] = { id: authFile, filename: authFile, loaded: true,
  exports: { requireAuth(req, res, next) { req.session = { userId: req.get("x-user") }; next(); } } };

const sent = [];
let failWith = null;
function push(sub, payload) {
  if (failWith) { const e = new Error("gone"); e.statusCode = failWith; return Promise.reject(e); }
  sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) });
  return Promise.resolve();
}
R.setPusher({ publicKey: "BPUBLIC", send: push });

const server = express();
server.use(express.json());
server.use("/api/reminders", require(path.join(root, "server/routes/reminders.js")));
let base, listener;
test.before(() => new Promise((ok) => { listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); }); }));
test.after(() => listener.close());

function call(method, url, user, body) {
  return fetch(base + url, { method, headers: { "content-type": "application/json", "x-user": user }, body: body && JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
}

const prefs = (extra) => JSON.stringify({ reminders: { on: true, time: "20:00", streak: true }, reminderTz: VN, ...extra });
function user(id, extra) {
  db.prepare("INSERT INTO users (id, email, name, preferences) VALUES (?, ?, ?, ?)").run(id, id + "@x", id, prefs(extra));
  db.prepare("INSERT INTO classes (id, user_id, name) VALUES (?, ?, 'C')").run("k-" + id, id);
  db.prepare("INSERT INTO lessons (id, class_id, title, format) VALUES (?, ?, 'L', 'term-def')").run("l-" + id, "k-" + id);
  db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, 'p', 'a')").run(id, "https://fcm.googleapis.com/" + id);
}
function due(id, n, when) {
  for (let i = 0; i < n; i++) {
    const card = id + "-card" + i;
    db.prepare("INSERT INTO cards (id, lesson_id, format, data) VALUES (?, ?, 'term-def', '{}')").run(card, "l-" + id);
    db.prepare("INSERT INTO card_states (card_id, user_id, srs_due_at) VALUES (?, ?, ?)").run(card, id, when);
  }
}
let attemptN = 0;
function studied(id, when) {
  db.prepare("INSERT INTO attempts (id, card_id, user_id, correct, source, created_at, duration_ms) VALUES (?, 'x', ?, 1, 'flashcard', ?, 20000)")
    .run("a" + attemptN++, id, when);
}

test("the daily reminder: once, only with cards due and nothing studied since local midnight", async function() {
  user("d1"); due("d1", 12, at(0, 0));
  user("d2"); due("d2", 3, at(0, 0)); studied("d2", at(18, 0, 7)); // 01:00 on the 8th in Vietnam
  user("d3");                                                        // nothing due
  user("d4", { reminders: { on: false } }); due("d4", 3, at(0, 0));
  user("d5"); due("d5", 3, at(0, 0)); studied("d5", at(16, 0, 7));   // 23:00 on the 7th: yesterday
  user("d6", { maxReviewsPerDay: 5 }); due("d6", 8, at(0, 0));
  sent.length = 0;
  const got = await R.runReminders(db, at(13, 5), push);
  assert.deepEqual(Object.keys(got).filter(k => k[0] === "d").sort(), ["d1", "d5", "d6"]);
  assert.equal(sent.find(s => s.endpoint.endsWith("/d6")).body, "5 cards are ready to review.", "no more than the daily cap");
  const d1 = sent.find(s => s.endpoint.endsWith("/d1"));
  assert.equal(d1.title, "Time to review");
  assert.equal(d1.body, "12 cards are ready to review.");
  const d5 = sent.find(s => s.endpoint.endsWith("/d5"));
  assert.equal(d5.body, "3 cards are ready to review. About 1 minute.", "the time from the median answer");
  sent.length = 0;
  await R.runReminders(db, at(13, 6), push);
  assert.equal(sent.filter(s => s.endpoint.includes("/d")).length, 0, "the next minute does not send it again");
});

test("the streak nudge only when the streak would end tonight", async function() {
  // The 8th is a Thursday. s1 rested on Wednesday, so it has no rest day left; s2 studied
  // yesterday and has this week's rest day; s3 already studied today; s4 turned it off.
  user("s1"); due("s1", 5, at(0, 0)); for (const d of [5, 6]) studied("s1", at(10, 0, d));
  user("s2"); for (const d of [6, 7]) studied("s2", at(10, 0, d));
  user("s3"); for (const d of [5, 6, 8]) studied("s3", at(3, 0, d));
  user("s4", { reminders: { on: true, streak: false } }); for (const d of [5, 6]) studied("s4", at(10, 0, d));
  sent.length = 0;
  const got = await R.runReminders(db, at(14, 10), push);
  assert.deepEqual(Object.keys(got).filter(k => k[0] === "s"), ["s1"]);
  assert.deepEqual(got.s1, ["streak"]);
  const s1 = sent.find(s => s.endpoint.endsWith("/s1"));
  assert.equal(s1.body, "Study today to keep your 2-day streak. 5 cards are ready.");
  sent.length = 0;
  await R.runReminders(db, at(14, 30), push);
  assert.equal(sent.filter(s => s.endpoint.endsWith("/s1")).length, 0, "once a day");
});

test("a device the push service says is gone is removed", async function() {
  user("g1"); due("g1", 1, at(0, 0));
  failWith = 410;
  try { await R.runReminders(db, at(13, 20), push); } finally { failWith = null; }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = 'g1'").get().n, 0);
});

test("subscribe: real push services only; a browser moves to the account that signed in on it", async function() {
  db.prepare("INSERT INTO users (id, email, name) VALUES ('r1', 'r1@x', 'r1'), ('r2', 'r2@x', 'r2')").run();
  const sub = { endpoint: "https://web.push.apple.com/QHxyz", keys: { p256dh: "BKEY", auth: "AUTH" } };
  const bad = await call("POST", "/api/reminders/subscribe", "r1", { subscription: { ...sub, endpoint: "https://169.254.169.254/x" }, tz: VN });
  assert.equal(bad.status, 400);
  assert.equal((await call("POST", "/api/reminders/subscribe", "r1", { subscription: sub, tz: VN })).status, 200);
  assert.equal(JSON.parse(db.prepare("SELECT preferences FROM users WHERE id = 'r1'").get().preferences).reminderTz, VN);
  await call("POST", "/api/reminders/subscribe", "r2", { subscription: sub, tz: 9999 });
  assert.deepEqual(db.prepare("SELECT user_id FROM push_subscriptions WHERE endpoint = ?").all(sub.endpoint).map(r => r.user_id), ["r2"]);
  assert.equal(JSON.parse(db.prepare("SELECT preferences FROM users WHERE id = 'r2'").get().preferences).reminderTz, 0, "an impossible offset is not stored");
  const info = await call("GET", "/api/reminders", "r2");
  assert.deepEqual(info.body, { available: true, publicKey: "BPUBLIC", devices: 1 });
  sent.length = 0;
  const t = await call("POST", "/api/reminders/test", "r2");
  assert.deepEqual(t.body, { sent: 1 });
  assert.equal(sent[0].title, "Reminders are on");
  assert.equal((await call("POST", "/api/reminders/test", "r2")).status, 429, "test sends are spaced");
  await call("POST", "/api/reminders/unsubscribe", "r1", { endpoint: sub.endpoint });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?").get(sub.endpoint).n, 1, "another account cannot remove it");
  await call("POST", "/api/reminders/unsubscribe", "r2", { endpoint: sub.endpoint });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?").get(sub.endpoint).n, 0);
});

test("VAPID keys are generated once and kept", function() {
  const saved = [process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY];
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
  try {
    let n = 0;
    const fake = { generateVAPIDKeys: () => ({ publicKey: "P" + ++n, privateKey: "S" + n }) };
    assert.deepEqual(R.vapidKeys(db, fake), { publicKey: "P1", privateKey: "S1" });
    assert.deepEqual(R.vapidKeys(db, fake), { publicKey: "P1", privateKey: "S1" });
    assert.equal(n, 1);
  } finally {
    if (saved[0]) process.env.VAPID_PUBLIC_KEY = saved[0];
    if (saved[1]) process.env.VAPID_PRIVATE_KEY = saved[1];
  }
});

test("the service worker shows a pushed reminder and opens the app when it is tapped", async function() {
  const handlers = {}, shown = [], opened = [];
  const self = {
    location: { origin: "https://app.example" },
    addEventListener: (k, f) => { handlers[k] = f; },
    registration: { showNotification: (title, opts) => { shown.push({ title, opts }); return Promise.resolve(); } },
    clients: { matchAll: () => Promise.resolve([]), openWindow: (u) => { opened.push(u); return Promise.resolve(); } },
    skipWaiting() {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "client/sw.js"), "utf8"), { self, caches: {}, URL, fetch, Response: {} });
  let wait;
  handlers.push({ data: { json: () => ({ title: "Time to review", body: "3 cards", url: "/" }) }, waitUntil: (p) => { wait = p; } });
  await wait;
  assert.equal(shown[0].title, "Time to review");
  assert.equal(shown[0].opts.body, "3 cards");
  handlers.notificationclick({ notification: { close() {}, data: { url: "/" } }, waitUntil: (p) => { wait = p; } });
  await wait;
  assert.deepEqual(opened, ["/"]);
});

test("the client: saved reminder settings are cleaned, and hidden offline", function() {
  const src = fs.readFileSync(path.join(root, "client/app.js"), "utf8");
  const fn = src.match(/function normalizeReminders\(r\) \{[\s\S]*?\n\}/)[0];
  const ctx = {};
  vm.runInNewContext(fn + "; this.normJson = function(r) { return JSON.stringify(normalizeReminders(r)); };", ctx);
  const norm = (r) => JSON.parse(ctx.normJson(r));
  assert.deepEqual(norm({}), { on: false, time: "20:00", streak: true });
  assert.deepEqual(norm({ on: true, time: "07:30", streak: false }), { on: true, time: "07:30", streak: false });
  assert.equal(norm({ time: "7:30" }).time, "20:00");
  assert.match(src, /"pref-memory", "pref-reminders",/, "hidden in the offline app, which has no server to send them");
});

test("phone layout: the reminder settings fit at 320px", async function() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 640 }, isMobile: true, reducedMotion: "reduce" });
    await page.route("**/*.js", (r) => r.abort());
    await page.goto("file://" + path.join(root, "client", "index.html"));
    await page.addStyleTag({ path: path.join(root, "client", "style.css") });
    const r = await page.evaluate(function() {
      document.getElementById("modal-overlay").classList.remove("hidden");
      document.getElementById("modal-preferences").classList.remove("hidden");
      document.getElementById("modal-preferences").dataset.page = "reminders";
      document.getElementById("pref-reminders-on").checked = true;
      document.getElementById("pref-reminder-status").textContent =
        "To get reminders on iPhone, add the app to your Home Screen first: tap Share, then \"Add to Home Screen\", and open it from there.";
      document.getElementById("pref-reminders").scrollIntoView();
      const box = document.getElementById("modal-preferences").getBoundingClientRect();
      const parts = Array.from(document.querySelectorAll("#pref-reminders *")).map(el => [el, el.getBoundingClientRect()]).filter(p => p[1].width > 0);
      const time = document.getElementById("pref-reminder-time").getBoundingClientRect();
      const label = document.querySelector('label[for="pref-reminder-time"]').getBoundingClientRect();
      return { left: box.left, right: box.right, sameLine: Math.abs((time.top + time.bottom) / 2 - (label.top + label.bottom) / 2) < 12 && label.right <= time.left,
               parts: parts.map(([el, b]) => [b.left, b.right, el.tagName + "#" + el.id]) };
    });
    for (const [l, rr, what] of r.parts) assert.ok(l >= r.left - 0.5 && rr <= r.right + 0.5, JSON.stringify([what, l, rr, r.left, r.right]));
    assert.ok(r.sameLine, "the time sits beside its label");
    fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
    await page.locator("#pref-reminders").screenshot({ path: path.join(root, "test-results", "reminders-phone.png") });
  } finally {
    await browser.close();
  }
});
