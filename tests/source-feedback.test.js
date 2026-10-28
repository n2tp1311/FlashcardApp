"use strict";
// "Did this passage help?" under a book passage: the card route run for real on an in-memory
// database, the /sources write that must never put a rejected passage back, and the panel row.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const express = require("express");
const { Database } = require("node-sqlite3-wasm");

const root = path.join(__dirname, "..");
const raw = new Database();
const _prepare = raw.prepare.bind(raw);
const db = {
  exec: (sql) => raw.exec(sql),
  prepare(sql) {
    const stmt = _prepare(sql);
    const arg = (a) => (a.length === 0 ? [] : a.length === 1 ? a[0] : a);
    return { run: (...a) => stmt.run(arg(a)), get: (...a) => stmt.get(arg(a)), all: (...a) => stmt.all(arg(a)) };
  }
};
raw.exec(`
  CREATE TABLE classes (id TEXT PRIMARY KEY, user_id TEXT);
  CREATE TABLE lessons (id TEXT PRIMARY KEY, class_id TEXT);
  CREATE TABLE cards (id TEXT PRIMARY KEY, lesson_id TEXT, external_id TEXT, source TEXT,
    source_verdict TEXT, source_rejected TEXT, source_before TEXT, source_after TEXT, source_related TEXT);
  INSERT INTO classes VALUES ('k1', 'u1'), ('k2', 'u2');
  INSERT INTO lessons VALUES ('L1', 'k1'), ('X1', 'k2');
  INSERT INTO cards (id, lesson_id, external_id, source) VALUES
    ('a', 'L1', 's:1', 'A formula.'), ('b', 'L1', 's:2', 'The bootstrap is a general tool.'),
    ('n', 'L1', 's:3', NULL), ('x', 'X1', 's:1', 'Theirs.');
`);

function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub("server/db.js", db);
stub("server/middleware/auth.js", {
  requireAuth(req, res, next) {
    req.session = { userId: req.get("x-user") };
    next();
  }
});
const app = express();
app.use(express.json());
app.use("/api", require(path.join(root, "server/routes/cards.js")));

let base, server;
test.before(() => new Promise((ok) => { server = app.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + server.address().port; ok(); }); }));
test.after(() => server.close());

async function verdict(id, v, user = "u1") {
  const r = await fetch(base + "/api/cards/" + id + "/source-feedback", { method: "POST",
    headers: { "content-type": "application/json", "x-user": user }, body: JSON.stringify({ verdict: v }) });
  return { status: r.status, body: await r.json() };
}
const row = (id) => db.prepare("SELECT source, source_verdict, source_rejected FROM cards WHERE id = ?").get(id);

test("doesn't match takes the passage off at once, and undo puts it back", async () => {
  const bad = await verdict("a", "bad");
  assert.equal(bad.status, 200);
  assert.deepEqual(bad.body, { source: null, source_verdict: "bad" });
  assert.deepEqual(row("a"), { source: null, source_verdict: "bad", source_rejected: "A formula." });
  const undo = await verdict("a", null);
  assert.deepEqual(undo.body, { source: "A formula.", source_verdict: null });
  assert.deepEqual(row("a"), { source: "A formula.", source_verdict: null, source_rejected: null });
});

test("yes is kept; a card with no passage, a bad verdict and another user's card are refused", async () => {
  assert.deepEqual((await verdict("b", "good")).body, { source: "The bootstrap is a general tool.", source_verdict: "good" });
  assert.equal((await verdict("n", "bad")).status, 409);
  assert.equal((await verdict("b", "maybe")).status, 400);
  assert.equal((await verdict("x", "bad")).status, 404);
  assert.equal(row("x").source, "Theirs.");
});

