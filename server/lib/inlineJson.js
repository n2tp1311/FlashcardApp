"use strict";

// JSON for a <script> block. JSON.stringify leaves "<" alone, so a value holding
// "</script>" -- a share token or reset token from the URL, or a user's name -- would close
// the tag and run whatever follows. < reads back as "<" to both JSON.parse and a script.
function inlineJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

module.exports = { inlineJson };
