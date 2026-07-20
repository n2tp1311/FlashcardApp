# Feature Stories

## UI / Design
- All emoji UI-chrome icons (buttons, headers, dropdown items, empty-state illustrations, sort-direction/kebab/close controls) replaced with a single minimalist SVG icon set (feather-style: `stroke="currentColor"`, `stroke-width="2"`, rounded caps) for visual consistency across the whole app
- `svgIcon()` + `ICON_*` constants in `client/app.js` provide reusable icons for dynamically-generated list rows (class/lesson/card edit/delete/archive buttons); static screens/modals in `client/index.html` inline the same paths directly
- User-chosen content icons are explicitly out of scope and untouched: `CLASS_ICONS` (the emoji picker for personalizing a class) and any place a class's own `cls.icon` is displayed
- Literal keyboard-key glyphs (e.g. `⌫`, arrow keys inside `<kbd>` in the shortcuts modal) and typographic in-sentence arrows (e.g. "Term → Definition" pill label, "Image↔Def" format badge) are intentionally left as Unicode text — they represent a physical key or a text separator, not an interactive icon
- Added missing `title`/`aria-label` to every icon-only button that lacked one during the pass (16 modal-close buttons, kebab "more options" menus, MCQ remove-distractor button)

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
- AI prompt guide with copy button; AI generates 2–4 distractors per card; length rule relaxed — options should be comparable but natural phrasing takes priority over exact word-count matching
- Bulk delete lessons: "☑ Select" on class screen enters select mode with checkboxes, select-all, and "Delete selected" to remove multiple lessons and their cards at once
- Bulk delete cards: "☑ Select" on lesson screen enters card select mode with checkboxes, select-all, and "Delete selected" to remove multiple cards at once
- Lesson list re-render (after add/edit/delete/sort/filter) swaps old and new items atomically instead of clearing then repopulating after a network round trip — keeps scroll position stable instead of jumping to the top
- Archive a class (🗄️ icon on the class card, or "Archive Class" in the class-detail ⋮ menu): archived classes are hidden from the home list, sidebar, and level slicer by default; an "🗄️ Archived" toggle pill next to the grid/list view switch shows only archived classes (with an "Unarchive" action) when active
- Archived classes are excluded from dashboard summary counts, "due for review," streak-relevant struggling-lesson detection, and analytics lesson breakdown — but remain fully browsable and studyable on demand if opened directly (their due badges still work inside their own lesson list)
- Export/import round-trips the archived flag; class-sharing clones always start unarchived

## Spaced Repetition
- Per-card SRS intervals: 10min → 1h → 4h → 1d → 3d → 7d → 21d (step advances on correct, resets on wrong)
- Due badges on lesson cards showing count of cards due for review
- "Review N due" button on lesson screen launches quiz filtered to due cards only
- Due counts on class cards (home screen) and dashboard grouped by class
- Dashboard due lessons grouped by class with clickable rows to launch review

## Performance
- Bulk cards endpoint (`POST /api/cards/by-lessons`): multi-lesson quiz startup reduced from 2N+1 HTTP requests (N `getCards` + N `getKnownMap` per lesson) to 2 requests total regardless of lesson count; 10-lesson quiz goes from 21 requests to 2 (90% reduction)
- Per-card correlated subquery for `last_studied_at` replaced with a single `GROUP BY` aggregate JOIN on the attempts table
- Added `idx_states_user_due ON card_states(user_id, srs_due_at)` and `idx_attempts_cu_created ON attempts(card_id, user_id, created_at)` indexes for faster SRS queries

## Study
- Flashcard mode (flip, mark known/learning)
- Quiz mode (MCQ with 2–5 choices, auto-generated distractors for term-def; True/False shows two large True/False buttons)
- True/False lesson format: statement card with True or False answer; optional explanation shown after answering; bulk import `statement | true/false [;; explanation]`; works in flashcard and quiz modes
- MCQ cards support 1–4 distractors (2–5 total choices); dynamic add/remove in card editor
- Study setup: card count, filter, direction, mode
- Multi-lesson selection → combined study session; lesson name badge shown above each question/card so the subject is always visible
- Multi-class quiz: "☑ Select" button (or `X` key) on home screen enters class select mode; check multiple classes and click "Study" to fetch all their lessons and launch a cross-class interleaved session
- Progressive difficulty: hard cards weighted 3×, medium 2×
- "Hard First" filter for focused review
- "Due Only" filter to quiz only SRS-due cards
- Card order: "In Order" (default, DB insertion order) or "Shuffle" (weighted-difficulty shuffle); "Interleaved ✦" appears additionally for multi-lesson sessions to mix cards across lessons
- Account preferences: "⚙ Preferences" in the user dropdown; saves dark mode and font scale to the server and caches in localStorage
- Flashcard flip only triggers on a plain click — a click that ends an active text selection (e.g. dragging to select text for copy/translate) is ignored, checked via `window.getSelection().toString()`
- Delete-card button (🗑) in both flashcard toolbar and quiz header removes the currently shown card immediately (with the standard confirm dialog) and advances to the next card; deleting the last remaining card exits back to the lesson/class screen
- Lesson sort: "Sort by" dropdown on the class screen; options are Date added (newest first), Last studied, Last card added, Due count; choice persisted in localStorage per browser
- Class sort: "Sort by" dropdown on the home screen; options are Level, Name (A–Z), Due count, Date added; choice persisted in localStorage; classes with no level set sort last (after all leveled classes), tie-broken by date added
- Class level field: optional integer on each class ("Level" input in class editor, 1–999); used to sequence courses; can be cleared; persists to server; round-trips through export/import and class share

## Audio Pronunciation

