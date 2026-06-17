"use strict";

const nodemailer = require("nodemailer");

function createTransport() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  // Gmail shorthand
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });
  }
  return null;
}

async function sendPasswordReset(toEmail, toName, resetUrl) {
  const transport = createTransport();
  if (!transport) {
    console.warn("[mailer] No SMTP configured — reset URL:", resetUrl);
    return { ok: false, reason: "no_smtp" };
  }
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.GMAIL_USER || "noreply@flashcards.app",
    to:   toEmail,
    subject: "Reset your Flashcard App password",
    html: `
      <p>Hi ${toName},</p>
      <p>We received a request to reset your password. Click the link below — it expires in 1 hour.</p>
      <p><a href="${resetUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">Reset Password</a></p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `
  });
  return { ok: true };
}

module.exports = { sendPasswordReset };
