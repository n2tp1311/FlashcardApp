"use strict";

const express  = require("express");
const bcrypt   = require("bcryptjs");
const crypto   = require("crypto");
const db       = require("../db");
const { sendPasswordReset } = require("../services/mailer");
const { requireAuth } = require("../middleware/auth");
const { isAdmin } = require("../middleware/admin");
const { rateLimit } = require("../middleware/rateLimit");
const { appUrl } = require("../config/env");
const { endSessions } = require("../lib/accounts");
const router   = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: "Too many login attempts. Try again in a few minutes."
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message: "Too many accounts created from this network. Try again later."
});
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message: "Too many password reset requests. Try again later."
});
const resetPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10,
  message: "Too many attempts. Try again later."
});
// Unlike the routes above, a hit here makes two outbound calls to Google (token
// exchange + userinfo) before it can even fail — an unthrottled loop of junk `code`
// values is free server-initiated outbound traffic with no cap.
const googleCallbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: "Too many attempts. Try again later."
});

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Express 4 does not catch a rejected promise, so a failed session write would leave the
// request hanging; this passes it to the error handler instead.
const safe = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const SUSPENDED = "This account is suspended. Contact the admin if you think this is a mistake.";

// A new session id at every sign-in: an id planted in the browser before it (by a script on
// a sibling subdomain, or a shared computer) would otherwise become signed in with it.
function signIn(req, user) {
  return new Promise((ok, fail) => req.session.regenerate((err) => {
    if (err) return fail(err);
    req.session.userId    = user.id;
    req.session.userName  = user.name;
    req.session.userEmail = user.email;
    ok();
  }));
}

// POST /api/auth/register
router.post("/register", registerLimiter, safe(async (req, res) => {
  const { name, email, password } = req.body;
  if (typeof name !== "string" || typeof email !== "string" || typeof password !== "string" || !name || !email || !password)
    return res.status(400).json({ error: "name, email and password are required", code: "missingFields" });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters", code: "passwordTooShort" });

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: "Email already registered", code: "emailTaken" });

  const hash = bcrypt.hashSync(password, 10);
  const id   = genId();
  db.prepare("INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)")
    .run(id, email.toLowerCase(), name.trim(), hash);

  const user = { id, name: name.trim(), email: email.toLowerCase() };
  await signIn(req, user);
  res.json({ ...user, isAdmin: isAdmin(user.id) });
}));

// POST /api/auth/login
router.post("/login", loginLimiter, safe(async (req, res) => {
  const { email, password } = req.body;
  if (typeof email !== "string" || typeof password !== "string" || !email || !password)
    return res.status(400).json({ error: "email and password are required", code: "missingFields" });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: "Invalid email or password", code: "invalidCredentials" });
  if (!user.password_hash) return res.status(401).json({ error: "This account uses Google sign-in. Use 'Sign in with Google' instead.", code: "googleAccount" });
  if (!bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: "Invalid email or password", code: "invalidCredentials" });
  // Said only after the right password, so guessing passwords does not reveal a suspension.
  if (user.suspended_at) return res.status(403).json({ error: SUSPENDED, code: "accountSuspended" });

  await signIn(req, user);
  res.json({ id: user.id, name: user.name, email: user.email, isAdmin: isAdmin(user.id) });
}));

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// GET /api/auth/me
router.get("/me", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  res.json({ id: req.session.userId, name: req.session.userName, email: req.session.userEmail, isAdmin: isAdmin(req.session.userId) });
});

// ── Forgot / Reset Password ───────────────────────────────

// POST /api/auth/forgot-password  { email }
router.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email required" });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
  // Always respond 200 to prevent email enumeration
  if (!user || !user.password_hash || user.suspended_at) return res.json({ ok: true });

  const token     = crypto.randomBytes(32).toString("hex");
  const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  db.prepare("INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?,?,?)")
    .run(token, user.id, expiresAt);

  const baseUrl  = appUrl();
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
router.post("/reset-password", resetPasswordLimiter, safe(async (req, res) => {
  const { token, password } = req.body;
  if (typeof token !== "string" || typeof password !== "string" || !token || !password) return res.status(400).json({ error: "token and password required" });
  if (password.length < 6)  return res.status(400).json({ error: "Password must be at least 6 characters", code: "passwordTooShort" });

  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(
    "SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > ?"
  ).get(token, now);
  if (!row) return res.status(400).json({ error: "Reset link is invalid or has expired", code: "resetInvalid" });

  const suspended = db.prepare("SELECT suspended_at FROM users WHERE id = ?").get(row.user_id);
  if (suspended && suspended.suspended_at) return res.status(403).json({ error: SUSPENDED, code: "accountSuspended" });

  const hash = bcrypt.hashSync(password, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, row.user_id);
  // A reset is how someone takes back an account whose password another person knows, so
  // every other sign-in and every other reset link ends with it.
  db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(row.user_id);
  endSessions(db, row.user_id);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id);
  await signIn(req, user);
  res.json({ id: user.id, name: user.name, email: user.email, isAdmin: isAdmin(user.id) });
}));

