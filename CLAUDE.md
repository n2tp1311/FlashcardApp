# FlashcardApp — Claude Instructions

## Agent workflow (required for every non-trivial feature)

Every feature must go through all of these stages in order:

1. **Explore** agent — scan codebase for all affected files and existing patterns
2. **Plan** agent — design the implementation strategy before writing any code
3. **Implement** — main agent writes the code
4. **code-review** skill (`/code-review`) — review the diff for bugs and correctness
5. **verify** skill (`/verify`) — run the app and confirm the feature works end-to-end
6. **Commit + push** — immediately after verify passes, commit and push to origin/main

Skip stages only for genuinely trivial changes (e.g. single-line CSS fix). For anything involving logic, schema, or multiple files — all stages apply.

## After each feature: update docs

After committing, update the relevant docs in `docs/`:

- **`docs/features.md`** — add a bullet under the right section describing what was built
- **`docs/implementation-plan.md`** — update §5 (spec tables) and §11 (build status) if the feature changes the spec or ships a planned item
- **`docs/decisions.md`** — add an entry if a non-obvious choice was made (why this approach over alternatives)
- **`docs/GUIDE.md`** — **every feature change, no exceptions**: how it works now and why (see below). `tests/guide-sync.test.js` fails while any code, `features.md` or `decisions.md` commit is not followed by a guide commit. A commit that changes nothing the guide describes (a pure refactor) says so with a line `Guide: unchanged` in its message

Commit the docs update as a separate commit immediately after the feature commit.

## Keep `docs/GUIDE.md` in sync

`docs/GUIDE.md` explains how the system works now and *why* (`decisions.md` is the
history, `features.md` the screen-by-screen list). It is ingested into KnowledgeApp as
the book **FlashcardApp Guide** and studied as a FlashcardApp class. KnowledgeApp's
nightly job (`scripts/nightly-guide.sh`, 02:00) refreshes that book when the committed
guide changed — so commit the guide and stop there; never ingest it a second time
(a second ingest makes a second class and loses its progress).

Every feature change -- added, changed or removed, however small -- updates the guide in
the docs commit that follows it. A fix that changes what the learner sees or what is
stored counts too. State why, name the cost, give measured numbers as measured. If you find the guide
wrong, fix it and say so.

| You changed | Update |
|---|---|
| `server/index.js` setup, mode, file layout | §2 |
| `server/db.js` schema, migrations, preferences | §3 |
| card formats, `lib/cloze.js`, `vocabulary-term.js` | §4 |
| `routes/attempts.js`, `ratingFor`, `lib/leech.js` | §5 |
| `server/fsrs.js`, `lib/memory.js`, `lib/workload.js` | §6 |
| `lib/undo.js`, `DELETE /api/attempts/:id` | §7 |
| study setup, flashcard/quiz/cram flow, Study now, Resume, session end | §8 |
| `lib/streak.js`, `lib/today.js`, `lib/aboveAvg.js`, daily goal, review cap | §9 |
| `routes/stats.js`, `lib/attemptDaily.js`, `lib/mastery.js` | §10 |
| `lib/achievements.js`, `study_events` | §11 |
| client offline queue, `sw.js` | §12 |
| `routes/integrations.js`, `middleware/apiToken.js` | §13 |
| `lib/dbLock.js`, WAL, statement wrapper, watchdog, rate limits, `lib/backup.js` | §14 |
| auth, sessions, tokens, import, push allowlist | §15 |
| client structure, i18n, palettes, iOS behaviour, preferences screen | §16 |
| `lib/reminders.js` | §17 |
| sharing, export, import, bulk paste | §18 |
| test patterns | §19 |

## Commit + push rules

- Commit and push to `origin/main` after every feature — do not wait to be asked
- Never skip hooks (`--no-verify`)
- Always use parameterized SQL (`?` placeholders) — never string interpolation with user data

## Code style

- No comments unless the WHY is non-obvious
- No abstractions beyond what the task requires
- Validate at system boundaries (user input, external APIs); trust internal code
