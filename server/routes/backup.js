"use strict";

// GET /api/backup/latest: the newest nightly copy of the whole database, gzipped, for
// scripts/pull-backup.sh on the owner's machine. The file holds every account, so it is
// not behind a user's session or API token: only BACKUP_TOKEN, a secret set on the server
// alone, opens it, and without that variable the route does not exist (404).

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const zlib = require("zlib");
const { pipeline } = require("stream");
const backup = require("../lib/backup");
const { rateLimit } = require("../middleware/rateLimit");

function digest(s) { return crypto.createHash("sha256").update(String(s)).digest(); }

module.exports = function backupRouter(dir) {
  const router = express.Router();
  // Keyed by IP: a guessing client gets ten tries an hour, the nightly pull needs one.
  router.use(rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }));

  router.get("/latest", function(req, res) {
    const secret = process.env.BACKUP_TOKEN;
    if (!secret) return res.status(404).end();
    const m = /^Bearer (.+)$/.exec(req.get("authorization") || "");
    // Compared as hashes so the comparison takes the same time whatever the length.
    if (!m || !crypto.timingSafeEqual(digest(m[1]), digest(secret))) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const last = backup.latest(dir);
    if (!last) return res.status(404).json({ error: "No backup yet" });
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", 'attachment; filename="flashcards-' + last.day + '.db.gz"');
    res.setHeader("X-Backup-Day", last.day);
    res.setHeader("Cache-Control", "no-store");
    // Streamed through zlib's thread pool, so compressing tens of megabytes does not hold
    // the event loop the way the database work does.
    pipeline(fs.createReadStream(last.file), zlib.createGzip(), res, function(err) {
      if (err) console.error("[backup] download", err.message);
    });
  });

  return router;
};
