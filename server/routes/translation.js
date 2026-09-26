"use strict";

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { rateLimit, byUser } = require("../middleware/rateLimit");
const translation = require("../services/translation");

const router = express.Router();
const MAX_TEXT_LENGTH = 4000;
const translateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: "Too many translation requests. Try again later.",
  keyFn: byUser,
});

router.post("/", requireAuth, translateLimiter, async (req, res) => {
  const { text, language } = req.body || {};
  if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: "Text must be a non-empty string of at most 4000 characters" });
  }
  if (language !== "en" && language !== "vi") {
    return res.status(400).json({ error: "Unsupported target language" });
  }

  try {
    const result = await translation.translateText(text, language);
    res.json({ translation: result });
  } catch (err) {
    if (err.code === "not_configured")
      return res.status(501).json({ error: "Translation isn't configured on this server" });
    console.error("[translation] translateText failed:", err);
    res.status(502).json({ error: "Translation failed — try again" });
  }
});

module.exports = router;
