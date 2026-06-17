# Feature Stories

## Auth
- Email/password register & login
- Google OAuth (sign in, auto-register, link existing account)
- Forgot password → email reset link (SMTP/Gmail via env vars)
- Reset password page at /reset-password?token=...

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
