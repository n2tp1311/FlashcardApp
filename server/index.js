"use strict";

const express              = require("express");
const session              = require("express-session");
const SQLiteSessionStore   = require("./sessionStore");
const path                 = require("path");
const fs           = require("fs");
const db                   = require("./db");
const { requestLog }             = require("./middleware/requestLog");
const { startEventLoopWatchdog } = require("./middleware/watchdog");
const { rateLimit }              = require("./middleware/rateLimit");

const app    = express();
// Railway terminates connections at its edge proxy — without this, req.ip is the
// proxy's address for every request, and rateLimit.js (keyed on req.ip) collapses
// into one shared bucket across all users instead of one per real client. Gated to
// production (Dockerfile sets NODE_ENV=production) since trusting X-Forwarded-For
// with no proxy in front — local dev, or any deployment reachable directly — lets a
// client set req.ip to whatever it wants via that header, bypassing rate limits.
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
const PORT   = process.env.PORT || 3000;
const ROOT   = path.join(__dirname, "..");
const CLIENT = path.join(ROOT, "client");
const DATA   = path.join(ROOT, "data");

if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
const UPLOADS = require("path").join(DATA, "uploads");
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

// ── Middleware ────────────────────────────────────────────
app.use(requestLog);
// Auth bodies are always tiny (email/password/token strings) — capped separately
// and tightly, since express.json() runs before any route's rate limiter, so on
// login/register/forgot/reset-password a large body gets fully parsed (a
// synchronous, event-loop-blocking cost) before the limiter ever gets a chance to
// reject the request. Scoped to the /api/auth prefix so it doesn't touch the global
// limit below, which stays generous for POST /api/import — a full account export
// (classes+lessons+cards+attempts+states as JSON) can legitimately run several MB
// for a long-lived, heavily-reviewed account.
app.use("/api/auth", express.json({ limit: "10kb" }));
app.use(express.json({ limit: "10mb" }));

// Unauthenticated, no DB write — Railway checks this only while a deploy is
// rolling out (not on an already-live instance, confirmed against Railway's docs),
// but it's also useful for manual checks and any future external uptime monitor.
// Rate-limited too: it runs a synchronous DB call like everything else in this app,
// so a tight-loop hit against it is exactly the kind of abuse the watchdog exists to
// catch — without this, /health would be the one endpoint left able to trip its own
// safety mechanism. 60/min per IP comfortably covers any real uptime monitor (these
// typically poll every 30s-1min) while blocking a hammering loop.
const healthLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: "Too many requests" });
app.get("/health", healthLimiter, (req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[health] DB check failed:", e.message);
    res.status(503).json({ ok: false });
  }
});

app.use(session({
  store: new SQLiteSessionStore(),
  secret: process.env.SESSION_SECRET || "fc-dev-secret-change-in-prod",
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax"
  }
}));

// ── API Routes ────────────────────────────────────────────
app.use("/api/auth",    require("./routes/auth"));
app.use("/api/classes", require("./routes/classes"));
app.use("/api",         require("./routes/lessons"));
app.use("/api",         require("./routes/cards"));
app.use("/api/attempts",require("./routes/attempts"));
app.use("/api/stats",   require("./routes/stats"));
app.use("/api/export",  require("./routes/exportImport"));
app.use("/api/import",  require("./routes/exportImport"));
app.use("/api/share",   require("./routes/share"));
app.use("/api/review",  require("./routes/review"));
app.use("/api/upload",  require("./routes/upload"));
app.use("/api/search",  require("./routes/search"));
app.use("/uploads",     require("express").static(UPLOADS, { index: false }));

// ── Helper: inject APP_CONFIG and serve index.html ───────
const indexHtml = path.join(CLIENT, "index.html");

function serveApp(res, config) {
  const html     = fs.readFileSync(indexHtml, "utf8");
  const injected = html.replace(
    "</head>",
    `<script>window.APP_CONFIG = ${JSON.stringify(config)};</script>\n</head>`
  );
  res.send(injected);
}

function baseConfig(req) {
  return {
    mode: "server",
    googleEnabled: !!process.env.GOOGLE_CLIENT_ID,
    user: req.session.userId
      ? { id: req.session.userId, name: req.session.userName, email: req.session.userEmail }
      : null
  };
}

// ── Frontend Routes ───────────────────────────────────────
app.get("/", (req, res) => serveApp(res, baseConfig(req)));

app.get("/share/:token", (req, res) =>
  serveApp(res, { ...baseConfig(req), shareToken: req.params.token }));

app.get("/reset-password", (req, res) =>
  serveApp(res, { mode: "server", googleEnabled: false, user: null, resetToken: req.query.token || null }));

app.get("/favicon.ico", (req, res) => res.status(204).end());

// Serve static assets from client/
app.use(express.static(CLIENT, { index: false }));

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Flashcard server running at http://localhost:${PORT}`);
});

startEventLoopWatchdog();

setInterval(function() {
  db.prepare("DELETE FROM sessions WHERE expired <= ?").run(Math.floor(Date.now() / 1000));
}, 24 * 60 * 60 * 1000);
