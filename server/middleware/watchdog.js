"use strict";

// node-sqlite3-wasm is synchronous, so one heavy call blocks the entire process —
// every concurrent request stalls together (this is what the 2026-08-13 incident's
// Railway graph showed: p50/p90/p95/p99 spiking in lockstep, not one endpoint slowly
// degrading). Railway only checks healthcheckPath while a deploy is rolling out, not
// on an already-live instance, and restartPolicyType only reacts to the process
// actually exiting — a hung-but-alive process is invisible to both. This watchdog
// closes that gap: if the event loop goes unresponsive for too long, force-exit so
// the platform's crash-restart policy takes over instead of staying hung until a
// human notices and restarts it manually.
//
// Can't catch a true infinite loop (this check can't run either if the loop never
// yields) — it catches the "very slow, eventually finishes" case we actually saw.
const CHECK_INTERVAL_MS = 2000;
// `?? ""` then an explicit-empty check rather than `|| 20000` — the latter would
// treat WATCHDOG_MAX_LAG_MS=0 (a valid override, e.g. to test the watchdog fires
// on any detectable lag) as unset and silently fall back to the default.
const envMaxLag = process.env.WATCHDOG_MAX_LAG_MS;
const parsedMaxLag = envMaxLag !== undefined && envMaxLag !== "" ? Number(envMaxLag) : NaN;
const MAX_LAG_MS = Number.isFinite(parsedMaxLag) ? parsedMaxLag : 20000;

function startEventLoopWatchdog() {
  // process.hrtime.bigint() is monotonic — immune to NTP jumps and the host clock
  // stepping/pausing (e.g. a hypervisor live-migration), unlike Date.now(). A wall
  // clock jump measured as "lag" would force-exit a perfectly healthy process,
  // which defeats the point of a reliability mechanism.
  let expected = process.hrtime.bigint() + BigInt(CHECK_INTERVAL_MS) * 1000000n;
  const timer = setInterval(() => {
    const now = process.hrtime.bigint();
    const lagMs = Number(now - expected) / 1000000;
    if (lagMs > MAX_LAG_MS) {
      // process.exit() doesn't wait for pending async writes — stderr is a pipe
      // under Railway, not a TTY, so console.error() followed immediately by exit
      // can drop the line before it flushes. Waiting on the write callback ensures
      // this one log line (the whole reason the watchdog exists) actually lands.
      const msg = `[watchdog] event loop blocked for ~${Math.round(lagMs)}ms (threshold ${MAX_LAG_MS}ms) — exiting so the platform restarts the process\n`;
      process.stderr.write(msg, () => process.exit(1));
    }
    expected = now + BigInt(CHECK_INTERVAL_MS) * 1000000n;
  }, CHECK_INTERVAL_MS);
  timer.unref();
}

module.exports = { startEventLoopWatchdog };
