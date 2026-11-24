"use strict";

const express  = require("express");
const multer   = require("multer");
const path     = require("path");
const fs       = require("fs");
const crypto   = require("crypto");
const { requireAuth } = require("../middleware/auth");
const router   = express.Router();

const UPLOADS_DIR = path.join(__dirname, "..", "..", "data", "uploads");

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

// The type comes from the file's first bytes. The browser's stated type and the file's name
// are the uploader's to choose: an .html file sent as image/png was saved as .html and served
// back as a page on this origin, where its script ran as whoever opened the link.
function imageExt(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  const head = buf.subarray(0, 6).toString("latin1");
  if (head === "GIF87a" || head === "GIF89a") return ".gif";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return ".webp";
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
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
    const ext = imageExt(req.file.buffer);
    if (!ext) return res.status(400).json({ error: "Invalid file type. Accepted: JPEG, PNG, GIF, WebP" });
    const name = crypto.randomBytes(12).toString("hex") + ext;
    fs.writeFileSync(path.join(UPLOADS_DIR, name), req.file.buffer);
    res.json({ url: "/uploads/" + name });
  });
});

// Only image extensions are served, so a page saved before the check above cannot be opened.
// ".bin" is an image uploaded without an extension; it is served as a download, never a page.
// nosniff stops a browser reading an image as anything else, and the sandbox CSP gives a file
// opened directly no script and no access to this origin.
const SERVED = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bin"]);
function serveUploads(dir) {
  const files = express.static(dir, { index: false, dotfiles: "deny" });
  return function(req, res, next) {
    if (!SERVED.has(path.extname(req.path).toLowerCase())) return res.status(404).end();
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    files(req, res, next);
  };
}

module.exports = router;
module.exports.imageExt = imageExt;
module.exports.serveUploads = serveUploads;
module.exports.UPLOADS_DIR = UPLOADS_DIR;
