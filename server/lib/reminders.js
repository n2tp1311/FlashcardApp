"use strict";

// Study reminders by web push. Two kinds, each sent at most once a day:
//
//   daily  - at the user's chosen local time (8:00 PM by default), only when cards are due
//            and nothing has been answered since local midnight. A reminder on a day with
//            nothing to do, or after studying, teaches people to ignore it.
//   streak - in the evening, only when skipping the rest of the day would end the streak:
//            a streak exists, nothing was answered today, and no rest day is left to cover it.
//
// The streak's days are UTC days (lib/streak.js), so its day ends at UTC midnight: 7:00 AM
// in Vietnam, 7:00 PM in New York. The nudge goes at 9:00 PM local, or at 22:00 UTC if
// that is earlier, so it always lands two hours or more before the streak's day ends. Its
// text names no time for the same reason: "midnight" would be wrong for most users.
//
// The server checks once a minute (runReminders) and sends within an hour after the
// scheduled minute, so a restart at 8:05 still sends the 8:00 reminder but one at 3 AM
// does not send last night's.

const { computeStreak } = require("./streak");

const DEFAULT_TIME = 20 * 60;
const SAVER_LOCAL = 21 * 60;
const SAVER_LATEST_UTC = 22 * 60;
const WINDOW_MIN = 60;

// Push services the server will post to. The endpoint comes from the browser, so without
// this a client could make the server send requests to any address it names.
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)$/;

function validEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.test(u.hostname);
  } catch (_) { return false; }
}

function parseTime(v) {
  const m = typeof v === "string" && /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : DEFAULT_TIME;
}

function normalizeTz(tz) {
  return Number.isInteger(tz) && tz >= -840 && tz <= 840 ? tz : 0;
}

function settingsFrom(prefs) {
  const r = (prefs && typeof prefs.reminders === "object" && prefs.reminders) || {};
  return { on: r.on === true, minutes: parseTime(r.time), streak: r.streak !== false,
           tz: normalizeTz(prefs && prefs.reminderTz), language: prefs && prefs.language === "vi" ? "vi" : "en",
           cap: prefs && Number.isInteger(prefs.maxReviewsPerDay) && prefs.maxReviewsPerDay > 0 ? prefs.maxReviewsPerDay : null };
}

