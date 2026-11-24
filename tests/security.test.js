"use strict";
// Holes found by the 2026-11-24 audit, each tried as an attacker would: a token in the URL
// that closes the config <script> tag, a page uploaded as an "image", a Google sign-in
// callback driven with someone else's code, a Google sign-in joining a password account
// whose email was never proved, a framed page, a guessable share link, and a session id
// planted before sign-in.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const express = require("express");
const { Database } = require("node-sqlite3-wasm");

const root = path.join(__dirname, "..");

test("config JSON in a <script> cannot close the tag, and reads back unchanged", () => {
  const { inlineJson } = require(path.join(root, "server/lib/inlineJson"));
  const config = { resetToken: "</script><script>alert(1)</script>", user: { name: "<b>Lan</b> </SCRIPT>" } };
  const out = inlineJson(config);
  assert.doesNotMatch(out, /</);
  assert.deepEqual(JSON.parse(out), config);
  const index = fs.readFileSync(path.join(root, "server/index.js"), "utf8");
  assert.match(index, /APP_CONFIG = \$\{inlineJson\(config\)\}/);
  assert.doesNotMatch(index, /APP_CONFIG = \$\{JSON\.stringify/);
});

// ── Routes on an in-memory database, with sessions kept per x-sid as a browser would ─────
const db = new Database();
require(path.join(root, "server/lib/statements")).shimPrepare(db);
db.transaction = (fn) => (...a) => { db.exec("BEGIN"); try { const r = fn(...a); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };
const schema = fs.readFileSync(path.join(root, "server/db.js"), "utf8");
for (const t of ["users", "password_reset_tokens", "sessions", "classes", "lessons", "cards", "class_invites"])
  // The first schema's format CHECK predates image cards; a migration rebuilds it in production.
  db.exec(schema.match(new RegExp("CREATE TABLE IF NOT EXISTS " + t + " \\([\\s\\S]*?\\n  \\)"))[0].replace(/CHECK\s*\(format IN \([^)]*\)\)/g, ""));
for (const m of schema.match(/ALTER TABLE (users|classes|lessons|cards) ADD COLUMN [^"]+/g) || []) { try { db.exec(m); } catch (_) {} }
db.exec(schema.match(/CREATE TABLE IF NOT EXISTS external_card_deletions \([\s\S]*?\n  \)/)[0]);
const file = require.resolve(path.join(root, "server/db.js"));
require.cache[file] = { id: file, filename: file, loaded: true, exports: db };

const upload = require(path.join(root, "server/routes/upload"));
const sessions = new Map();
const app = express();
app.use(express.json());
// regenerate swaps in a fresh object under the same x-sid, as a new cookie would.
app.use((req, _res, next) => {
  const sid = req.get("x-sid") || "anon";
  if (!sessions.has(sid)) sessions.set(sid, {});
  req.session = sessions.get(sid);
  Object.defineProperty(req.session, "regenerate", { configurable: true, value(cb) {
    req.session = {};
    sessions.set(sid, req.session);
    cb();
  } });
  next();
});
app.use("/api/auth", require(path.join(root, "server/routes/auth")));
app.use("/api/upload", upload);
app.use("/api/share", require(path.join(root, "server/routes/share")));
app.use("/api", require(path.join(root, "server/routes/cards")));
const served = fs.mkdtempSync(path.join(require("os").tmpdir(), "fc-uploads-"));
app.use("/uploads", upload.serveUploads(served));

// Google's two endpoints answer from here; anything else is a real request.
const realFetch = global.fetch;
let googleCalls = 0;
global.fetch = async (url, opts) => {
  if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
    googleCalls++;
    const code = JSON.parse(opts.body).code;
    return { status: 200, json: async () => ({ access_token: "at-" + code }) };
  }
  if (String(url).startsWith("https://www.googleapis.com/oauth2/v2/userinfo")) {
    const who = opts.headers.Authorization.replace("Bearer at-", "");
    return { status: 200, json: async () => ({ id: "g-" + who, email: who + "@gmail.com", name: who, picture: null,
      verified_email: !who.startsWith("unverified") }) };
  }
  return realFetch(url, opts);
};

let base, server;
test.before(() => new Promise((ok) => { server = app.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + server.address().port; ok(); }); }));
test.after(() => { server.close(); global.fetch = realFetch; fs.rmSync(served, { recursive: true, force: true }); });
const get = (url, sid) => realFetch(base + url, { headers: sid ? { "x-sid": sid } : {}, redirect: "manual" });

test("Google sign-in: the callback needs this browser's own state, once", async () => {
  process.env.GOOGLE_CLIENT_ID = "cid";
  db.prepare("INSERT INTO users (id, email, name, password_hash) VALUES ('victim', 'victim@example.com', 'V', 'x')").run();
  sessions.set("victim", { userId: "victim" });

  // The attacker starts a sign-in of their own, and keeps the code instead of using it.
  const start = await get("/api/auth/google?link=1", "victim");
  const sent = new URL(start.headers.get("location"));
  assert.match(sent.searchParams.get("state"), /^[0-9a-f]{32}$/);

  // Then sends the victim's browser to the callback with that code: no state, or a wrong one.
  for (const q of ["code=mallory", "code=mallory&state=" + "0".repeat(32)]) {
    const r = await get("/api/auth/google/callback?" + q, "victim");
    assert.equal(r.headers.get("location"), "/?auth_error=google_failed&reason=state_mismatch");
  }
  assert.equal(googleCalls, 0, "a wrong state never reaches Google");
  assert.equal(db.prepare("SELECT google_id FROM users WHERE id = 'victim'").get().google_id, null);
  assert.equal(sessions.get("victim").googleLinkUserId, undefined, "the link request ends with the failure");

  // The right state works once.
  const again = new URL((await get("/api/auth/google?link=1", "victim")).headers.get("location"));
  const ok = await get("/api/auth/google/callback?code=victim2&state=" + again.searchParams.get("state"), "victim");
  assert.equal(ok.headers.get("location"), "/?google_linked=1");
  assert.equal(db.prepare("SELECT google_id FROM users WHERE id = 'victim'").get().google_id, "g-victim2");
  const reused = await get("/api/auth/google/callback?code=victim3&state=" + again.searchParams.get("state"), "victim");
  assert.equal(reused.headers.get("location"), "/?auth_error=google_failed&reason=state_mismatch");
});

test("a link started in one session cannot link from another", async () => {
  sessions.set("linker", { userId: "victim" });
  const s = new URL((await get("/api/auth/google?link=1", "linker")).headers.get("location")).searchParams.get("state");
  sessions.get("linker").userId = undefined; // signed out (or another account) before the callback
  const r = await get("/api/auth/google/callback?code=newbie&state=" + s, "linker");
  assert.equal(r.headers.get("location"), "/", "it signs in as the Google account instead of linking");
  assert.notEqual(db.prepare("SELECT google_id FROM users WHERE id = 'victim'").get().google_id, "g-newbie");
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const send = (name, type, bytes) => {
  const form = new FormData();
  form.append("image", new Blob([bytes], { type }), name);
  return realFetch(base + "/api/upload", { method: "POST", body: form, headers: { "x-sid": "uploader" } });
};

test("an upload is kept only if its bytes are an image, under the extension they say", async () => {
  sessions.set("uploader", { userId: "victim" });
  assert.equal(upload.imageExt(PNG), ".png");
  assert.equal(upload.imageExt(Buffer.from("\xff\xd8\xff\xe0" + "x".repeat(12), "latin1")), ".jpg");
  assert.equal(upload.imageExt(Buffer.from("GIF89a" + "x".repeat(10))), ".gif");
  assert.equal(upload.imageExt(Buffer.from("RIFF0000WEBPVP8 ")), ".webp");
  assert.equal(upload.imageExt(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script/>")), null);

  const page = await send("x.html", "image/png", "<script>alert(document.domain)</script>!!!!");
  assert.equal(page.status, 400);
  const svg = await send("x.svg", "image/png", "<svg><script>alert(1)</script></svg>");
  assert.equal(svg.status, 400);

  const real = await send("photo.HTML", "image/png", PNG);
  const { url } = await real.json();
  assert.match(url, /^\/uploads\/[0-9a-f]{24}\.png$/, "the name the uploader gave is not kept");
  const saved = path.join(upload.UPLOADS_DIR, path.basename(url));
  try { assert.deepEqual(fs.readFileSync(saved), PNG); } finally { fs.rmSync(saved, { force: true }); }
});

test("uploads serve images only, never as a page", async () => {
  fs.writeFileSync(path.join(served, "old.html"), "<script>alert(1)</script>");
  fs.writeFileSync(path.join(served, "old.svg"), "<svg><script>alert(1)</script></svg>");
  fs.writeFileSync(path.join(served, "pic.png"), PNG);
  for (const f of ["old.html", "old.svg", "OLD.html", "..%2fold.html"]) assert.equal((await get("/uploads/" + f)).status, 404, f);
  const r = await get("/uploads/pic.png");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match(r.headers.get("content-security-policy"), /sandbox/);
});

const post = async (url, body, sid) => {
  const r = await realFetch(base + url, { method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-sid": sid || "anon" }, redirect: "manual" });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const googleSignIn = async (sid, code) => {
  const s = new URL((await get("/api/auth/google", sid)).headers.get("location")).searchParams.get("state");
  return (await get("/api/auth/google/callback?code=" + code + "&state=" + s, sid)).headers.get("location");
};

test("Google sign-in does not join a password account, nor use an unproved email", async () => {
  // Someone registered sam@gmail.com with a password before Sam ever signed in.
  db.prepare("INSERT INTO users (id, email, name, password_hash) VALUES ('squat', 'sam@gmail.com', 'S', 'their-hash')").run();
  assert.equal(await googleSignIn("sam", "sam"), "/?auth_error=google_email_has_password");
  assert.equal(db.prepare("SELECT google_id FROM users WHERE id = 'squat'").get().google_id, null);
  assert.equal(sessions.get("sam").userId, undefined, "Sam is not signed in to it");

  // An account with no password (made by Google, link since removed) still joins.
  db.prepare("INSERT INTO users (id, email, name) VALUES ('nopass', 'kim@gmail.com', 'K')").run();
  assert.equal(await googleSignIn("kim", "kim"), "/?google_linked=1");
  assert.equal(sessions.get("kim").userId, "nopass");

  assert.equal(await googleSignIn("unv", "unverified1"), "/?auth_error=google_unverified");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'unverified1@gmail.com'").get().n, 0);

  for (const k of ["auth.googleEmailHasPassword", "auth.googleUnverified"])
    assert.equal(fs.readFileSync(path.join(root, "client/app.js"), "utf8").split('"' + k + '":').length - 1, 2, k);
});

test("every sign-in starts a new session; a password reset ends all the others", async () => {
  const bcrypt = require("bcryptjs");
  db.prepare("INSERT INTO users (id, email, name, password_hash) VALUES ('lan', 'lan@example.com', 'Lan', ?)").run(bcrypt.hashSync("old-pass", 4));
  sessions.set("planted", { planted: true });
  assert.equal((await post("/api/auth/login", { email: "lan@example.com", password: "old-pass" }, "planted")).status, 200);
  assert.deepEqual([sessions.get("planted").planted, sessions.get("planted").userId], [undefined, "lan"]);

  sessions.set("reg", { planted: true });
  assert.equal((await post("/api/auth/register", { name: "Nam", email: "nam@example.com", password: "secret12" }, "reg")).status, 200);
  assert.equal(sessions.get("reg").planted, undefined);
  assert.equal((await post("/api/auth/register", { name: "X", email: ["a@b.c"], password: "secret12" })).status, 400, "an email that is not text is refused, not a 500");

  // The person who knew the old password is signed in elsewhere, and asked for a reset link too.
  const row = (sid) => db.prepare("INSERT INTO sessions (sid, sess, expired) VALUES (?, ?, 2e9)").run(sid, JSON.stringify({ cookie: {}, userId: "lan" }));
  row("other-device"); row("intruder");
  db.prepare("INSERT INTO sessions (sid, sess, expired) VALUES ('someone-else', ?, 2e9)").run(JSON.stringify({ cookie: {}, userId: "nam" }));
  db.prepare("INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES ('t-mine', 'lan', 2e9), ('t-theirs', 'lan', 2e9)").run();
  sessions.set("resetter", { planted: true });
  const r = await post("/api/auth/reset-password", { token: "t-mine", password: "new-pass" }, "resetter");
  assert.equal(r.status, 200);
  assert.deepEqual(db.prepare("SELECT sid FROM sessions").all().map((x) => x.sid), ["someone-else"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM password_reset_tokens WHERE user_id = 'lan'").get().n, 0);
  assert.deepEqual([sessions.get("resetter").planted, sessions.get("resetter").userId], [undefined, "lan"]);
});

test("pages cannot be framed and keep tokens out of referrers; share links are unguessable", async () => {
  const { securityHeaders } = require(path.join(root, "server/middleware/securityHeaders"));
  const h = {};
  securityHeaders(true)({}, { setHeader: (k, v) => { h[k.toLowerCase()] = v; } }, () => {});
  assert.equal(h["x-frame-options"], "DENY");
  assert.match(h["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(h["referrer-policy"], "strict-origin-when-cross-origin");
  assert.match(h["strict-transport-security"], /max-age=\d+/);
  const local = {};
  securityHeaders(false)({}, { setHeader: (k, v) => { local[k.toLowerCase()] = v; } }, () => {});
  assert.equal(local["strict-transport-security"], undefined, "no HSTS on localhost");
  const index = fs.readFileSync(path.join(root, "server/index.js"), "utf8");
  assert.ok(index.indexOf("securityHeaders(") < index.indexOf('app.use("/api/integrations'), "set before every route");

  const share = fs.readFileSync(path.join(root, "server/routes/share.js"), "utf8");
  const gen = share.match(/function genToken\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(gen, /randomBytes\(16\)/);
  assert.doesNotMatch(gen, /Math\.random/);
});

test("production will not start on the secret written in the code; the cookie is Secure over HTTPS", () => {
  const env = require(path.join(root, "server/config/env"));
  const saved = { s: process.env.SESSION_SECRET, n: process.env.NODE_ENV };
  try {
    delete process.env.SESSION_SECRET;
    process.env.NODE_ENV = "production";
    assert.throws(() => env.sessionSecret(), /SESSION_SECRET must be set/);
    process.env.SESSION_SECRET = "s3cret";
    assert.equal(env.sessionSecret(), "s3cret");
    delete process.env.SESSION_SECRET;
    delete process.env.NODE_ENV;
    assert.equal(typeof env.sessionSecret(), "string", "local development still runs");
  } finally {
    if (saved.s === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = saved.s;
    if (saved.n === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.n;
  }
  const index = fs.readFileSync(path.join(root, "server/index.js"), "utf8");
  assert.match(index, /secret: env\.sessionSecret\(\)/);
  assert.match(index, /secure: "auto"/);
});

test("invites: a shared name finds nobody, and twenty an hour is the limit", async () => {
  db.prepare("INSERT INTO users (id, email, name) VALUES ('m1', 'm1@example.com', 'Minh'), ('m2', 'm2@example.com', 'Minh'), ('ha', 'ha@example.com', 'Hà')").run();
  db.prepare("INSERT INTO classes (id, user_id, name) VALUES ('inv-c', 'lan', 'Class')").run();
  sessions.set("inviter", { userId: "lan" });
  const inv = (query) => post("/api/share/invite/inv-c", { query }, "inviter");
  assert.equal((await inv("Minh")).body.code, "userNotFound", "two accounts are named Minh");
  assert.equal((await inv("Hà")).status, 201);
  assert.equal((await inv(" M1@Example.com ")).status, 201, "email in any case");
  assert.equal((await inv(["x"])).status, 400);
  let last;
  for (let i = 0; i < 20; i++) last = await inv("nobody" + i + "@example.com");
  assert.deepEqual([last.status, last.body.code], [429, "rateLimited"]);
});

test("deleting a card removes its image only when no other card shows it", async () => {
  db.exec(`INSERT INTO classes (id, user_id, name) VALUES ('vc', 'nopass', 'Victim'), ('ac', 'lan', 'Attacker');
    INSERT INTO lessons (id, class_id, title, format) VALUES ('vl', 'vc', 'L', 'image-def'), ('al', 'ac', 'L', 'image-def');`);
  const name = "sec" + Date.now() + ".png";
  const file = path.join(upload.UPLOADS_DIR, name);
  fs.writeFileSync(file, PNG);
  try {
    const data = JSON.stringify({ imageUrl: "/uploads/" + name, def: "d" });
    db.prepare("INSERT INTO cards (id, lesson_id, format, data) VALUES ('vcard', 'vl', 'image-def', ?), ('acard', 'al', 'image-def', ?)").run(data, data);
    sessions.set("attacker", { userId: "lan" });
    const del = (id, sid) => realFetch(base + "/api/cards/" + id, { method: "DELETE", headers: { "x-sid": sid } });
    assert.equal((await del("acard", "attacker")).status, 204);
    assert.ok(fs.existsSync(file), "the victim's card still shows it");
    sessions.set("owner", { userId: "nopass" });
    assert.equal((await del("vcard", "owner")).status, 204);
    assert.ok(!fs.existsSync(file), "the last card to show it takes it with it");
  } finally { fs.rmSync(file, { force: true }); }
});
