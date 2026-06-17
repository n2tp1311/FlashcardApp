"use strict";

const express      = require("express");
const session      = require("express-session");
const MemoryStore  = require("memorystore")(session);
const path         = require("path");
const fs           = require("fs");

const app    = express();
const PORT   = process.env.PORT || 3000;
const ROOT   = path.join(__dirname, "..");
const CLIENT = path.join(ROOT, "client");
const DATA   = path.join(ROOT, "data");

if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

// ── Middleware ────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));

app.use(session({
  store: new MemoryStore({ checkPeriod: 86400000 }),
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
