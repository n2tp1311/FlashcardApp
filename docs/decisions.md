# Decision Log

## 2026-06-18 — SQLite via node-sqlite3-wasm
Use WASM-based SQLite (no native build) for Railway compatibility. Downside: async init. Lock file `flashcards.db.lock` removed on startup to survive container restarts.

## 2026-06-23 — Sessions migrated from MemoryStore to SQLiteSessionStore
MemoryStore is cleared on every Railway container restart, forcing re-login on mobile rotation (which triggers a reload). Replaced with a custom `SQLiteSessionStore` (server/sessionStore.js) that writes to the existing SQLite DB using a `sessions` table. The store implements only `get/set/destroy/touch` — the minimum express-session contract. A 24-hour `setInterval` sweeps expired rows. No external dependency needed since node-sqlite3-wasm is already bundled.

## 2026-06-23 — Screen state persisted via localStorage key fc-last-screen
The SPA had no URL routing — page refresh always landed on home. Added `saveScreenState()` called at navigation points (openClass, openLesson, back buttons) and `restoreLastScreen()` called on init/login/register. Only home/class/lesson are persisted; transient screens (study, quiz, flashcard) are not. Stale entries for deleted entities fall back to home via the `.catch()` path. The key is cleared on logout and on fresh registration to prevent cross-user state bleed.

## 2026-06-18 — Sessions via express-session + MemoryStore (superseded 2026-06-23)
Simple session approach for single-instance Railway deployment. Replaced by SQLiteSessionStore.

## 2026-06-18 — Google OAuth without passport
Implemented raw OAuth2 code-exchange to avoid passport setup complexity. fetch() to Google token and userinfo endpoints directly.

## 2026-06-19 — Per-card SRS step-based intervals (replaces session-level)
Replaced the session-level score-based scheduler with per-card spaced repetition. Each card has its own `srs_step` (0–6) and `srs_due_at` (unix seconds) stored in `card_states`. Correct answer advances the step; wrong resets to 0. Steps map to intervals: 10min → 1h → 4h → 1d → 3d → 7d → 21d. This means a card the user just learned will resurface in 10 minutes, then again in an hour — much faster feedback than the old session-level 4h minimum. Cards are "due" when `srs_due_at <= now`. Due counts surface on class cards, lesson list, and dashboard (grouped by class). Decision: step-based rather than SM-2/FSRS to keep the implementation simple while delivering the core SRS benefit; FSRS remains a future upgrade path.

## 2026-06-18 — Spaced repetition intervals (superseded)
Simple fixed intervals based on quiz score: ≥90% → 7d, ≥70% → 3d, ≥50% → 1d, <50% → 4h. Stored in quiz_sessions table. Replaced 2026-06-19 by per-card step-based intervals.

## 2026-06-18 — Progressive difficulty via weighted shuffle
Hard cards (blended error ≥0.6) appear 3× in weighted pool, medium (0.3–0.6) 2×, easy/new 1×. Deduplication after shuffle preserves front-loading effect.

## 2026-06-18 — Interleaved study as default for multi-lesson sessions
When 2+ lessons are selected, cards from all lessons are pooled and shuffled together (interleaved) by default rather than completing each lesson in sequence (blocked). Backed by learning science: a 2024 *Learning and Instruction* study confirmed interleaved practice produces more durable retention than blocked practice. Users can switch to Blocked via a "Card Order" pill on the setup screen. The pill is hidden for single-lesson sessions where the distinction is moot.

## 2026-06-18 — Confidence-Based Repetition (CBR) deferred
CBR (1–5 post-answer confidence rating modulates next review interval) was researched and found to have solid evidence for improving long-term recall. Decision: deferred. The per-card rating UI felt too intensive in user testing — it interrupts the study flow on every card. Will revisit if users request finer-grained spaced repetition control.

## 2026-06-18 — FSRS algorithm skipped for now
FSRS (Free Spaced Repetition Scheduler) achieves 20–30% fewer reviews than SM-2 for the same 90% retention target. An open-source JS library is available. Decision: skipped for now. The existing fixed-interval scheduler (score-based: ≥90% → 7d, ≥70% → 3d, etc.) is good enough for the current user base. FSRS can be added as a future enhancement without changing the quiz flow — only the interval-calculation step changes.

## 2026-06-23 — Card checkbox change event + item click guard for select mode
In card select mode, a guard `if (e.target.tagName === "INPUT") return` on the item's click listener prevents double-toggling when the user clicks the checkbox (the click would bubble to the item, firing toggleCardSelection twice). However, this alone breaks direct checkbox clicks — the native checkbox state changes but `state.selectedCardIds` doesn't. Fixed by also attaching a `change` event on each card's checkbox that calls `toggleCardSelection`. Result: clicking the item body fires one toggle (via item click); clicking the checkbox fires one toggle (via change); the bubble from checkbox click is suppressed by the guard.

## 2026-06-18 — Modal architecture fix: scope closeAllModals to overlay container
`closeAllModals()` was calling `document.querySelectorAll(".modal")`, which also matched inner divs inside `#modal-share` and `#modal-prompt-guide` (those overlays contain child elements that also carry the `.modal` class). This caused closing any modal to blank-screen those overlays. Fixed by scoping the selector to `"#modal-overlay .modal"` so only the primary overlay's modal content is targeted. Also added an explicit `.modal` classList `.remove("hidden")` guard inside `openShareModal()` and the prompt-guide opener as a defensive reset against stale state.

## 2026-06-18 — Dev reset token hidden in production
`POST /api/auth/forgot-password` was returning `_devResetUrl` in the JSON response unconditionally, allowing anyone to grab a password-reset token without SMTP access. Fixed: the field is now only included when `NODE_ENV !== "production"`. In production without SMTP configured, the endpoint returns `{ok:true}` with no token exposed, and the reset email is silently dropped (no SMTP = no email sent, user experience unchanged).

## 2026-06-19 — Variable MCQ choices: dynamic rows over static 5 fields
MCQ cards now support 1–4 distractors (2–5 total choices) instead of a fixed 3. Two UI approaches were considered: (A) 5 static input fields with the first required and others optional, (B) dynamic rows with add/remove buttons starting from 1. Chose B: MCQ authoring is deliberate, not a fast-input flow, so clean UX (only the fields you need) outweighs the small amount of extra JS. Server validates `distractors.length` is 1–4 on both single and bulk card endpoints. `clearDistractorList()` caps at 4 rows on load to guard against corrupt DB data.

## 2026-06-18 — Multi-agent development workflow adopted
Established a three-role agent loop: Planner (Plan subagent) produces step-by-step implementation specs; Executor (main Claude session) implements them; Reviewer (general-purpose subagent) audits the diff for correctness and security. A fourth Research agent (general-purpose with WebSearch) is spun up on-demand for evidence gathering. This separation prevents context contamination between planning and implementation and gives each role a clean starting point.
