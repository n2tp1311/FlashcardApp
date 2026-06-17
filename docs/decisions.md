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
