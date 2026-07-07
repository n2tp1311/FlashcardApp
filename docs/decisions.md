# Decision Log

## 2026-07-07 — Bulk cards: knownMap derived from returned cards instead of separate getKnownMap calls

`getKnownMap(lessonId)` hit `GET /api/lessons/:lessonId/states` which returns only `{card_id: known}` — the new `POST /api/cards/by-lessons` endpoint joins `card_states` and includes `known` in each card row directly. The client derives `knownMap` by iterating the returned cards (`c.known === 1`). This eliminates all N `getKnownMap` calls with no additional server-side cost. Alternative: keep a separate bulk-states endpoint and call it in parallel with bulk-cards — rejected because it added a second request with no benefit since both queries hit the same `card_states` table and the JOIN is the same cost.

## 2026-07-07 — Correlated subquery for last_studied_at replaced with GROUP BY aggregate JOIN

The original `GET /api/lessons/:lessonId/cards` used `(SELECT MAX(created_at) FROM attempts WHERE card_id = cards.id AND user_id = ?) AS last_studied_at` — a correlated subquery that runs once per card. With 100 cards and 3000 attempts, this triggered 100 separate scans of the attempts table. Replaced with `LEFT JOIN (SELECT card_id, MAX(created_at) AS last_studied_at FROM attempts WHERE user_id = ? GROUP BY card_id) la ON la.card_id = cards.id` — a single aggregate pass over attempts, with the result hash-joined once to all cards. The `idx_attempts_cu_created` composite index makes this aggregate nearly free. Applied to both the single-lesson endpoint and the new bulk endpoint.



## 2026-07-03 — Class sort: normalizeLevel helper extracted to prevent POST/PUT divergence

Both POST and PUT `/api/classes` need to coerce the level field (undefined → fallback, null → null, number → Number(val), NaN-string → fallback). The expression was extracted into `normalizeLevel(val, fallback)` in `classes.js` so that future validation changes (e.g., range clamp 1–999, isNaN rejection) are applied in one place. Alternative: inline the expression twice with comments — rejected because it would silently diverge if one site were updated and the other missed.

## 2026-07-03 — Class level: null sorts last (Infinity), not first

Classes with `level=null` are assigned `Infinity` in `sortClasses()` when sorting by level, causing them to sort after all leveled classes, with ties broken by `created_at`. Alternative: sort unlevel'd classes first — rejected because users set levels to promote courses to the top of their list; unlevel'd classes are implicitly "not yet sequenced."

## 2026-07-03 — Preferences localStorage cache updated on save (not just on fetch)

The `btn-save-preferences` handler now writes the new value back to `localStorage` immediately after updating state, before the PUT fetch completes. This ensures that if the user logs out and back in quickly, `loadUserPreferences()` reads the correct cached value synchronously rather than the stale pre-save value. Without this, the stale cache would be applied on the next login until the async fetch resolved.

## 2026-07-02 — Account preferences: localStorage cache to close post-login timing race

`loadUserPreferences()` fires an async fetch on every login/init. `openSetup()` reads `state.tfExpansionPctDefault` synchronously. If the user navigates to the study setup before the fetch resolves (one RTT after login), they see the hardcoded default (20%) instead of their saved value. Fixed by caching the server response in `localStorage` under `fc-preferences` and applying it synchronously at page load before `restoreLastScreen()` runs. The cache is cleared on logout to prevent cross-user bleed. Alternative: make `openSetup` async and await a preferences promise — rejected because it would require refactoring the entire navigation stack.

## 2026-07-02 — Account preferences: PUT uses read-modify-write merge, not full replace

`PUT /api/auth/preferences` reads the current `preferences` JSON column, merges the incoming object over it with `Object.assign`, then writes back. This ensures future preference keys added by new code are not silently deleted when an older client (or a client that only knows about one key) saves. Alternative: send the full preferences object from the client on every save — rejected because the client only knows about the keys it renders in the modal; it cannot preserve server-side keys it is unaware of.

## 2026-07-02 — Recall mode removed

Recall mode (free-recall textarea + three-grade self-assessment) was removed from UI and JS. The DB `source='recall'` value in the `attempts` CHECK constraint was already removed in a prior migration; historical records are preserved. Decision: recall added friction (typing + self-grading) that interrupted study flow and is superseded by MCQ→T/F expansion, which provides a comparable retrieval-practice effect with lower friction.

