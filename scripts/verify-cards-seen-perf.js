"use strict";

// Standalone verification for the POST /api/cards/seen batch-upsert fix.
//
// Spins up an isolated in-memory-ish SQLite file (via a temp data dir, same
// node-sqlite3-wasm engine used in production) with 150 cards for a single user,
// then exercises the exact upsert logic used in server/routes/cards.js against
// all 150 card IDs and asserts:
//   1. every card_states row got last_seen_at set
//   2. the whole batch completed in well under 500ms (vs. ~180s previously,
//      when it ran one INSERT...ON CONFLICT per card sequentially)
//
// Run with: node scripts/verify-cards-seen-perf.js

const os   = require("os");
const fs   = require("fs");
const path = require("path");
const { Database } = require("node-sqlite3-wasm");

const CARD_COUNT   = 150;
const TIME_BUDGET_MS = 500;
const SEEN_BATCH_SIZE = 500;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cards-seen-perf-"));
const db = new Database(path.join(tmpDir, "test.db"));

db.exec(`
  CREATE TABLE card_states (
    card_id    TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    known      INTEGER,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_seen_at INTEGER,
    PRIMARY KEY (card_id, user_id)
  );
`);

const userId = "user-1";
const cardIds = [];
for (let i = 0; i < CARD_COUNT; i++) cardIds.push("card-" + i);

// Mirrors the batched upsert added to server/routes/cards.js
function batchUpsert(ids) {
  db.exec("BEGIN");
  try {
    for (let i = 0; i < ids.length; i += SEEN_BATCH_SIZE) {
      const chunk = ids.slice(i, i + SEEN_BATCH_SIZE);
      const values = chunk.map(() => "(?, ?, unixepoch())").join(", ");
      const params = [];
      chunk.forEach(id => { params.push(id, userId); });
      db.prepare(
        `INSERT INTO card_states (card_id, user_id, last_seen_at) VALUES ${values} ` +
        "ON CONFLICT(card_id, user_id) DO UPDATE SET last_seen_at = unixepoch()"
      ).run(params);
    }
  } finally {
    db.exec("COMMIT");
  }
}

const start = Date.now();
batchUpsert(cardIds);
const elapsedMs = Date.now() - start;

const rows = db.prepare("SELECT card_id, last_seen_at FROM card_states WHERE user_id = ?").all([userId]);

let ok = true;

if (rows.length !== CARD_COUNT) {
  ok = false;
  console.error(`FAIL: expected ${CARD_COUNT} card_states rows, got ${rows.length}`);
}
if (rows.some(r => !r.last_seen_at)) {
  ok = false;
  console.error("FAIL: some rows are missing last_seen_at");
}
if (elapsedMs >= TIME_BUDGET_MS) {
  ok = false;
  console.error(`FAIL: batch upsert took ${elapsedMs}ms, expected < ${TIME_BUDGET_MS}ms`);
}

db.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

if (!ok) {
  process.exit(1);
}

console.log(`OK: upserted last_seen_at for ${CARD_COUNT} cards in ${elapsedMs}ms (budget: ${TIME_BUDGET_MS}ms)`);
