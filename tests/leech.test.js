"use strict";
// Leeches: a card forgotten 8 times since its text last changed is flagged, the answer that
// crosses the line says so once, an edit starts the count again, and a linked card can be
// queued for KnowledgeApp to rewrite.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const express = require("express");

const root = path.join(__dirname, "..");
const dbFile = path.join(root, "server", "db.js");

// The real schema and migrations, in memory: db.js opens data/flashcards.db and clears its
// lock, which must not touch a running dev server's database.
const realLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent && parent.filename === dbFile) {
    if (request === "node-sqlite3-wasm") {
      const { Database } = realLoad.call(this, request, parent, isMain);
      return { Database: class extends Database { constructor() { super(); } } };
    }
    if (request === "fs") return { ...fs, rmSync() {}, mkdirSync() {}, existsSync: () => true };
  }
  return realLoad.call(this, request, parent, isMain);
};
const db = require(dbFile);
Module._load = realLoad;

function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub("server/middleware/auth.js", {
  requireAuth(req, res, next) { req.session = { userId: req.get("x-user") }; next(); }
});
stub("server/middleware/apiToken.js", {
  requireApiToken(req, res, next) { req.userId = req.get("x-user"); next(); },
  hashToken: (t) => t
});
const { LEECH_LAPSES, isLeech } = require(path.join(root, "server/lib/leech.js"));

const server = express();
server.use(express.json());
server.use("/api/integrations/knowledge", require(path.join(root, "server/routes/integrations.js")));
server.use("/api", require(path.join(root, "server/routes/cards.js")));
server.use("/api/attempts", require(path.join(root, "server/routes/attempts.js")));

db.exec(`
  INSERT INTO users (id, email, name) VALUES ('u1', 'a@x', 'A'), ('u2', 'b@x', 'B');
  INSERT INTO classes (id, user_id, name) VALUES ('k1', 'u1', 'Stats'), ('k2', 'u2', 'Other');
  INSERT INTO lessons (id, class_id, title, format) VALUES ('l1', 'k1', 'Ch 1', 'term-def'), ('l2', 'k2', 'X', 'term-def');
  INSERT INTO cards (id, lesson_id, format, data, external_id) VALUES
    ('c1', 'l1', 'term-def', '{"term":"Bayes","def":"P(A|B) = P(B|A)P(A)/P(B)"}', 'book:u1'),
    ('c2', 'l1', 'term-def', '{"term":"Mine","def":"typed by hand"}', NULL),
    ('c3', 'l2', 'term-def', '{"term":"Theirs","def":"not yours"}', 'book:u3');
`);

let base, listener;
test.before(() => new Promise((ok) => { listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); }); }));
test.after(() => listener.close());

