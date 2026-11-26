"use strict";
// "Related cards" on a flashcard's back: the cards a card builds on (cards.needs) and the
// cards in its class that build on it, from GET /cards/:id/related, folded behind one button.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const express = require("express");
const { Database } = require("node-sqlite3-wasm");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const raw = new Database();
const _prepare = raw.prepare.bind(raw);
const db = {
  exec: (sql) => raw.exec(sql),
  transaction: (fn) => () => fn(),
  prepare(sql) {
    const stmt = _prepare(sql);
    const arg = (a) => (a.length === 0 ? [] : a.length === 1 ? a[0] : a);
    return { run: (...a) => stmt.run(arg(a)), get: (...a) => stmt.get(arg(a)), all: (...a) => stmt.all(arg(a)) };
  }
};
const now = Math.floor(Date.now() / 1000);
raw.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, preferences TEXT, fsrs_model TEXT, fsrs_last_fit TEXT);
  CREATE TABLE classes (id TEXT PRIMARY KEY, user_id TEXT);
  CREATE TABLE lessons (id TEXT PRIMARY KEY, class_id TEXT, sort_order INTEGER DEFAULT 0);
  CREATE TABLE cards (id TEXT PRIMARY KEY, lesson_id TEXT, external_id TEXT, format TEXT, data TEXT, needs TEXT,
    sort_order INTEGER DEFAULT 0, created_at INTEGER DEFAULT 0);
  CREATE TABLE card_states (card_id TEXT, user_id TEXT, srs_due_at INTEGER, fsrs_state INTEGER);
  INSERT INTO users (id) VALUES ('u1'), ('u2');
  INSERT INTO classes VALUES ('k1', 'u1'), ('k2', 'u1'), ('x', 'u2');
  INSERT INTO lessons VALUES ('L1', 'k1', 0), ('L2', 'k1', 1), ('M1', 'k2', 0), ('X1', 'x', 0);
  INSERT INTO cards (id, lesson_id, external_id, format, data, needs, sort_order) VALUES
    ('es', 'L1', 's:1', 'term-def', '{"term":"Early Stopping","def":"Halts training."}', NULL, 0),
    ('pat', 'L1', 's:2', 'term-def', '{"term":"Patience","def":"Intervals allowed."}', NULL, 1),
    ('ret', 'L2', 's:3', 'term-def', '{"term":"Retraining","def":"Uses all data."}', '["s:2","s:1","s:99"]', 0),
    ('sur', 'L1', 's:4', 'term-def', '{"term":"Surrogate loss","def":"Mismatch."}', '["s:1"]', 2),
    ('s12', 'L1', 's:12', 'term-def', '{"term":"Twelve","def":"d"}', '["s:12x","s:12"]', 3),
    ('elsewhere', 'M1', 's:5', 'term-def', '{"term":"Another class","def":"d"}', '["s:1"]', 0),
    ('mine', 'L1', NULL, 'term-def', '{"term":"My own card","def":"d"}', NULL, 9),
    ('theirs', 'X1', 's:1', 'term-def', '{"term":"t","def":"d"}', NULL, 0);
  INSERT INTO card_states VALUES ('es', 'u1', ${now + 86400 * 30}, 2), ('pat', 'u1', ${now - 60}, 2);
