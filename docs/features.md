# Feature Stories

## Auth
- Email/password register & login
- Google OAuth (sign in, auto-register, link existing account)
- Forgot password → email reset link (SMTP/Gmail via env vars)
- Reset password page at /reset-password?token=...
- Production security: dev reset token suppressed when NODE_ENV=production
- Sessions persisted in SQLite (custom store replacing MemoryStore) — survives server restarts; expired rows cleaned up every 24 hours
- Screen state persisted in localStorage — page refresh or re-login after session loss returns user to their last class or lesson screen

## Classes & Lessons
- Create/edit/delete classes (icon, color)
- Create/edit/delete lessons (term↔def, MCQ, True/False, or Image↔Def format)
- Bulk import via pipe-delimited text (MCQ: `question | correct | wrong1 [| wrong2 | wrong3 | wrong4]`; T/F: `statement | true` or `statement | false [;; explanation]`)
- AI prompt guide with copy button; AI generates 2–4 distractors per card
- Bulk delete lessons: "☑ Select" on class screen enters select mode with checkboxes, select-all, and "Delete selected" to remove multiple lessons and their cards at once
- Bulk delete cards: "☑ Select" on lesson screen enters card select mode with checkboxes, select-all, and "Delete selected" to remove multiple cards at once

## Spaced Repetition
- Per-card SRS intervals: 10min → 1h → 4h → 1d → 3d → 7d → 21d (step advances on correct, resets on wrong)
- Due badges on lesson cards showing count of cards due for review
- "Review N due" button on lesson screen launches quiz filtered to due cards only
- Due counts on class cards (home screen) and dashboard grouped by class
- Dashboard due lessons grouped by class with clickable rows to launch review

## Study
- Flashcard mode (flip, mark known/learning)
- Quiz mode (MCQ with 2–5 choices, auto-generated distractors for term-def; True/False shows two large True/False buttons)
- True/False lesson format: statement card with True or False answer; optional explanation shown after answering; bulk import `statement | true/false [;; explanation]`; works in all study modes (flashcard, quiz, recall)
- MCQ cards support 1–4 distractors (2–5 total choices); dynamic add/remove in card editor
- Study setup: card count, filter, direction, mode
- Multi-lesson selection → combined study session; lesson name badge shown above each question/card so the subject is always visible
- Multi-class quiz: "☑ Select" button (or `X` key) on home screen enters class select mode; check multiple classes and click "Study" to fetch all their lessons and launch a cross-class interleaved session
- Progressive difficulty: hard cards weighted 3×, medium 2×
- "Hard First" filter for focused review
- "Due Only" filter to quiz only SRS-due cards
- Interleaved vs Blocked card order for multi-lesson sessions (pill on setup screen, hidden for single-lesson)
- MCQ → T/F expansion in quiz mode: setup screen shows a 0–100% slider (default 20%, hidden for non-MCQ lessons); selected fraction of MCQ cards are replaced by True/False sub-questions at quiz time ("Is X the correct answer to Q?"); each expanded card records SRS attempts against the source MCQ card so difficulty and due-date update normally

## Audio Pronunciation

- `🔊` button on each card face (front and back) speaks the card text via Web Speech API
- `P` key speaks the currently visible face (front before flip, back after)
- LaTeX (`$...$` and `$$...$$`) stripped before speaking so math notation is skipped
- `.fc-back` buttons are `pointer-events: none` until the card is flipped — prevents accidental clicks on the hidden face
- 50ms `setTimeout` around `speak()` avoids a Safari bug where synchronous `cancel()+speak()` silently drops the utterance
- Voice selection: prefers Google en-US voices (Chrome), then Enhanced/Premium/Neural en-US (Apple), then any en-US, then any English; cached after first pick via `voiceschanged` event (with synchronous init for Safari which never fires the event)
- `rate = 0.9` for more natural cadence

## Keyboard-Only Mode

- Unified keydown handler covers all screens — no mouse required
- Home: `↑`/`↓` navigate class cards; `Enter` open class / toggle selection; `X` toggle select mode; `Space` toggle selection; `A` select all; `S` study selected; `Esc` exit select mode; `N` new class
- Mobile home header: ⋮ dropdown consolidates Dashboard, Analytics, ☑ Select Classes, and Keyboard shortcuts — header stays single-row on 390px viewports; ☑ Select remains visible in header on desktop (≥601px)
- Class: `↑`/`↓` navigate lesson items; `Enter` open focused lesson; `X` toggle select mode; `Space` toggle selection (select mode); `A` select all (select mode); `S` study selected (select mode); `Esc` exit select mode; `N` new lesson, `E` edit, `⌫` back
- Lesson: `N` new card, `B` bulk paste, `S` start study, `⌫` back
- Flashcard: `←`/`→` prev/next, `Space` flip, `1`/`2` mark learning/known, `S` shuffle, `R` reset, `F` filter hard, `P` pronounce
- Quiz: `1`–`5` select option, `Esc` back; Recall: `Enter` reveal, `1`/`2`/`3` grade, `Esc` back
- Global: `H` go home, `?` toggle keymap modal, `Esc` close any open modal
- `?` key shortcut modal lists all bindings; `⌨` header button also opens it
- `[key]` hints injected next to button labels on desktop; hidden on mobile (`≤600px`)
- Escape works for any modal (overlay forms, share, prompt guide, keymap)
- `class-card` and `lesson-item` elements have `tabIndex=-1` + `focus-visible` outline so keyboard focus is always visible