- Inline SVG speaker icon (matches the app's other feather-style line icons) on each card face (front and back) speaks the card text via Web Speech API
- `.fc-front`/`.fc-back` no longer set `overflow: auto` themselves — `overflow` lives on `.fc-content` instead, since `overflow` on a `backface-visibility: hidden` face inside a 3D-rotated card is a known WebKit bug that lets the hidden face (and its speaker icon) render through during the flip
- `P` key speaks the currently visible face (front before flip, back after)
- LaTeX (`$...$` and `$$...$$`) stripped before speaking so math notation is skipped
- `.fc-back` buttons are `pointer-events: none` until the card is flipped — prevents accidental clicks on the hidden face
- 50ms `setTimeout` around `speak()` avoids a Safari bug where synchronous `cancel()+speak()` silently drops the utterance
- Voice selection is automatic (not user-configurable): prefers Google en-US voices (Chrome), then Enhanced/Premium/Neural en-US (Apple), then any en-US, then any English; cached after first pick via `voiceschanged` event (with synchronous init for Safari which never fires the event)
- `rate = 0.9` by default for a more natural cadence
- Preferences modal (⚙ Preferences): Speed control (0.5x–1.5x in 0.1 steps) sets the rate; a 🔊 Test button previews the in-progress speed immediately, without requiring Save first
- Rate choice stored server-side per-user via the same `preferences` JSON blob as dark mode and font scale (`ttsRate` = number)

## Keyboard-Only Mode

- Unified keydown handler covers all screens — no mouse required
- Home: `↑`/`↓` navigate class cards; `Enter` open class / toggle selection; `X` toggle select mode; `Space` toggle selection; `A` select all; `S` study selected; `Esc` exit select mode; `N` new class
- Mobile home header: ⋮ dropdown consolidates Dashboard, Analytics, ☑ Select Classes, and Keyboard shortcuts — header stays single-row on 390px viewports; ☑ Select remains visible in header on desktop (≥601px)
- Responsive inline nav: at ≥680px viewport width, Dashboard and Analytics appear as inline header buttons (`.nav-inline-btn`); on narrow screens they fall back to the ⋮ dropdown (`.dash-analytics-dropdown`)
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

## Home Screen — Views & Filters

- **Grid / List view toggle**: segmented control in the home header switches class display between a `.class-grid` card layout and a `.class-list-view` compact row layout; choice persisted in `fc-home-view` localStorage key
- **Level slicer pills**: when any class has a `level` set, a pill bar appears above the class list with "All" + one pill per distinct level (L1, L2 …); clicking a pill hides classes of other levels; choice persisted in `fc-home-filter`; pill bar hidden when no classes have levels
- **Accuracy per class**: after classes load, `GET /api/stats/accuracy/classes` fetches correct/total attempt counts; each class card (grid) and class row (list) shows a color-coded accuracy pill — green (≥70%), orange (≥40%), red (<40%); hidden until data arrives

## Class Screen — Lesson Format Filter & Accuracy

- **Lesson format slicer**: when lessons of more than one format exist (term-def, MCQ, True/False, image-def), a pill bar above the lesson list lets the user filter to a single format; bar hidden when all lessons share one format or there are none
- **Accuracy per lesson**: `GET /api/stats/accuracy/lessons?classId=X` fetches per-lesson accuracy; each lesson row shows a color-coded accuracy pill using the same high/mid/low tiers as the class pill

## Card Screen — Accuracy in Diff-Pill

- Diff-pills now show `"Easy · 80%"` format (level + % accuracy) for cards that have attempt history; shows `"New"` for cards with no attempts

## Dashboard — Period Selector

- Four period pills (7d / 30d / 60d / 90d) above the heatmap control the analytics window; choice persisted in `fc-dash-period`; switching a period re-fetches only analytics (not the full dashboard) and updates heatmap, weekly trend, and heatmap title

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

## Global Search
- Command-palette style modal opened by Ctrl/Cmd+K or the 🔍 button in the header
- Searches classes, lessons, and cards simultaneously with a single debounced query (200ms)
- Results grouped into three sections (Classes / Lessons / Cards), up to 5 per group
- Match highlighted in blue within result titles; breadcrumb shows class name (lessons) or class › lesson (cards)
- Card text extracted server-side via `json_extract` CASE expression covering all formats: term-def (term), mcq (question), true-false (statement), image-def (def)
- Keyboard navigation: ArrowUp/Down to move, Enter to select, Escape to close; clicks also work
- Selecting a class opens that class; selecting a lesson or card navigates to the lesson screen
- Minimum 2-character query before any search fires; Escape and click-outside close the modal

## Mobile PWA & Swipe Gestures
- PWA icons: `apple-touch-icon.png` (180px, full-bleed for iOS), `icon-192.png`, `icon-512.png` generated from logo SVG via Playwright at build time
- `manifest.json` with `display: standalone`, `theme_color: #4338ca`, `background_color: #1a1744`
- Meta tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `theme-color`, `apple-touch-icon`
- Flashcard swipe: drag `#fc-scene` horizontally; right swipe (> 75px) = Know It, left swipe = Learning; card flies off screen with rotation then triggers the mark; short swipe (< 75px) snaps back with spring animation
- Swipe hint labels: `✓ Biết rồi` (green, left side) and `✗ Học lại` (red, right side) fade in as drag distance grows toward threshold; rotate ±15° like Tinder labels
- `touch-action: pan-y` on `.fc-scene` — browser owns vertical scroll, JS owns horizontal swipe
- Edge back swipe: start from x < 30px, swipe right > 90px → triggers back button for current screen; excluded on flashcard screen (handled by card swipe instead)
- Search modal: swipe down > 80px closes it

## Recall Mode (removed)
- Recall mode was removed; historical attempt records with `source='recall'` are preserved in the DB
