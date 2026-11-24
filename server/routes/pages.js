"use strict";

// The book-to-cards worker's calls: reserve pages when it accepts a book, commit when the
// deck is made, refund when it fails. It signs with PAGES_WORKER_TOKEN, a token of its own,
// so no user token can spend another user's pages. Without the variable the routes 404.
const crypto = require("crypto");
const express = require("express");
const db = require("../db");
const plans = require("../lib/plans");

const router = express.Router();
const sha = (s) => crypto.createHash("sha256").update(s).digest();

function requireWorker(req, res, next) {
  const want = process.env.PAGES_WORKER_TOKEN;
  if (!want) return res.status(404).json({ error: "Not found" });
  const m = /^Bearer (\S+)$/.exec(req.get("authorization") || "");
  if (!m || !crypto.timingSafeEqual(sha(m[1]), sha(want))) return res.status(401).json({ error: "Worker token required" });
  next();
}

const jobId = (v) => typeof v === "string" && v.length > 0 && v.length <= 100;

router.post("/reserve", requireWorker, (req, res) => {
  const { userId, pages, title } = req.body || {};
  if (!jobId(req.body && req.body.jobId) || typeof userId !== "string" || !Number.isInteger(pages) || pages < 1 || pages > 100000)
    return res.status(400).json({ error: "jobId, userId and a whole number of pages are required" });
  if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId)) return res.status(404).json({ error: "Unknown user" });
  const r = plans.reserve(db, userId, req.body.jobId, pages, { title: typeof title === "string" ? title.slice(0, 200) : null });
  if (r.ok) return res.json(r);
  if (r.code === "not_enough_pages") return res.status(402).json({ error: "Not enough pages", ...r });
  res.status(409).json({ error: r.code, ...r });
});

for (const [path, to] of [["/commit", "committed"], ["/refund", "refunded"]]) {
  router.post(path, requireWorker, (req, res) => {
    if (!jobId(req.body && req.body.jobId)) return res.status(400).json({ error: "jobId required" });
    const r = plans.settle(db, req.body.jobId, to);
    if (r.ok) return res.json(r);
    res.status(r.code === "unknown_job" ? 404 : 409).json({ error: r.code, ...r });
  });
}

module.exports = router;