// ── Google OAuth ──────────────────────────────────────────
// GET /api/auth/google
router.get("/google", (req, res) => {
  const clientId    = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = `${appUrl()}/api/auth/google/callback`;
  if (!clientId) return res.status(503).send("Google OAuth not configured (missing GOOGLE_CLIENT_ID)");

  // Store linkMode in session if requested (linking existing account)
  if (req.query.link === "1" && req.session.userId) {
    req.session.googleLinkUserId = req.session.userId;
  } else {
    delete req.session.googleLinkUserId;
  }
  // The callback accepts only the state it was sent away with, in this browser's session.
  // Without it, a page could send someone's browser to the callback with a code from the
  // attacker's own Google account, and link that account to theirs.
  const state = crypto.randomBytes(16).toString("hex");
  req.session.googleState = state;

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: "code",
    scope:         "openid email profile",
    access_type:   "offline",
    prompt:        "select_account",
    state
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /api/auth/google/callback
router.get("/google/callback", googleCallbackLimiter, async (req, res) => {
  const { code, error, state } = req.query;
  const want = req.session.googleState;
  delete req.session.googleState;
  if (error || !code) return res.redirect("/?auth_error=google_cancelled");
  const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
  if (!want || typeof state !== "string" || !crypto.timingSafeEqual(sha(state), sha(want))) {
    delete req.session.googleLinkUserId;
    return res.redirect("/?auth_error=google_failed&reason=state_mismatch");
  }

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri  = `${appUrl()}/api/auth/google/callback`;

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" })
    });
    const tokens = await tokenRes.json();
    // Google's reason (invalid_client: wrong secret; redirect_uri_mismatch; invalid_grant: a
    // used or expired code) is the whole diagnosis, and "No access token" alone hid it.
    if (!tokens.access_token) {
      const err = new Error("No access token: " + (tokens.error || tokenRes.status) + (tokens.error_description ? " - " + tokens.error_description : ""));
      err.reason = tokens.error || "token_" + tokenRes.status;
      throw err;
    }

    // Get user profile
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const profile = await profileRes.json();
    const { id: googleId, email, name, picture } = profile;
    if (!googleId || !email) throw Object.assign(new Error("No id or email in the Google profile"), { reason: "no_profile" });
    if (profile.verified_email !== true) return res.redirect("/?auth_error=google_unverified");

    // Link mode: attach Google account to currently logged-in user
    const linkUserId = req.session.googleLinkUserId;
    delete req.session.googleLinkUserId;

    if (linkUserId && linkUserId === req.session.userId) {
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
      if (user && user.suspended_at) return res.redirect("/?auth_error=account_suspended");
      // Not joined to a password account: a password sign-up never proves its email, so
      // someone could register yours first, wait for your Google sign-in to join it, and
      // still sign in with their password. The owner signs in with the password (or resets
      // it by email, which ends the other person's sessions) and links Google in Preferences.
      if (user && user.password_hash) return res.redirect("/?auth_error=google_email_has_password");
      if (user) {
        db.prepare("UPDATE users SET google_id = ?, avatar_url = ? WHERE id = ?").run(googleId, picture, user.id);
        // Said on arrival, so a first Google sign-in to an email account is not a silent change.
        await signIn(req, user);
        return res.redirect("/?google_linked=1");
      } else {
        // Create new account
        const id = genId();
        db.prepare("INSERT INTO users (id, email, name, google_id, avatar_url) VALUES (?,?,?,?,?)")
          .run(id, email.toLowerCase(), name, googleId, picture);
        user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      }
    }

    if (user.suspended_at) return res.redirect("/?auth_error=account_suspended");
    await signIn(req, user);
    res.redirect("/");
  } catch (e) {
    console.error("[google-oauth]", e.message);
    // Google's error code, shown with the message, so a failure can be diagnosed without the
    // server logs. Codes only (invalid_client, redirect_uri_mismatch), never the description.
    // Anything else (a network or database error) is summarised from its message, which names
    // a failure, not data: "fetch failed", "UNIQUE constraint failed: users.email".
    const reason = /^[a-z0-9_]{1,40}$/.test(e.reason || "") ? e.reason
      : ("server_" + String(e.message || "error").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")).slice(0, 40);
    res.redirect("/?auth_error=google_failed&reason=" + reason);
  }
});

// GET /api/auth/preferences
router.get("/preferences", requireAuth, (req, res) => {
  const user = db.prepare("SELECT preferences FROM users WHERE id = ?").get(req.session.userId);
  let prefs = {};
  if (user && user.preferences) {
    try { prefs = JSON.parse(user.preferences); } catch (_) {}
  }
  res.json(prefs);
});

// PUT /api/auth/preferences
router.put("/preferences", requireAuth, (req, res) => {
  const body = req.body;
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return res.status(400).json({ error: "preferences must be a JSON object" });
  // Read-modify-write so unknown keys added by future code are preserved
  const user = db.prepare("SELECT preferences FROM users WHERE id = ?").get(req.session.userId);
  let current = {};
  if (user && user.preferences) {
    try { current = JSON.parse(user.preferences); } catch (_) {}
  }
  const merged = Object.assign({}, current, body);
  db.prepare("UPDATE users SET preferences = ? WHERE id = ?")
    .run(JSON.stringify(merged), req.session.userId);
  res.json({ ok: true });
});

module.exports = router;
