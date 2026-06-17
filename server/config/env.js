"use strict";

module.exports = {
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
};
