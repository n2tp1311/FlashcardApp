"use strict";

const express  = require("express");
const bcrypt   = require("bcryptjs");
const crypto   = require("crypto");
const db       = require("../db");
const { sendPasswordReset } = require("../services/mailer");
const router   = express.Router();

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function setSession(req, user) {
  req.session.userId    = user.id;
  req.session.userName  = user.name;
  req.session.userEmail = user.email;
}

// POST /api/auth/register
router.post("/register", (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: "name, email and password are required" });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters" });

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const hash = bcrypt.hashSync(password, 10);
  const id   = genId();
  db.prepare("INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)")
    .run(id, email.toLowerCase(), name.trim(), hash);

  const user = { id, name: name.trim(), email: email.toLowerCase() };
  setSession(req, user);
  res.json(user);
});

// POST /api/auth/login
router.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "email and password are required" });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: "Invalid email or password" });
  if (!user.password_hash) return res.status(401).json({ error: "This account uses Google sign-in. Use 'Sign in with Google' instead." });
  if (!bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: "Invalid email or password" });

  setSession(req, user);
  res.json({ id: user.id, name: user.name, email: user.email });
});

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// GET /api/auth/me
router.get("/me", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  res.json({ id: req.session.userId, name: req.session.userName, email: req.session.userEmail });
});

// ── Forgot / Reset Password ───────────────────────────────

// POST /api/auth/forgot-password  { email }
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email required" });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
  // Always respond 200 to prevent email enumeration
  if (!user || !user.password_hash) return res.json({ ok: true });

  const token     = crypto.randomBytes(32).toString("hex");
  const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  db.prepare("INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?,?,?)")
    .run(token, user.id, expiresAt);

  const baseUrl  = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  try {
    const result = await sendPasswordReset(user.email, user.name, resetUrl);
    if (!result.ok && result.reason === "no_smtp") {
      if (process.env.NODE_ENV !== "production") {
        // Dev-only fallback: return token in response for local testing
        return res.json({ ok: true, _devResetUrl: resetUrl });
      }
      // In production with no SMTP, silently succeed — don't expose token
    }
  } catch (e) {
    console.error("[forgot-password]", e.message);
  }

  res.json({ ok: true });
});

// POST /api/auth/reset-password  { token, password }
router.post("/reset-password", (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: "token and password required" });
  if (password.length < 6)  return res.status(400).json({ error: "Password must be at least 6 characters" });

  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(
    "SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > ?"
  ).get(token, now);
  if (!row) return res.status(400).json({ error: "Reset link is invalid or has expired" });

  const hash = bcrypt.hashSync(password, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, row.user_id);
  db.prepare("UPDATE password_reset_tokens SET used = 1 WHERE token = ?").run(token);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id);
  setSession(req, user);
  res.json({ id: user.id, name: user.name, email: user.email });
});

// ── Google OAuth ──────────────────────────────────────────
// GET /api/auth/google
router.get("/google", (req, res) => {
  const clientId    = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = `${process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`}/api/auth/google/callback`;
  if (!clientId) return res.status(503).send("Google OAuth not configured (missing GOOGLE_CLIENT_ID)");

  // Store linkMode in session if requested (linking existing account)
  if (req.query.link === "1" && req.session.userId) {
    req.session.googleLinkUserId = req.session.userId;
  }

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: "code",
    scope:         "openid email profile",
    access_type:   "offline",
    prompt:        "select_account"
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /api/auth/google/callback
router.get("/google/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect("/?auth_error=google_cancelled");

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri  = `${process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`}/api/auth/google/callback`;

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" })
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error("No access token");

    // Get user profile
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const profile = await profileRes.json();
    const { id: googleId, email, name, picture } = profile;

    // Link mode: attach Google account to currently logged-in user
    const linkUserId = req.session.googleLinkUserId;
    delete req.session.googleLinkUserId;

    if (linkUserId) {
      const alreadyLinked = db.prepare("SELECT id FROM users WHERE google_id = ? AND id != ?").get(googleId, linkUserId);
      if (alreadyLinked) return res.redirect("/?auth_error=google_already_linked");
      db.prepare("UPDATE users SET google_id = ?, avatar_url = ? WHERE id = ?").run(googleId, picture, linkUserId);
      return res.redirect("/?google_linked=1");
    }

    // Sign-in / auto-register
    let user = db.prepare("SELECT * FROM users WHERE google_id = ?").get(googleId);
    if (!user) {
      // Try to match by email (link to existing account)
      user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
      if (user) {
        db.prepare("UPDATE users SET google_id = ?, avatar_url = ? WHERE id = ?").run(googleId, picture, user.id);
      } else {
        // Create new account
        const id = genId();
        db.prepare("INSERT INTO users (id, email, name, google_id, avatar_url) VALUES (?,?,?,?,?)")
          .run(id, email.toLowerCase(), name, googleId, picture);
        user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      }
    }

    setSession(req, user);
    res.redirect("/");
  } catch (e) {
    console.error("[google-oauth]", e.message);
    res.redirect("/?auth_error=google_failed");
  }
});

module.exports = router;