## Share
- Public share link (anyone can study or clone)
- Invite by username/email (shows in "Shared with me")
- Clone shared/invited class into own account

## Stats
- Per-card difficulty (easy/medium/hard) based on attempt history
- Progress bars (known/total) on class and lesson lists
- Stats screen with hardest cards

## Image Cards (server mode only)

- New lesson format "Image → Definition" (`image-def`): image displayed on card front, text definition on back
- File upload endpoint `POST /api/upload` — multer, 5 MB limit, accepts JPEG/PNG/GIF/WebP; returns `/uploads/<uuid>.ext`
- Image drop zone in card creation modal: click or drag-and-drop; instant preview via FileReader
- `stagedImageUrl` tracks the uploaded URL before card is saved; sequence counter prevents race condition when user picks files rapidly
- All study modes support image-def: flashcard front shows `<img>`, quiz question shows `<img>`, recall question shows `<img>`; answer/back always shows text definition
- Front audio button hidden for image-def cards (no text to speak on front); direction picker hidden in setup for image-def-only sessions
- Format badge shows "Image↔Def" in orange on lesson list; bulk-add button hidden for image-def lessons
- Server validation: `imageUrl` must start with `/uploads/` (applied to POST, PUT, and bulk insert); `def` must be non-empty
- Image file cleanup: old file deleted on card image update; file deleted when card is deleted
- `schema_migrations` table added so table-copy migrations run exactly once (previously re-ran every startup)
- CSV analytics export uses `[image]` in the `card_front` column for image-def cards
- Image-def format pill hidden in local/localStorage mode (upload requires server)

## Analytics (server mode only)

- `📈 Analytics` button on home header; `A` key on home screen; `Esc` to go back
- `GET /api/stats/analytics` endpoint returns heatmap, weekly trend, and lesson breakdown
- **90-day study heatmap** — GitHub-style calendar; cells colored by daily attempt count (0 / 1–5 / 6–15 / 16+); month labels; UTC date keys match server's SQLite `date('unixepoch')` dates
- **12-week rolling trend** — CSS-only bar chart showing attempts per 7-day rolling window; "This week" / "Last week" / "Xw ago" labels
- **Lesson accuracy breakdown** — all lessons with study data, sorted worst-first (lowest accuracy), with accuracy %, retention bar, attempt count; clicking a row navigates to the lesson's Stats screen
- **CSV export** — "⬇ Export CSV" button downloads last 90 days of attempt history as `study-export.csv` (`date,lesson,card_front,result`)

## Dashboard (server mode only)
- Accessible from home screen header button
- `GET /api/stats/dashboard` endpoint, renders `#screen-dashboard`
- Study streak (consecutive days with at least one session)
- Summary counts: classes, lessons, cards, sessions, attempts
- Overall accuracy progress bar
- Card difficulty breakdown (easy/medium/hard/new counts)
- Due-for-review lessons (grouped by urgency)
- Struggling lessons: lessons where >40% of attempted cards are rated Hard

## MCQ Explanation Field
- Optional `explanation` field on MCQ cards; stored in card JSON data
- Card editor: collapsible "Explanation (optional)" section below distractors; auto-opens when editing a card that has one
- Bulk import: append `;; explanation text` after distractors on a MCQ line — uses first `;;` as delimiter so explanations may contain `;;`
- AI prompt: instructs AI to append `;;` explanation after each MCQ card
- Quiz mode: explanation shown in a collapsible `💡 Explanation` panel immediately after answering; auto-dismissed when moving to next card
- Flashcard mode: explanation panel renders below the dark card (outside the flip container) so it is fully visible on mobile without scrolling inside the card; hidden on card front, shown on card back
- Recall mode: explanation shown in the reveal area after "Reveal Answer"
- Server validates: if provided, must be a non-empty string

## Recall Mode
- New study mode selectable from the setup screen ("Recall" pill)
- Shows the question (MCQ question or term/def depending on direction); user types their answer in a textarea
- "Reveal Answer" button (or Enter key while in textarea) shows the correct answer and any MCQ explanation
- Three self-grade buttons: ✗ Missed (SRS reset to step 0), ~ Unsure (SRS +1 step), ✓ Got It (SRS +2 steps)
- Keyboard shortcuts after reveal: 1 = Missed, 2 = Unsure, 3 = Got It
- Results screen reused from quiz; shows percentage and grade A–F
- Works for both term-def and MCQ cards; source recorded as `"recall"` in attempt history
- Research basis: free recall produces ~80% retention vs ~34% for recognition-only MCQ