async function call(method, url, body, user = "u1") {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-user": user }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

function setState(cardId, lapses, base) {
  db.prepare("DELETE FROM card_states WHERE card_id = ?").run(cardId);
  db.prepare(
    "INSERT INTO card_states (card_id, user_id, srs_due_at, fsrs_stability, fsrs_difficulty, fsrs_state, fsrs_reps, fsrs_lapses, fsrs_learning_steps, fsrs_last_review_at, leech_base) " +
    "VALUES (?, 'u1', ?, 3, 7, 2, 20, ?, 0, ?, ?)"
  ).run(cardId, Math.floor(Date.now() / 1000) - 60, lapses, Math.floor(Date.now() / 1000) - 86400 * 3, base);
}

const state = (cardId) => db.prepare("SELECT fsrs_lapses, leech_base FROM card_states WHERE card_id = ?").get(cardId);
const lessonCard = async (id) => (await call("GET", "/api/lessons/l1/cards")).body.find(c => c.id === id);

test("the threshold counts lapses since the last edit", function() {
  assert.equal(LEECH_LAPSES, 8);
  assert.equal(isLeech({ fsrs_lapses: 8, leech_base: 0 }), true);
  assert.equal(isLeech({ fsrs_lapses: 11, leech_base: 4 }), false);
  assert.equal(isLeech({ fsrs_lapses: 2, leech_base: 5 }), false, "an undo below the base is not negative");
  assert.equal(isLeech(null), false);
});

test("the answer that makes the eighth lapse reports became_leech, and only that one", async function() {
  setState("c1", 7, 0);
  const miss = await call("POST", "/api/attempts", { cardId: "c1", correct: false, source: "flashcard", grade: "again" });
  assert.equal(miss.status, 201);
  assert.equal(miss.body.became_leech, true, JSON.stringify(miss.body));
  assert.equal(miss.body.lapses, 8);
  const card = await lessonCard("c1");
  assert.equal(card.is_leech, true);
  assert.equal(card.leech_lapses, 8);

  setState("c1", 8, 0);
  const again = await call("POST", "/api/attempts", { cardId: "c1", correct: false, source: "flashcard", grade: "again" });
  assert.equal(again.body.became_leech, false, "past the line it does not ask again");
});

test("a hit on a card at seven lapses does not make it a leech", async function() {
  setState("c1", 7, 0);
  const hit = await call("POST", "/api/attempts", { cardId: "c1", correct: true, source: "flashcard", grade: "good" });
  assert.equal(hit.body.became_leech, false);
  assert.equal((await lessonCard("c1")).is_leech, false);
});

test("editing the card text starts the count again and drops a pending rewrite", async function() {
  setState("c1", 9, 0);
  assert.equal((await call("POST", "/api/cards/c1/rewrite-request")).status, 201);
  assert.equal((await lessonCard("c1")).rewrite_pending, true);

  await call("PUT", "/api/cards/c1", { sort_order: 3 });
  assert.equal(state("c1").leech_base, 0, "reordering is not an edit");

  await call("PUT", "/api/cards/c1", { data: { term: "Bayes' rule", def: "posterior ∝ likelihood × prior" } });
  assert.deepEqual(state("c1"), { fsrs_lapses: 9, leech_base: 9 });
  const card = await lessonCard("c1");
  assert.equal(card.is_leech, false);
  assert.equal(card.rewrite_pending, false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM rewrite_requests WHERE card_id = 'c1'").get().n, 0);
});

test("a rewrite request needs a linked card of the user's own, and asking twice keeps one", async function() {
  setState("c1", 8, 0);
  const first = await call("POST", "/api/cards/c1/rewrite-request");
  const second = await call("POST", "/api/cards/c1/rewrite-request");
  assert.equal(second.body.id, first.body.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM rewrite_requests WHERE card_id = 'c1' AND status = 'pending'").get().n, 1);
  assert.equal((await call("POST", "/api/cards/c2/rewrite-request")).status, 409);
  assert.equal((await call("POST", "/api/cards/c3/rewrite-request")).status, 404);
});

test("KnowledgeApp reads the queue with the current text, sends the rewrite as a sync event, then completes", async function() {
  const queue = await call("GET", "/api/integrations/knowledge/rewrites");
  assert.equal(queue.status, 200);
  assert.equal(queue.body.requests.length, 1);
  const req = queue.body.requests[0];
  assert.equal(req.external_id, "book:u1");
  assert.equal(req.term, "Bayes' rule");
  assert.equal(req.lapses, 8);
  assert.equal((await call("GET", "/api/integrations/knowledge/rewrites", null, "u2")).body.requests.length, 0);

  const ev = await call("POST", "/api/integrations/knowledge/events", {
    events: [{ id: "e1", type: "updated", external_id: "book:u1", term: "Bayes' rule", def: "Flip a conditional: P(A|B) from P(B|A)." }]
  });
  assert.equal(ev.status, 200, JSON.stringify(ev.body));
  assert.equal(state("c1").leech_base, 8, "the rewritten card starts clean");

  assert.equal((await call("POST", "/api/integrations/knowledge/rewrites/" + req.id + "/complete", { outcome: "nope" })).status, 400);
  assert.equal((await call("POST", "/api/integrations/knowledge/rewrites/" + req.id + "/complete", { outcome: "rewritten" }, "u2")).status, 404);
  const done = await call("POST", "/api/integrations/knowledge/rewrites/" + req.id + "/complete", { outcome: "rewritten" });
  assert.deepEqual(done.body, { status: "completed", outcome: "rewritten" });
  assert.equal((await call("POST", "/api/integrations/knowledge/rewrites/" + req.id + "/complete", { outcome: "unchanged" })).body.status, "already");
  assert.equal((await call("GET", "/api/integrations/knowledge/rewrites")).body.requests.length, 0);
  assert.equal((await lessonCard("c1")).rewrite_pending, false);
});

// --- Client ---
const vm = require("vm");
const appJs = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
function extract(name) {
  const start = appJs.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return appJs.slice(start, appJs.indexOf("\n}\n", start) + 3);
}

test("the Leeches filter studies only flagged cards", function() {
  const ctx = { applyReviewCap: (c) => c };
  vm.createContext(ctx);
  vm.runInContext(extract("filterCardsBySetup"), ctx);
  const cards = [{ id: "a", is_leech: true }, { id: "b", is_leech: false }, { id: "c" }];
  assert.deepEqual(ctx.filterCardsBySetup(cards, "leeches", {}, {}, 0).map(c => c.id), ["a"]);
});

test("the card list tag says how often, turns into Rewrite requested, and escapes the id", function() {
  const ctx = { t: (k, p) => k + (p ? ":" + p.n : ""), escHtml: (s) => String(s).replace(/</g, "&lt;").replace(/"/g, "&quot;") };
  vm.createContext(ctx);
  vm.runInContext(extract("leechPillHtml"), ctx);
  assert.equal(ctx.leechPillHtml({ id: "a", is_leech: false }), "");
  assert.match(ctx.leechPillHtml({ id: "a", is_leech: true, leech_lapses: 9 }), /class="leech-pill" data-card-leech="a"[^>]*>leech\.tagCount:9</);
  assert.match(ctx.leechPillHtml({ id: "a", is_leech: true, rewrite_pending: true }), /leech-pill is-pending[^>]*>leech\.rewriteRequested</);
  assert.ok(!ctx.leechPillHtml({ id: '"><img>', is_leech: true }).includes('"><img>'));
});

test("both answer paths offer the prompt, the edit clears the flag in the session, and the filter is server-only", function() {
  assert.equal(appJs.split("offerLeech(card, res);").length - 1, 2);
  assert.match(extract("syncEditedCardIntoStudySession"), /clearLeech\(fcCard\)[\s\S]*clearLeech\(quizCard\)/);
  assert.match(appJs, /"setup-filter-updated", "setup-filter-leeches"/);
  assert.match(appJs, /leeches: +"setup\.hintLeeches"/);
  assert.match(indexHtml, /id="modal-leech"/);
  assert.match(indexHtml, /data-value="leeches"/);
  assert.doesNotMatch(indexHtml, /leech[^\n]*[Ss]uspend/, "the user chose tag only");
  for (const k of ["setup.leeches", "setup.hintLeeches", "leech.tag", "leech.tagCount", "leech.tooltip", "leech.rewriteRequested",
                   "leech.rewriteRequestedTooltip", "leech.title", "leech.body", "leech.editCard", "leech.askRewrite",
                   "leech.rewriteAlreadyRequested", "leech.keepStudying", "toast.rewriteRequested"]) {
    assert.equal(appJs.split('"' + k + '":').length - 1, 2, k);
  }
});

test("the prompt fits a phone: every action on screen and none clipped", async function() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
    await page.route("**/*.js", (r) => r.abort());
    await page.goto("file://" + path.join(root, "client", "index.html"));
    // index.html links /style.css, which a file:// page cannot resolve.
    await page.addStyleTag({ path: path.join(root, "client", "style.css") });
    const r = await page.evaluate(function() {
      document.getElementById("modal-overlay").classList.remove("hidden");
      document.getElementById("modal-leech").classList.remove("hidden");
      document.getElementById("btn-leech-rewrite").classList.remove("hidden");
      document.getElementById("leech-card-term").textContent = "Affine set";
      document.getElementById("leech-body").textContent = "You've forgotten it 8 times. Reviewing it again rarely helps.";
      return Array.from(document.querySelectorAll("#modal-leech .modal-footer .btn")).map(function(b) {
        const x = b.getBoundingClientRect();
        return { left: x.left, right: x.right, bottom: x.bottom, w: x.width, sw: b.scrollWidth, cw: b.clientWidth };
      });
    });
    assert.equal(r.length, 3);
    for (const b of r) {
      assert.ok(b.left >= 0 && b.right <= 360 && b.bottom <= 640, JSON.stringify(r));
      assert.ok(b.sw <= b.cw + 1, "label clipped: " + JSON.stringify(b));
    }
  } finally {
    await browser.close();
  }
});
