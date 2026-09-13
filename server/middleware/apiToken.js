"use strict";

const crypto = require("crypto");
const db     = require("../db");

// Tokens are 256 bits of randomness, so a fast unsalted hash is enough — there is no
// low-entropy secret here for a slow hash to protect.
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Sets req.userId, never req.session: sessions use saveUninitialized:false, so touching
// req.session from a token-authenticated call would create a session row per request.
function requireApiToken(req, res, next) {
  const m = /^Bearer (\S+)$/.exec(req.get("authorization") || "");
  if (!m) return res.status(401).json({ error: "API token required" });
  const row = db.prepare("SELECT id, user_id, last_used_at FROM api_tokens WHERE token_hash = ?").get(hashToken(m[1]));
  if (!row) return res.status(401).json({ error: "Invalid API token" });
  const now = Math.floor(Date.now() / 1000);
  if (!row.last_used_at || row.last_used_at < now - 60)
    db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(now, row.id);
  req.userId = row.user_id;
  next();
}

module.exports = { requireApiToken, hashToken };
