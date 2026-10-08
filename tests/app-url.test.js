"use strict";
// APP_URL set without its scheme sent Google a return address it rejects with
// "Error 400: invalid_request"; every public address goes through appUrl().
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { appUrl } = require("../server/config/env");

test("APP_URL gets https:// when set as a bare host, and loses a trailing slash", function() {
  const saved = process.env.APP_URL;
  try {
    for (const [v, want] of [["flashcardapp.up.railway.app", "https://flashcardapp.up.railway.app"],
                             ["https://flashcardapp.up.railway.app/", "https://flashcardapp.up.railway.app"],
                             [" http://localhost:3000 ", "http://localhost:3000"]]) {
      process.env.APP_URL = v;
      assert.equal(appUrl(), want, v);
    }
    delete process.env.APP_URL;
    assert.match(appUrl(), /^http:\/\/localhost:\d+$/);
  } finally {
    if (saved === undefined) delete process.env.APP_URL; else process.env.APP_URL = saved;
  }
});

test("no route reads APP_URL directly", function() {
  for (const f of ["server/routes/auth.js", "server/lib/reminders.js"])
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), /process\.env\.APP_URL \|\|/, f);
});
