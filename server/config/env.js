"use strict";

// The public address, for links in emails and the Google sign-in return address. Set on
// Railway as "flashcardapp.up.railway.app" without the scheme, it sent Google a return
// address it rejects ("Error 400: invalid_request"), so a bare host gets https://.
function appUrl() {
  const raw = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (!raw) return `http://localhost:${process.env.PORT || 3000}`;
  return /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
}

// The secret signs session cookies. In production it must be set: the fallback is in this
// public file. Stopping at start is louder than running on a known secret for months, as
// production did until 2026-11-24.
const DEV_SECRET = "fc-dev-secret-change-in-prod";
function sessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set in production");
  return DEV_SECRET;
}

module.exports = {
  appUrl,
  sessionSecret,
  PORT:            process.env.PORT            || 3000,
  APP_URL:         process.env.APP_URL         || null,
  GOOGLE_CLIENT_ID:     process.env.GOOGLE_CLIENT_ID     || null,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || null,
  GMAIL_USER:          process.env.GMAIL_USER          || null,
  GMAIL_APP_PASSWORD:  process.env.GMAIL_APP_PASSWORD  || null,
  SMTP_HOST: process.env.SMTP_HOST || null,
  SMTP_PORT: process.env.SMTP_PORT || "587",
  SMTP_USER: process.env.SMTP_USER || null,
  SMTP_PASS: process.env.SMTP_PASS || null,
  SMTP_FROM: process.env.SMTP_FROM || null,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || null,
};