## 2026-06-28 — MCQ → T/F expansion: virtual cards record SRS against source card ID

When a MCQ card is expanded to T/F sub-questions, the original MCQ card is removed from the deck. To prevent MCQ cards from being permanently frozen at SRS step 0 for users who always study with T/F expansion, each virtual T/F card stores `_sourceCardId` (the original MCQ card's DB id). `answerQuiz` records the attempt using `card._sourceCardId` instead of `card.id`, so the real card's `srs_due_at` and difficulty level continue to advance. Multiple attempts are recorded per expansion (one per T/F sub-question), which is acceptable — the SRS step only advances on the last attempt in the batch. Alternative considered: record one aggregate attempt after all sub-questions for the same source are answered — rejected for complexity.

## 2026-06-28 — True/False: correct stored as lowercase string "true"/"false", displayed as title-case

The T/F answer is stored in the DB as `"true"` or `"false"` (lowercase string) to match the bulk import format (user types `| true`) and the HTML `data-value` attributes. The display layer (`answerQuiz`, `revealRecall`, `renderFlashcard`, `buildQuizOptions`) converts to title-case "True"/"False" at render time. Alternative: store as boolean — rejected because SQLite JSON stores booleans as 0/1, requiring casts in every reader, and the rest of the codebase stores card data as typed strings (MCQ `correct` is a plain string). The conversion is in one place per study mode so maintaining consistency is straightforward.

## 2026-06-27 — Multi-class quiz: home-screen select mode rather than a new screen

The multi-class study flow reuses the same select-mode pattern already used on the class screen (☑ Select button → checkboxes injected in-place → select bar with count and Study button). No intermediate lesson-picker screen was added: selecting classes goes straight to the existing `openSetup()` with all lessons from those classes combined. The existing `setStudyLessonLabel()` pill already labels each card by lesson when `studyScope.lessons.length > 1`, so cross-class sessions are already disambiguated. `returnScreen: "home"` sends the user back to the home screen after the session, which was already handled in the existing return-from-study flow. The `A` key conflict (Analytics vs Select All) is resolved by checking `state.homeSelectMode` first so Select All takes priority in select mode.

## 2026-06-25 — Analytics heatmap: UTC date keys on client match server's SQLite date('unixepoch')

The heatmap generates 90 day-cells on the client and matches them against server-supplied dates from `date(created_at,'unixepoch')` (UTC). Using local-midnight `new Date(y,m,d).toISOString().slice(0,10)` produces the wrong (previous) UTC date for users in UTC+ timezones because `toISOString()` converts local midnight to UTC before formatting. Fixed by using UTC date arithmetic: `new Date(Date.UTC(y,m,d-i))` then `.toISOString().slice(0,10)`, which correctly generates the UTC date the server would return for any given day. Similarly, `getUTCMonth()` and `getUTCDay()` are used for month label and weekday alignment rather than their local-time counterparts.

## 2026-06-25 — Analytics weekly trend uses rolling 7-day buckets, not calendar weeks

The weekly trend chart groups attempts by `(now - created_at) / 604800` integer division — this is a rolling 7-day window anchored to the current second, not Monday–Sunday calendar weeks. The label "This week" therefore means "the past 7 days" rather than the current Mon–Sun week. This was chosen because the server already has Unix timestamps and the formula is simple; calendar-week alignment would require knowing the user's day-of-week locale and aligning to week start. A future improvement could align to ISO weeks, but rolling windows are good enough for a trend chart.

## 2026-06-25 — Audio pronunciation: pointer-events fix + Safari setTimeout workaround

The 3D flip card uses `backface-visibility: hidden` to hide the back face visually, but browsers are not required to block pointer events on hidden backfaces. The back `🔊` button was therefore clickable even when the front was showing. Fixed by adding `.fc-back { pointer-events: none }` and re-enabling only after flip via `.fc-card.flipped .fc-back { pointer-events: auto }`. A separate Safari bug: calling `speechSynthesis.cancel()` then `speak()` synchronously can silently drop the utterance. Fixed by wrapping `speak()` in `setTimeout(fn, 50)`. The 50ms delay is imperceptible to users but gives the browser time to complete the cancel before starting the new utterance.

## 2026-06-27 — TTS voice selection: prefer Google/Enhanced voices, synchronous Safari init

`_pickVoice()` ranks voices: Google en-US → Enhanced/Premium/Neural en-US → any en-US → any English. Safari never fires `voiceschanged`, so the voice is also picked synchronously at script load (when `getVoices()` returns immediately on Safari). The `voiceschanged` listener is guarded with `typeof addEventListener === "function"` to avoid crashing on old Android WebViews that expose `speechSynthesis` without the full `EventTarget` interface. `rate = 0.9` gives slightly more natural cadence than the default 1.0 without noticeably slowing speech.

## 2026-06-27 — Flashcard mobile: -webkit-backface-visibility for Safari face bleed-through

On Safari/iOS, `backface-visibility: hidden` alone sometimes fails to hide the non-facing side of a 3D-transformed card, causing both front and back audio buttons to appear when flipped. Adding `-webkit-backface-visibility: hidden` alongside the unprefixed property forces Safari to apply the correct backface culling.

## 2026-06-26 — Keyboard list navigation: DOM focus (tabIndex=-1) over state index

Arrow-key navigation for class cards and lesson items uses `tabIndex=-1` + `element.focus()` (DOM-native focus management) rather than tracking a `state.focusedIndex` integer. The DOM-native approach is simpler: `moveFocus()` reads `document.activeElement`, computes the next index with `Array.indexOf`, and calls `.focus()`. No state to sync, no stale-index bugs after re-renders. Trade-off: if `renderLessons()` is called while the user is mid-navigation (e.g., after toggling select mode via `setSelectMode`), focus resets to `<body>` because `innerHTML` is wiped. Acceptable for the current UX: `setSelectMode` in-place patches the DOM without a full re-render, so the common keyboard flow (navigate → select → study) doesn't lose focus.

## 2026-06-25 — Keyboard shortcuts: unified handler + Escape-closes-any-modal

Three scattered `keydown` listeners (flashcard, quiz, recall) were replaced with a single consolidated handler at the end of `app.js`. The unified handler dispatches by `getActiveScreen()` (reads the DOM `.screen.active` element — the DOM is the sole source of truth since `showScreen()` never stores the ID in `state`). `isInputFocused()` blocks shortcuts when focus is in INPUT/TEXTAREA/SELECT. `?` and `Escape` are handled before the input-focus guard so they work globally. Escape priority: keymap modal > overlay modal (via `closeAllModals()`) > share modal > prompt-guide modal > per-screen navigation. This ensures Escape always does "the most local" thing rather than accidentally navigating away while a modal is open.

## 2026-06-26 — Image upload: two-step save (upload-then-create)

Image cards use a two-step flow: upload the image first (`POST /api/upload` → returns `{url}`), then save the card with the URL in `data.imageUrl`. The alternative — multipart form submission combining image + JSON in one request — was rejected because it would require parsing `data` fields out of a multipart body alongside the file, mixing form-data encoding with JSON. The two-step approach keeps card creation as a clean JSON POST that matches all other card formats, and the upload endpoint remains a focused single-purpose route. Trade-off: an upload can succeed but the subsequent card creation can fail, leaving an orphaned file. Accepted as low-risk for a single-user or small-team context.

## 2026-06-26 — Upload race condition fix: sequence counter

`handleImageFile()` sets a module-level `uploadSeq` counter and captures `mySeq = ++uploadSeq` at call time. The fetch `.then()` callback only writes to `stagedImageUrl` if `uploadSeq === mySeq` (i.e., no newer upload started). This is simpler than `AbortController` (which would require cancelling in-flight requests) and sufficient because only the last-picked image should be staged — stale completions are simply ignored.

## 2026-06-26 — Schema migrations: `schema_migrations` table for idempotency

The previous table-copy migration pattern (`CREATE TABLE IF NOT EXISTS _v2 → INSERT OR IGNORE → DROP old → RENAME`) re-ran every server startup because the `_v2` table was renamed away each time. Added a `schema_migrations` table with `name TEXT PRIMARY KEY`; each migration inserts its name before the destructive DROP so subsequent startups skip it. The insert happens before DROP so a crash between insert and DROP leaves the migration marked as done but the old table intact — safe because the old table still has the correct data and the migration's purpose (removing a CHECK constraint) is a no-op if the constraint is already gone in practice.

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