`);

function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub("server/db.js", db);
stub("server/middleware/auth.js", { requireAuth(req, res, next) { req.session = { userId: req.get("x-user") }; next(); } });
const app = express();
app.use(express.json());
app.use("/api", require(path.join(root, "server/routes/cards.js")));
app.use(express.static(path.join(root, "client")));
let base, server, browser;
test.before(async () => {
  await new Promise((ok) => { server = app.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + server.address().port; ok(); }); });
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { if (browser) await browser.close(); server.close(); });
const get = async (id, user = "u1") => {
  const r = await fetch(base + "/api/cards/" + id + "/related", { headers: { "x-user": user } });
  return { status: r.status, body: await r.json() };
};
const terms = (list) => list.map((c) => c.data.term);

test("builds on: the card's own list, in the order sent, from its class; weak only once studied", async () => {
  const { status, body } = await get("ret");
  assert.equal(status, 200);
  assert.deepEqual(body.builds_on.map((c) => [c.id, c.weak]), [["pat", true], ["es", false]], "due again, and known");
  assert.deepEqual((await get("sur")).body.builds_on.map((c) => c.weak), [false]);
  raw.exec("DELETE FROM card_states WHERE card_id = 'es'");
  try {
    assert.deepEqual((await get("ret")).body.builds_on.map((c) => c.weak), [true, false], "never studied is not tagged");
  } finally { raw.exec(`INSERT INTO card_states VALUES ('es', 'u1', ${now + 86400 * 30}, 2)`); }
  assert.deepEqual(body.used_in, []);
  assert.equal(body.used_in_total, 0);
});

test("used in: the cards in the same class that name it, in study order, never another class's", async () => {
  const { body } = await get("es");
  assert.deepEqual(terms(body.used_in), ["Surrogate loss", "Retraining"], "lesson order, then card order");
  assert.equal(body.used_in_total, 2);
  assert.deepEqual(body.builds_on, []);
});

test("an id is matched whole, a card never lists itself, and other people's cards stay hidden", async () => {
  const twelve = await get("s12");
  assert.deepEqual(twelve.body.used_in, [], "its own list naming itself is not a link");
  assert.deepEqual(twelve.body.builds_on, []);
  const own = await get("mine");
  assert.deepEqual(own.body, { builds_on: [], used_in: [], used_in_total: 0 }, "a card of the learner's own has no links");
  assert.equal((await get("theirs")).status, 404);
  assert.equal((await get("es", "u2")).status, 404);
});

test("a card many build on returns the first few and the total", async () => {
  const extra = [];
  for (let i = 0; i < 8; i++) extra.push(`('m${i}', 'L2', 'm:${i}', 'term-def', '{"term":"M${i}","def":"d"}', '["s:2"]', ${10 + i})`);
  raw.exec("INSERT INTO cards (id, lesson_id, external_id, format, data, needs, sort_order) VALUES " + extra.join(","));
  try {
    const { body } = await get("pat");
    assert.equal(body.used_in.length, 5);
    assert.equal(body.used_in_total, 9);
    assert.equal(body.used_in[0].data.term, "Retraining");
  } finally { raw.exec("DELETE FROM cards WHERE id LIKE 'm%'"); }
});

for (const lang of ["en", "vi"]) {
  test("the button counts both kinds, opens the list, and each row opens its definition (" + lang + ")", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(base + "/");
      await page.waitForFunction(() => typeof window.relatedPanel === "function");
      const out = await page.evaluate((lang) => {
        applyLanguage(lang);
        const none = relatedPanel({ builds_on: [], used_in: [], used_in_total: 0 });
        const el = relatedPanel({
          builds_on: [{ id: "pat", data: { term: "Patience", def: "Intervals <b>allowed</b>." }, weak: true },
                      { id: "es", data: { term: "Early Stopping", def: "Halts training." }, weak: false }],
          used_in: [{ id: "sur", data: { term: "Surrogate loss", def: "Mismatch." } }],
          used_in_total: 4 });
        document.body.appendChild(el);
        const btn = el.querySelector("#btn-fc-related"), list = el.querySelector("#fc-related-list");
        const r = { none, label: btn.textContent, hiddenAtFirst: list.classList.contains("hidden") };
        btn.click();
        r.open = !list.classList.contains("hidden");
        r.openLabel = btn.textContent;
        const rows = [...list.querySelectorAll(".related-row")];
        r.rows = rows.map((x) => x.querySelector(".related-head").textContent);
        r.more = list.querySelector(".related-more").textContent;
        r.defHidden = rows[0].querySelector(".related-def").classList.contains("hidden");
        rows[0].click();
        r.def = rows[0].querySelector(".related-def").textContent;
        r.defShown = !rows[0].querySelector(".related-def").classList.contains("hidden");
        r.noMarkup = !rows[0].querySelector("b");
        return r;
      }, lang);
      assert.equal(out.none, null, "no links, no button");
      assert.equal(out.label, lang === "en" ? "Related cards · 6" : "Thẻ liên quan · 6", "the 2 it builds on and all 4 that use it, not only the one shown");
      assert.ok(out.hiddenAtFirst && out.open);
      assert.equal(out.openLabel, lang === "en" ? "Hide related cards" : "Ẩn thẻ liên quan");
      assert.deepEqual(out.rows, lang === "en"
        ? ["Patience · still learningbuilds on", "Early Stoppingbuilds on", "Surrogate lossused in"]
        : ["Patience · đang họcdựa trên", "Early Stoppingdựa trên", "Surrogate lossđược dùng trong"]);
      assert.equal(out.more, lang === "en" ? "and 3 more cards use this one" : "và 3 thẻ khác dùng thẻ này");
      assert.ok(out.defHidden && out.defShown);
      assert.equal(out.def, "Intervals <b>allowed</b>.", "a definition is text, never markup");
      assert.ok(out.noMarkup);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}

test("looked up for KnowledgeApp cards on the flashcard back only, and dropped if the card has moved on", () => {
  const app = require("fs").readFileSync(path.join(root, "client", "app.js"), "utf8");
  assert.match(app, /if \(!isGapfill\) loadRelatedCards\(card, i\);/);
  const fn = app.slice(app.indexOf("\nfunction loadRelatedCards("), app.indexOf("\nfunction relatedPanel("));
  assert.match(fn, /!card\.external_id\) return;/);
  assert.match(fn, /state\.studyCards\[state\.studyIndex\] !== card/);
  assert.match(fn, /exp\.classList\.toggle\("hidden", !state\.studyFlipped\)/);
});
