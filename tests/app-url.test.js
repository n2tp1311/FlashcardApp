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

test("a failed Google sign-in says why in the message, as a bare code", function() {
  const auth = fs.readFileSync(path.join(__dirname, "..", "server/routes/auth.js"), "utf8");
  assert.match(auth, /err\.reason = tokens\.error \|\| "token_" \+ tokenRes\.status;/);
  assert.match(auth, /"server_" \+ String\(e\.message \|\| "error"\)/);
  const app = fs.readFileSync(path.join(__dirname, "..", "client/app.js"), "utf8");
  assert.match(app, /if \(reason && \/\^\[a-z0-9_\]\{1,40\}\$\/\.test\(reason\)\) msg \+= " \(" \+ reason \+ "\)";/);
});

test("linking Google, from Preferences or by a first Google sign-in to an email account, says so", function() {
  const auth = fs.readFileSync(path.join(__dirname, "..", "server/routes/auth.js"), "utf8");
  assert.equal(auth.split('res.redirect("/?google_linked=1")').length - 1, 2);
  const app = fs.readFileSync(path.join(__dirname, "..", "client/app.js"), "utf8");
  assert.match(app, /params\.get\("google_linked"\) === "1"\) \{\s*history\.replaceState\(\{\}, "", "\/"\);\s*showToast\(t\("auth\.googleLinked"\)\);/);
  assert.equal(app.split('"auth.googleLinked":').length - 1, 2, "English and Vietnamese");
});