function dayKey(sec) {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

// The local day to log the daily reminder under, when now is inside its window.
function dailyKey(now, s) {
  const local = now - s.tz * 60;
  const minute = Math.floor((local % 86400) / 60);
  return minute >= s.minutes && minute < s.minutes + WINDOW_MIN ? dayKey(local) : null;
}

// The UTC day the streak nudge is for, when now is inside its window.
function streakKey(now, s) {
  const at = Math.min(SAVER_LOCAL + s.tz, SAVER_LATEST_UTC);
  const minute = Math.floor((now % 86400) / 60);
  return minute >= at && minute < at + WINDOW_MIN ? dayKey(now) : null;
}

function dueCount(db, userId, now) {
  return db.prepare(
    "SELECT COUNT(*) AS n FROM card_states cs JOIN cards ca ON ca.id = cs.card_id JOIN lessons l ON l.id = ca.lesson_id " +
    "JOIN classes c ON c.id = l.class_id WHERE cs.user_id = ? AND c.user_id = ? AND c.archived = 0 " +
    "AND cs.srs_due_at IS NOT NULL AND cs.srs_due_at <= ?"
  ).get(userId, userId, now).n;
}

function minutesFor(db, userId, cards) {
  const rows = db.prepare(
    "SELECT duration_ms FROM attempts WHERE user_id = ? AND duration_ms > 0 ORDER BY created_at DESC LIMIT 200"
  ).all(userId).map(r => r.duration_ms).sort((a, b) => a - b);
  if (!rows.length) return null;
  return Math.max(1, Math.round(cards * rows[rows.length >> 1] / 60000));
}

const TEXT = {
  en: {
    dailyTitle: "Time to review",
    due: (n) => n === 1 ? "1 card is ready to review." : n + " cards are ready to review.",
    about: (m) => " About " + m + (m === 1 ? " minute." : " minutes."),
    streakTitle: "Keep your streak",
    streak: (d) => "Study today to keep your " + d + "-day streak.",
    streakDue: (n) => n === 1 ? " 1 card is ready." : " " + n + " cards are ready.",
    testTitle: "Reminders are on",
    test: "This is what a reminder looks like. You will get one on days with cards to review."
  },
  vi: {
    dailyTitle: "Đến giờ ôn tập",
    due: (n) => n + " thẻ đang chờ ôn.",
    about: (m) => " Khoảng " + m + " phút.",
    streakTitle: "Giữ chuỗi ngày học",
    streak: (d) => "Học hôm nay để giữ chuỗi " + d + " ngày.",
    streakDue: (n) => " " + n + " thẻ đang chờ.",
    testTitle: "Đã bật nhắc nhở",
    test: "Nhắc nhở sẽ trông như thế này. Bạn sẽ nhận vào những ngày có thẻ cần ôn."
  }
};

function message(kind, s, info) {
  const T = TEXT[s.language];
  if (kind === "test") return { title: T.testTitle, body: T.test, url: "/" };
  if (kind === "daily") {
    return { title: T.dailyTitle, body: T.due(info.due) + (info.minutes ? T.about(info.minutes) : ""), url: "/" };
  }
  return { title: T.streakTitle, body: T.streak(info.streak) + (info.due ? T.streakDue(info.due) : ""), url: "/" };
}

function logged(db, userId, kind, day) {
  return !!db.prepare("SELECT 1 FROM reminder_log WHERE user_id = ? AND kind = ? AND day = ?").get(userId, kind, day);
}

// Sends to every device the user turned reminders on from. A subscription the push service
// says is gone (404, 410) is deleted: the browser dropped it, and it will never work again.
async function sendToUser(db, userId, payload, push) {
  const subs = db.prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?").all(userId);
  let sent = 0;
  for (const sub of subs) {
    try {
      await push({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload));
      sent++;
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
      else console.error("[reminders] push failed:", e && (e.statusCode || e.message));
    }
  }
  return sent;
}

async function remindUser(db, user, now, push) {
  const s = settingsFrom(user.prefs);
  if (!s.on) return [];
  const out = [];
  const daily = dailyKey(now, s);
  if (daily && !logged(db, user.id, "daily", daily)) {
    const localMidnight = Math.floor((now - s.tz * 60) / 86400) * 86400 + s.tz * 60;
    const studied = db.prepare("SELECT 1 FROM attempts WHERE user_id = ? AND created_at >= ? LIMIT 1").get(user.id, localMidnight);
    // Capped like the study queue: "300 cards" when only 50 will be shown is a reason not to start.
    const due = studied ? 0 : Math.min(dueCount(db, user.id, now), s.cap || Infinity);
    if (!studied && due > 0) {
      // Logged before sending, so a slow push can never let the next tick send it twice.
      db.prepare("INSERT OR IGNORE INTO reminder_log (user_id, kind, day) VALUES (?, 'daily', ?)").run(user.id, daily);
      await sendToUser(db, user.id, message("daily", s, { due, minutes: minutesFor(db, user.id, due) }), push);
      out.push("daily");
    }
  }
  const saver = s.streak && streakKey(now, s);
  if (saver && !logged(db, user.id, "streak", saver)) {
    const days = db.prepare("SELECT DISTINCT date(created_at, 'unixepoch') AS day FROM attempts WHERE user_id = ?")
      .all(user.id).map(r => r.day);
    const st = computeStreak(days, saver);
    if (st.streak > 0 && !st.studiedToday && !st.restAvailableToday) {
      db.prepare("INSERT OR IGNORE INTO reminder_log (user_id, kind, day) VALUES (?, 'streak', ?)").run(user.id, saver);
      await sendToUser(db, user.id, message("streak", s, { streak: st.streak, due: Math.min(dueCount(db, user.id, now), s.cap || Infinity) }), push);
      out.push("streak");
    }
  }
  return out;
}

// One pass over the users with reminders on and a device to send to.
async function runReminders(db, now, push) {
  const users = db.prepare(
    "SELECT u.id, u.preferences FROM users u WHERE EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)"
  ).all();
  const sent = {};
  for (const u of users) {
    let prefs = {};
    try { prefs = JSON.parse(u.preferences || "{}"); } catch (_) {}
    const got = await remindUser(db, { id: u.id, prefs }, now, push);
    if (got.length) sent[u.id] = got;
  }
  return sent;
}

// VAPID keys identify this server to the push services. From the environment when set;
// otherwise generated once and kept in the database, because new keys would orphan every
// subscription made with the old ones.
function vapidKeys(db, webpush) {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  const row = db.prepare("SELECT value FROM app_secrets WHERE name = 'vapid'").get();
  if (row) return JSON.parse(row.value);
  const keys = webpush.generateVAPIDKeys();
  db.prepare("INSERT OR IGNORE INTO app_secrets (name, value) VALUES ('vapid', ?)").run(JSON.stringify(keys));
  return JSON.parse(db.prepare("SELECT value FROM app_secrets WHERE name = 'vapid'").get().value);
}

// Apple's push service rejects a subject that is not a real https URL or mailto address.
function vapidSubject() {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  if (/^https:\/\//.test(process.env.APP_URL || "")) return process.env.APP_URL;
  const mail = process.env.SMTP_FROM || process.env.GMAIL_USER;
  const addr = mail && /[^\s<>]+@[^\s<>]+/.exec(mail);
  return addr ? "mailto:" + addr[0] : "mailto:reminders@flashcardapp.invalid";
}

let pusher = null;
function webPush(db) {
  if (!pusher) {
    const webpush = require("web-push");
    const keys = vapidKeys(db, webpush);
    webpush.setVapidDetails(vapidSubject(), keys.publicKey, keys.privateKey);
    pusher = { publicKey: keys.publicKey, send: (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 3600 }) };
  }
  return pusher;
}

// Tests replace the push service; nothing else should.
function setPusher(p) { pusher = p; }

module.exports = { DEFAULT_TIME, validEndpoint, parseTime, settingsFrom, dailyKey, streakKey, message,
                   sendToUser, remindUser, runReminders, vapidKeys, webPush, setPusher, normalizeTz };
