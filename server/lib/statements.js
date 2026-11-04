"use strict";

// Shim: node-sqlite3-wasm requires array binding for multiple params.
// Wrap db.prepare so statements accept spread args like better-sqlite3.
//
// Each call prepares, runs and finalizes its own statement. node-sqlite3-wasm has no
// finalizer: a statement never finalized stays in SQLite until the connection closes, and
// the routes call db.prepare() on every request. Measured: about 2.6 KB each, and every
// later call slows in proportion to how many are open -- 16k left a read at 136 us instead
// of 6, a write at 232 us -- and close() cannot release the database. Re-preparing costs
// about 4 us a call over reusing one statement, which is why there is no cache to manage.
//
// The library's own db.run/get/all call this.prepare() and then finalize() what it
// returns, which the shim's object does not have: on a shimmed connection they run the
// statement and then throw. Use db.prepare(...) or db.exec() instead. The nightly backup
// called db.run() and failed this way every night from 2026-10-14 to 2026-11-04.
function shimPrepare(db) {
  const _prepare = db.prepare.bind(db);
  function toArg(args) {
    if (args.length === 0) return [];
    if (args.length === 1) return args[0];  // single value/array/object → passthrough
    return args;                             // multiple spread args → wrap as array
  }
  db.prepare = function(sql) {
    function once(method, args) {
      const stmt = _prepare(sql);
      try { return stmt[method](toArg(args)); } finally { stmt.finalize(); }
    }
    return {
      run: (...args) => once("run", args),
      get: (...args) => once("get", args),
      all: (...args) => once("all", args),
    };
  };
  return db;
}

module.exports = { shimPrepare };
