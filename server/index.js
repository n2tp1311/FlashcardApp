"use strict";

const express      = require("express");
const session      = require("express-session");
const MemoryStore  = require("memorystore")(session);
const path         = require("path");
const fs           = require("fs");

const app  = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");

if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

// ── Middleware ────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));

app.use(session({
  store: new MemoryStore({ checkPeriod: 86400000 }), // prune expired every 24h
  secret: process.env.SESSION_SECRET || "fc-dev-secret-change-in-prod",
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    sameSite: "lax"
  }
}));

// ── API Routes ────────────────────────────────────────────
app.use("/api/auth",    require("./routes/auth"));
app.use("/api/classes", require("./routes/classes"));
app.use("/api",         require("./routes/lessons"));   // mounts /api/classes/:id/lessons + /api/lessons/:id
app.use("/api",         require("./routes/cards"));     // mounts /api/lessons/:id/cards + /api/cards/:id
app.use("/api/attempts",require("./routes/attempts"));
app.use("/api/stats",   require("./routes/stats"));
app.use("/api/export",  require("./routes/exportImport"));
app.use("/api/import",  require("./routes/exportImport"));
app.use("/api/share",   require("./routes/share"));
app.use("/api/review",  require("./routes/review"));

// ── Serve frontend with injected config ──────────────────
const indexHtml = path.join(ROOT, "index.html");

app.get("/", (req, res) => {
  const html   = fs.readFileSync(indexHtml, "utf8");
  const config = {
    mode: "server",
    user: req.session.userId
      ? { id: req.session.userId, name: req.session.userName, email: req.session.userEmail }
      : null
  };
  const injected = html.replace(
    "</head>",
    `<script>window.APP_CONFIG = ${JSON.stringify(config)};</script>\n</head>`
  );
  res.send(injected);
});

// Serve app for share links (frontend handles rendering)
app.get("/share/:token", (req, res) => {
  const html   = fs.readFileSync(indexHtml, "utf8");
  const config = {
    mode: "server",
    shareToken: req.params.token,
    user: req.session.userId
      ? { id: req.session.userId, name: req.session.userName, email: req.session.userEmail }
      : null
  };
  const injected = html.replace(
    "</head>",
    `<script>window.APP_CONFIG = ${JSON.stringify(config)};</script>\n</head>`
  );
  res.send(injected);
});

// Silence favicon requests
app.get("/favicon.ico", (req, res) => res.status(204).end());

// Serve static assets (style.css, app.js, etc.)
app.use(express.static(ROOT, { index: false }));

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Flashcard server running at http://localhost:${PORT}`);
});
