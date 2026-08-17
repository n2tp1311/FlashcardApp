"use strict";

// Splits `ids` into chunks and invokes `run(chunk)` once per chunk — SQLite has a
// per-statement bound-variable cap, so a single unchunked `IN (...ids)` query can
// overflow it for a large or user-controlled id array. Second occurrence of this
// exact loop (server/routes/cards.js, server/routes/share.js) is what justified
// pulling it out — see docs/decisions.md.
const BATCH_SIZE = 500;

function forEachBatch(ids, run) {
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    run(ids.slice(i, i + BATCH_SIZE));
  }
}

module.exports = { forEachBatch, BATCH_SIZE };