test("a sync never writes the rejected passage back, and a new one clears the verdict", () => {
  const integrations = fs.readFileSync(path.join(root, "server", "routes", "integrations.js"), "utf8");
  const route = integrations.slice(integrations.indexOf('router.post("/sources"'));
  const handler = route.slice(0, route.indexOf("\n});") + 4);
  const byUnit = [...handler.matchAll(/db\.prepare\(\s*((?:"[^"]*"\s*\+?\s*)+)\)/g)]
    .map((m) => m[1].split(/"\s*\+\s*"/).join("").replace(/^"|"\s*$/g, ""))
    .find((q) => /WHERE external_id = \?/.test(q));
  const send = (text, ext, before = null, after = null) => raw.prepare(byUnit).run([text, text, before, after, null, ext, text, "u1"]).changes;

  raw.exec("UPDATE cards SET source = NULL, source_verdict = 'bad', source_rejected = 'A formula.' WHERE id = 'a'");
  assert.equal(send("A formula.", "s:1"), 0);
  assert.equal(row("a").source, null);
  assert.equal(send("The definition.", "s:1"), 1);
  assert.equal(row("a").source_verdict, null);
  assert.equal(row("a").source, "The definition.");

  raw.exec("UPDATE cards SET source_verdict = 'good' WHERE id = 'b'");
  send("The bootstrap is a general tool.", "s:2");
  assert.equal(row("b").source_verdict, "good");
  send("A rewritten passage.", "s:2");
  assert.equal(row("b").source_verdict, null);
});

test("KnowledgeApp reads the passage judged and the answer with each card", () => {
  const integrations = fs.readFileSync(path.join(root, "server", "routes", "integrations.js"), "utf8");
  assert.match(integrations, /ca\.source, ca\.source_verdict, ca\.source_rejected/);
  assert.match(integrations, /source_feedback: r\.source_verdict === "bad" && r\.source_rejected \? \{ verdict: "bad", text: r\.source_rejected \}/);
  assert.match(fs.readFileSync(path.join(root, "server", "db.js"), "utf8"), /ALTER TABLE cards ADD COLUMN source_rejected TEXT/);
});

// The panel row, run from client/app.js with a fake DOM.
const appJs = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
function extract(name) {
  const start = appJs.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return appJs.slice(start, appJs.indexOf("\n}\n", start) + 3);
}
function fakeEl() {
  const classes = new Set();
  return { innerHTML: "", className: "", listeners: {},
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    addEventListener(type, fn) { this.listeners[type] = fn; } };
}
const ctx = { t: (k) => k, escHtml: (s) => String(s), document: { createElement: fakeEl }, setTimeout: (fn) => fn(), sent: [] };
vm.createContext(ctx);
vm.runInContext(extract("sourceFeedback"), ctx);
const click = (row, v) => row.listeners.click({ target: { closest: () => ({ dataset: { v } }) } });

test("the row hides the passage on doesn't match, offers undo, and is not shown once judged good", async () => {
  ctx.store = { sourceFeedback: (id, v) => { ctx.sent.push([id, v]); return Promise.resolve({ source: v === "bad" ? null : "P", source_verdict: v }); } };
  const card = { id: "a", source: "P" }, body = fakeEl();
  const row = ctx.sourceFeedback(card, body);
  assert.match(row.innerHTML, /study\.sourceAsk/);
  click(row, "bad");
  assert.ok(body.classList.contains("hidden"));
  await new Promise((r) => setImmediate(r));
  assert.match(row.innerHTML, /study\.sourceUndo/);
  assert.equal(card.source, null);
  click(row, "undo");
  await new Promise((r) => setImmediate(r));
  assert.ok(!body.classList.contains("hidden"));
  assert.deepEqual(ctx.sent, [["a", "bad"], ["a", null]]);
  assert.equal(ctx.sourceFeedback({ id: "b", source: "P", source_verdict: "good" }, fakeEl()), null);
  ctx.store = {};
  assert.equal(ctx.sourceFeedback({ id: "c", source: "P" }, fakeEl()), null);
});

test("both places that show a passage ask about it", () => {
  assert.match(extract("sourcePanel"), /var ask = sourceFeedback\(card, body\);/);
  assert.match(extract("whyPanel"), /sourceFeedback\(card, el\.querySelector\("#fc-why-source"\)\)/);
});

test("a passage arrives with the book's text either side, and a resend without it clears it", () => {
  const integrations = fs.readFileSync(path.join(root, "server", "routes", "integrations.js"), "utf8");
  const route = integrations.slice(integrations.indexOf('router.post("/sources"'));
  const handler = route.slice(0, route.indexOf("\n});") + 4);
  const byUnit = [...handler.matchAll(/db\.prepare\(\s*((?:"[^"]*"\s*\+?\s*)+)\)/g)]
    .map((m) => m[1].split(/"\s*\+\s*"/).join("").replace(/^"|"\s*$/g, ""))
    .find((q) => /WHERE external_id = \?/.test(q));
  raw.prepare(byUnit).run(["Core.", "Core.", "Before it.", "After it.", null, "s:2", "Core.", "u1"]);
  assert.deepEqual(db.prepare("SELECT source_before, source_after FROM cards WHERE id = 'b'").get(),
    { source_before: "Before it.", source_after: "After it." });
  assert.match(handler, /ctx\(s\.before\), ctx\(s\.after\)/);
  assert.match(handler, /\[s\.before, s\.after\]\.some/);
});

test("another book's passage is stored with the card, and a resend without it clears it", () => {
  const integrations = fs.readFileSync(path.join(root, "server", "routes", "integrations.js"), "utf8");
  const route = integrations.slice(integrations.indexOf('router.post("/sources"'));
  const handler = route.slice(0, route.indexOf("\n});") + 4);
  const byUnit = [...handler.matchAll(/db\.prepare\(\s*((?:"[^"]*"\s*\+?\s*)+)\)/g)]
    .map((m) => m[1].split(/"\s*\+\s*"/).join("").replace(/^"|"\s*$/g, ""))
    .find((q) => /WHERE external_id = \?/.test(q));
  const related = JSON.stringify([{ book: "Operations Research", text: "Theirs." }]);
  raw.prepare(byUnit).run(["Core.", "Core.", null, null, related, "s:2", "Core.", "u1"]);
  assert.equal(db.prepare("SELECT source_related FROM cards WHERE id = 'b'").get().source_related, related);
  raw.prepare(byUnit).run(["Core.", "Core.", null, null, null, "s:2", "Core.", "u1"]);
  assert.equal(db.prepare("SELECT source_related FROM cards WHERE id = 'b'").get().source_related, null);
  // at most three books, each {book, text} within the limits, or the whole batch is refused
  assert.match(handler, /s\.related\.length > MAX_RELATED/);
  assert.match(handler, /typeof r\.book === "string" && r\.book\.trim\(\) && r\.book\.length <= MAX_BOOK_NAME/);
  assert.match(fs.readFileSync(path.join(root, "server", "db.js"), "utf8"), /ALTER TABLE cards ADD COLUMN source_related TEXT/);
});
