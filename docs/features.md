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
- Create/edit/delete lessons (term↔def or MCQ format)
- Bulk import via pipe-delimited text (MCQ: `question | correct | wrong1 [| wrong2 | wrong3 | wrong4]`)
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
- Quiz mode (MCQ with 2–5 choices, auto-generated distractors for term-def)
- MCQ cards support 1–4 distractors (2–5 total choices); dynamic add/remove in card editor
- Study setup: card count, filter, direction, mode
- Multi-lesson selection → combined study session
- Progressive difficulty: hard cards weighted 3×, medium 2×
- "Hard First" filter for focused review
- "Due Only" filter to quiz only SRS-due cards
- Interleaved vs Blocked card order for multi-lesson sessions (pill on setup screen, hidden for single-lesson)

## Keyboard-Only Mode

- Unified keydown handler covers all screens — no mouse required
- Home: `N` new class; Class: `N` new lesson, `E` edit, `⌫` back; Lesson: `N` new card, `B` bulk paste, `S` start study, `⌫` back
- Flashcard: `←`/`→` prev/next, `Space` flip, `1`/`2` mark learning/known, `S` shuffle, `R` reset, `F` filter hard
- Quiz: `1`–`5` select option, `Esc` back; Recall: `Enter` reveal, `1`/`2`/`3` grade, `Esc` back
- Global: `H` go home, `?` toggle keymap modal, `Esc` close any open modal
- `?` key shortcut modal lists all bindings; `⌨` header button also opens it
- `[key]` hints injected next to button labels on desktop; hidden on mobile (`≤600px`)
- Escape works for any modal (overlay forms, share, prompt guide, keymap)

## Share
- Public share link (anyone can study or clone)
- Invite by username/email (shows in "Shared with me")
- Clone shared/invited class into own account

## Stats
- Per-card difficulty (easy/medium/hard) based on attempt history
- Progress bars (known/total) on class and lesson lists
- Stats screen with hardest cards

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
