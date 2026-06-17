# Feature Stories

## Auth
- Email/password register & login
- Google OAuth (sign in, auto-register, link existing account)
- Forgot password → email reset link (SMTP/Gmail via env vars)
- Reset password page at /reset-password?token=...
- Production security: dev reset token suppressed when NODE_ENV=production

## Classes & Lessons
- Create/edit/delete classes (icon, color)
- Create/edit/delete lessons (term↔def or MCQ format)
- Bulk import via pipe-delimited text
- AI prompt guide with copy button

## Study
- Flashcard mode (flip, mark known/learning)
- Quiz mode (MCQ, auto-generated distractors for term-def)
- Study setup: card count, filter, direction, mode
- Multi-lesson selection → combined study session
- Progressive difficulty: hard cards weighted 3×, medium 2×
- "Hard First" filter for focused review
- Interleaved vs Blocked card order for multi-lesson sessions (pill on setup screen, hidden for single-lesson)

## Spaced Repetition
- Quiz sessions saved with next-review date
- Due badges on lesson list (amber, "Review in N days")
- Review hint on results screen showing next review interval

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

## Upcoming: MCQ Explanation Field (planned, not yet built)
- Add `explanation` field to card JSON data (both formats)
- Update AI prompt guide to include explanation in output
- Update card editor to show explanation input
- Show explanation in a collapsed panel during quiz (expands on tap)
- Supports delayed-feedback pattern: student recalls first, then confirms reasoning

## Upcoming: Recall Mode (planned, not yet built)
- Free-text answer input instead of MCQ selection
- User types answer, taps "Reveal" to see correct answer
- Self-grades with thumbs up/down or Easy/Medium/Hard
- Research basis: free recall produces ~80% retention vs ~34% for re-reading or recognition-only MCQ
