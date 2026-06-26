"use strict";

const express  = require("express");
const multer   = require("multer");
const path     = require("path");
const { requireAuth } = require("../middleware/auth");
const router   = express.Router();

const UPLOADS_DIR = path.join(__dirname, "..", "..", "data", "uploads");

const storage = multer.diskStorage({
  destination: function(_req, _file, cb) { cb(null, UPLOADS_DIR); },
  filename: function(_req, file, cb) {
    var ext = path.extname(file.originalname).toLowerCase() || ".bin";
    var uuid = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    cb(null, uuid + ext);
  }
});

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function(_req, file, cb) {
    if (ALLOWED_TYPES.indexOf(file.mimetype) === -1) {
      return cb(new Error("Invalid file type. Accepted: JPEG, PNG, GIF, WebP"));
    }
    cb(null, true);
  }
});

router.post("/", requireAuth, function(req, res) {
  upload.single("image")(req, res, function(err) {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    res.json({ url: "/uploads/" + req.file.filename });
  });
});

module.exports = router;
