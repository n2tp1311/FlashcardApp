"use strict";

// The public address, for links in emails and the Google sign-in return address. Set on
// Railway as "flashcardapp.up.railway.app" without the scheme, it sent Google a return
// address it rejects ("Error 400: invalid_request"), so a bare host gets https://.
function appUrl() {
  const raw = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (!raw) return `http://localhost:${process.env.PORT || 3000}`;
  return /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
}

module.exports = {
  appUrl,
  PORT:            process.env.PORT            || 3000,
  SESSION_SECRET:  process.env.SESSION_SECRET  || "fc-dev-secret-change-in-prod",
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
