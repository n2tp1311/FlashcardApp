# Decision Log

## 2026-06-18 — SQLite via node-sqlite3-wasm
Use WASM-based SQLite (no native build) for Railway compatibility. Downside: async init. Lock file `flashcards.db.lock` removed on startup to survive container restarts.

## 2026-06-18 — Sessions via express-session + MemoryStore
Simple session approach for single-instance Railway deployment. If horizontal scaling is needed, switch to connect-sqlite3 or Redis-backed store.

## 2026-06-18 — Google OAuth without passport
Implemented raw OAuth2 code-exchange to avoid passport setup complexity. fetch() to Google token and userinfo endpoints directly.

## 2026-06-18 — Spaced repetition intervals
Simple fixed intervals based on quiz score: ≥90% → 7d, ≥70% → 3d, ≥50% → 1d, <50% → 4h. Stored in quiz_sessions table.

## 2026-06-18 — Progressive difficulty via weighted shuffle
Hard cards (blended error ≥0.6) appear 3× in weighted pool, medium (0.3–0.6) 2×, easy/new 1×. Deduplication after shuffle preserves front-loading effect.

## 2026-06-18 — Interleaved study as default for multi-lesson sessions
When 2+ lessons are selected, cards from all lessons are pooled and shuffled together (interleaved) by default rather than completing each lesson in sequence (blocked). Backed by learning science: a 2024 *Learning and Instruction* study confirmed interleaved practice produces more durable retention than blocked practice. Users can switch to Blocked via a "Card Order" pill on the setup screen. The pill is hidden for single-lesson sessions where the distinction is moot.

## 2026-06-18 — Confidence-Based Repetition (CBR) deferred
CBR (1–5 post-answer confidence rating modulates next review interval) was researched and found to have solid evidence for improving long-term recall. Decision: deferred. The per-card rating UI felt too intensive in user testing — it interrupts the study flow on every card. Will revisit if users request finer-grained spaced repetition control.

## 2026-06-18 — FSRS algorithm skipped for now
FSRS (Free Spaced Repetition Scheduler) achieves 20–30% fewer reviews than SM-2 for the same 90% retention target. An open-source JS library is available. Decision: skipped for now. The existing fixed-interval scheduler (score-based: ≥90% → 7d, ≥70% → 3d, etc.) is good enough for the current user base. FSRS can be added as a future enhancement without changing the quiz flow — only the interval-calculation step changes.

## 2026-06-18 — Modal architecture fix: scope closeAllModals to overlay container
`closeAllModals()` was calling `document.querySelectorAll(".modal")`, which also matched inner divs inside `#modal-share` and `#modal-prompt-guide` (those overlays contain child elements that also carry the `.modal` class). This caused closing any modal to blank-screen those overlays. Fixed by scoping the selector to `"#modal-overlay .modal"` so only the primary overlay's modal content is targeted. Also added an explicit `.modal` classList `.remove("hidden")` guard inside `openShareModal()` and the prompt-guide opener as a defensive reset against stale state.

## 2026-06-18 — Dev reset token hidden in production
`POST /api/auth/forgot-password` was returning `_devResetUrl` in the JSON response unconditionally, allowing anyone to grab a password-reset token without SMTP access. Fixed: the field is now only included when `NODE_ENV !== "production"`. In production without SMTP configured, the endpoint returns `{ok:true}` with no token exposed, and the reset email is silently dropped (no SMTP = no email sent, user experience unchanged).

## 2026-06-18 — Multi-agent development workflow adopted
Established a three-role agent loop: Planner (Plan subagent) produces step-by-step implementation specs; Executor (main Claude session) implements them; Reviewer (general-purpose subagent) audits the diff for correctness and security. A fourth Research agent (general-purpose with WebSearch) is spun up on-demand for evidence gathering. This separation prevents context contamination between planning and implementation and gives each role a clean starting point.
