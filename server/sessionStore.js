"use strict";

const session = require("express-session");
const db      = require("./db");

const THIRTY_DAYS = 30 * 24 * 60 * 60;

function expiredAt(sess) {
  if (sess.cookie && sess.cookie.expires) {
    return Math.floor(new Date(sess.cookie.expires).getTime() / 1000);
  }
  return Math.floor(Date.now() / 1000) + THIRTY_DAYS;
}

class SQLiteSessionStore extends session.Store {
  get(sid, cb) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const row = db.prepare("SELECT sess FROM sessions WHERE sid = ? AND expired > ?").get(sid, now);
      if (!row) return cb(null, null);
      try { cb(null, JSON.parse(row.sess)); } catch (_) { cb(null, null); }
    } catch (e) { cb(e); }
  }

  set(sid, sess, cb) {
    try {
      const exp = expiredAt(sess);
      db.prepare("INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)")
        .run(sid, JSON.stringify(sess), exp);
      cb(null);
    } catch (e) { cb(e); }
  }

  destroy(sid, cb) {
    try {
      db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      cb(null);
    } catch (e) { cb(e); }
  }

  touch(sid, sess, cb) {
    try {
      const exp = expiredAt(sess);
      db.prepare("UPDATE sessions SET expired = ? WHERE sid = ?").run(exp, sid);
      cb(null);
    } catch (e) { cb(e); }
  }
}

module.exports = SQLiteSessionStore;
