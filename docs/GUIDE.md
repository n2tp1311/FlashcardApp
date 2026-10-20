# FlashcardApp — how it works

A guide to the whole system: what each part decides, what it stores, where it can
fail, and why it was built the way it was. `docs/features.md` lists what the app
does, screen by screen; `docs/decisions.md` keeps every decision in the order it
was made, including the ones later reversed. This guide is the current picture:
read it to understand the app as it stands, then go to `decisions.md` for the
history behind a choice.

---

## 1. What the app is for

You study cards. The app decides when you see each one again, so that you review a
card shortly before you would have forgotten it, and not much earlier. Everything
else — the Home screen, the streak, the charts, the achievements — exists to make
that loop easy to start every day and honest about how it is going.

Most of the cards are not typed by hand. KnowledgeApp, a separate program on the
owner's Mac, reads books, turns them into term–definition cards and pushes them
here. FlashcardApp owns the learner's side: the schedule, the answers, the progress.
KnowledgeApp owns the content's side: where a card came from and how it should be
worded. The boundary between the two is one of the main shapes of this codebase
(§13).

Two ideas run through every part:

- **The answer is the unit of truth.** Every grade is a row in `attempts`, and
  almost every number on screen — streak, daily goal, accuracy, study time, new
  cards today, achievements — is computed from those rows when it is asked for,
  not counted up as things happen. A rule can change and the whole history obeys
  it at once; an undone answer disappears from every number at once.
- **A day is a UTC day.** The streak, the daily goal, the review cap, the weekly
  recap and the "Resets in" countdown all roll over at UTC midnight, which is
  07:00 in Vietnam. It is a known cost (§9), kept because moving to local days
  would rewrite every user's history. Load balancing is the one exception: it
  uses local days, because an "easy Saturday" has to be the learner's Saturday.

---

## 2. The shape of the system

```
  browser (client/app.js, one file, no build step)
     │   fetch /api/*  (session cookie)
     ▼
  Express (server/index.js) ── one Node process
     │
     ├─ routes/*.js ──────────► db.js ──► data/flashcards.db   (SQLite, WAL)
     ├─ lib/*.js   pure rules: streak, workload, memory, undo, leech, …
     ├─ every minute: reminders (web push)
     └─ every 10 min: nightly backup check

  KnowledgeApp (owner's Mac)
     │   Bearer token  /api/integrations/knowledge/*
     └─► routes/integrations.js  (mounted before the session middleware)
```

**One process, one database file.** The server is a single Express process on
Railway with a SQLite file on a Railway volume. SQLite is loaded through
`node-sqlite3-wasm`, a WebAssembly build that needs no native compilation — chosen
at the start so the Docker image (`node:20-alpine`) builds anywhere. Its cost shapes
much of the server: **every query is synchronous and runs on the event loop**. While
one request is inside SQLite, no other request is answered. Most of §14 is about
living with that.

**No client build.** `client/app.js` (about 15,400 lines), `client/style.css` and
`client/index.html` are served as they are. There is no bundler, no framework and
no npm package in the browser. That is why i18n is hand-rolled (§16), why FSRS's
interval previews come from the server rather than a client copy of the
scheduler (§6), and why tests extract functions from `app.js` by text (§19). The
cost is a very large file; the gain is that what is deployed is exactly what is in
the repository.

**Server mode and local mode.** The same client runs in two modes. Served by
Express, `window.APP_CONFIG.mode` is `"server"` and the client talks to the API
through `SQLiteAdapter`. Opened without a server it falls back to
`LocalStorageAdapter`, which keeps classes and cards in the browser. Local mode is
the original version of the app and is not the supported path: no scheduler
counts, no due dates, no stats, no sync. Features that need the server say
"server mode only" in `features.md`; the client checks `IS_SERVER` before showing
them.

**Where things live.**

| Part | Files |
|---|---|
| HTTP setup, timers | `server/index.js` |
| Schema, migrations, statement wrapper | `server/db.js` |
| Scheduler glue | `server/fsrs.js`, `lib/memory.js`, `lib/workload.js` |
| Answering, undo | `routes/attempts.js`, `lib/undo.js`, `lib/leech.js` |
| Day-based numbers | `lib/streak.js`, `lib/today.js`, `lib/aboveAvg.js`, `routes/stats.js` |
| Stats rollup | `lib/attemptDaily.js` |
| Achievements | `lib/achievements.js`, `routes/achievements.js` |
| KnowledgeApp | `routes/integrations.js`, `middleware/apiToken.js` |
| Reliability | `lib/dbLock.js`, `middleware/watchdog.js`, `middleware/rateLimit.js`, `lib/backup.js` |
| Reminders | `lib/reminders.js`, `routes/reminders.js`, `client/sw.js` |
| Client | `client/app.js`, `client/style.css`, `client/index.html`, `client/sw.js` |

---

## 3. Data model

```
users ─┬─< classes ─< lessons ─< cards
       │                           │
       ├─< card_states (card_id, user_id) ── the schedule
       ├─< attempts ── every answer (card_id kept, no foreign key)
       ├─< attempt_daily ── attempts summed per day (kept by triggers)
       └─ preferences (JSON column), fsrs_model, fsrs_last_fit
```

**Ids** are short strings made by `genId()` (time in base 36 plus random
characters) and are never reused. An attempt's id is made on the client
(`c` + 20 characters) so that a resend can be recognised (§12).

**`cards.data` is JSON**, with a different shape per format (§4). The format is a
column on both the lesson and the card; KnowledgeApp's cloze and passage cards sit
in term-def lessons, so a lesson's format describes most of its cards, not all.

**`card_states`** holds one row per card per user: the FSRS fields
(`fsrs_stability`, `fsrs_difficulty`, `fsrs_state`, `fsrs_reps`, `fsrs_lapses`,
`fsrs_learning_steps`, `fsrs_last_review_at`), the due time `srs_due_at`, the
manual `known` flag, `last_correct_source` (for Needs Recall, §5), `leech_base`
(§5) and `last_seen_at`. **A card with no `card_states` row is a new card** — never
answered. That is the definition every "new cards" number uses. `srs_step` is the
old fixed-ladder scheduler's column, left in place but no longer read or written.

**`attempts` has no foreign key to `cards`.** Deleting a class, lesson or card used
to cascade into its answers and wipe study time, heatmap days and streak. The key
was dropped (2026-09-13) rather than set to NULL, which would have merged every
deleted card's answers into one group and undercounted per-card numbers such as new
cards per week. Orphaned answers keep their original `card_id`; since ids are never
reused they cannot attach to another card. Cards are about eight times the size of
attempts, so deleting content still frees most of the space. `card_states` keeps its
cascade: a schedule for a card that no longer exists means nothing.

Other tables, by owner:

| Table | What it holds |
|---|---|
| `sessions` | express-session rows (`sessionStore.js`); a daily sweep deletes expired ones |
| `api_tokens` | KnowledgeApp tokens, SHA-256 only (§15) |
| `external_card_deletions` | linked cards the learner deleted, read by KnowledgeApp (§13) |
| `vocabulary_requests` | words saved for KnowledgeApp to define (§13) |
| `rewrite_requests` | leeches the learner asked KnowledgeApp to rewrite (§5, §13) |
| `crams` | a test date and its lessons; progress is read from attempts (§8) |
| `study_events`, `user_achievements` | the few facts achievements need that nothing else stores (§11) |
| `push_subscriptions`, `reminder_log`, `app_secrets` | reminders (§17) |
| `class_share_links`, `class_invites` | sharing (§18) |
| `quiz_sessions` | finished quiz sessions; only the Sessions count reads it |

**Preferences** are one JSON column on `users`. `PUT /api/auth/preferences` merges
what the client sends into what is stored, so a client that does not know a newer key
cannot erase it. The client caches the blob in `localStorage["fc-preferences"]` and
applies it on load (`applyPrefs`). The personal FSRS model is deliberately **not** in
preferences: that PUT stores whatever a client sends, and model parameters must only
ever come from the optimizer.

**Migrations** live in `db.js`. A new column is an `ALTER TABLE … ADD COLUMN` in a
`try` (it fails harmlessly once the column exists). A table rebuild or a backfill goes
through `runMigration(name, fn)`, which records its name in `schema_migrations` so it
runs once. Two traps were found here and are now written into the code:

- `runMigration` swallows errors. A migration that fails part-way is not retried
  and nothing reports it. The `attempt_daily_rollup` migration therefore opens its
  own transaction, so a failure rolls back instead of leaving triggers without their
  backfill.
- A migration that binds several parameters must run **after** the `db.prepare`
  wrapper further down the file. The first FSRS backfill ran before it; every
  `UPDATE` silently bound nothing, and the migration was marked done. A
  pre-migration backup diff caught it.

### Case-insensitive search in Vietnamese

SQLite's `LOWER()` and `LIKE` fold ASCII letters only, so "Đ", "Ố" and "Ư" stayed upper
case and a search for "định lý" missed "Định lý". `server/db.js` registers `fold()`,
JavaScript's `toLowerCase()` after NFC (macOS and some keyboards send a vowel and its
marks as separate code points), and `GET /api/search` uses it. It runs in JavaScript once
per row: 105 ms against `LOWER()`'s 41 ms over 80k cards, measured. So a query that is all
ASCII keeps `LOWER()`, which is enough because text matching an ASCII query is ASCII
itself. Accents still count: "dinh ly" does not find "định lý".

---

## 4. Card formats

| Format | `data` | Studied as |
|---|---|---|
| `term-def` | `{term, def, explanation?}` | front / back; quiz options are other cards' definitions |
| `mcq` | `{question, correct, distractors[1-4], explanation?}` | its own options, 2–5 |
| `true-false` | `{statement, correct: "true"/"false", explanation?}` | two buttons |
| `image-def` | `{image, def}` | image front; server mode only (uploads) |
| `cloze` | `{text}` with `{{c1::answer}}` gaps | one hidden gap |
| `gapfill` | `{text, distractors?, title?}` | a passage, every gap from a word bank |

**Cloze** uses Anki's syntax so a card reads the same in both apps and survives
plain-text export. A card hides only its `c1` gaps; KnowledgeApp sends one sentence
per gap, each its own card, because each hidden detail is remembered at its own rate
and needs its own schedule. The sentence is rendered piece by piece around the gap,
since KaTeX renders late and the gap could not be found in its output afterwards —
which is why a gap inside `$…$` math cannot work, and KnowledgeApp keeps gaps out of
math (`lib/cloze.js`).

**Gapfill** is the opposite trade: one passage, one schedule, every gap at once from
a word bank of the answers plus the passage's own wrong words. The gaps are meant to
be read together, and splitting them would show the same passage several times a
session. The cost is that one weak gap reschedules the whole passage. The grade is
suggested from the number of mistakes (Know It, Hard or Learning) and the learner may
override it, since a slip is not the same as not knowing.

The edit dialog takes the wrong words one per line, not as a comma list. Book words
carry commas ("1,000", "however, the"), and the comma field split them on Save, so
opening a passage and saving it rewrote the book's wording without anyone typing a
character. An untouched field also gives back the stored list as it was, rather than a
re-parsed copy of it.

**Vocabulary terms** may end in IPA, `resilient /rɪˈzɪliənt/`
(`client/vocabulary-term.js`). The headword is shown large with the IPA under it, and
the speaker reads only the headword: a voice spells IPA out letter by letter.

---

## 5. Answering a card — `POST /api/attempts`

This one route is where learning is recorded. It does, in one transaction:

1. **Check the card is the user's.** The ownership join is the only gate; there is
   no foreign key on `attempts` to do it.
2. **Return `duplicate` for a known `clientId`.** The client resends answers it could
   not confirm (§12). One that already arrived must not be scheduled twice.
3. **Clear an upstream `updated` flag.** Answering a card KnowledgeApp reworded counts
   as having seen the change. A `deleted` flag is not cleared: a removal needs an
   explicit acknowledgement, or studying would hide the notice.
4. **Insert the attempt**, with the duration clamped to 5 minutes (a backgrounded tab
   can leave a card "shown" for hours) and a snapshot of the schedule it is about to
   change (`prev_state`, for undo, §7).
5. **Stop here if the card was not due.** The answer counts for stats, but the
   schedule is left alone. This is what makes cramming, retries and browsing harmless
   to FSRS: a card drilled five times in an hour is scheduled once. The response says
   `notDue`, and the client says so under the card.
6. **Rate the answer and schedule the card** with the user's own scheduler (§6),
   then move a review's due date to a quieter day within its fuzz range (§6).
7. **Count lapses for leeches** and report `became_leech` on the one answer that
   crosses the line.

After the transaction it records `due_zero` if nothing is left due (§11), sends the
response, and then — with `setImmediate`, so the next card is not held up — may start
a background fit of the personal model (§6).

### The rating

`ratingFor(correct, grade, source)` in `server/fsrs.js` maps the app's answer onto
FSRS's four ratings:

| Answer | Rating |
|---|---|
| wrong (flashcard Learning, wrong quiz option) | Again |
| flashcard Hard | Hard |
| flashcard Know It (no grade sent) | Good |
| flashcard Confident (`grade: "easy"`) | Easy |
| quiz correct, no grade | **Hard** |
| quiz correct with `grade: "medium"` | Good |

**A correct quiz answer is rated Hard** because picking the right option is
recognition, and recognition is weaker evidence of memory than recalling the answer
unprompted. FSRS's Hard always gives a shorter interval than Good for the same card,
so quiz answers earn less without any clamp. This replaced an earlier clamp on the old
step ladder (`RECOGNITION_CAP_STEP`) that did the same thing by arithmetic.

The preference **Quiz answers count as Know It** makes the client send
`grade: "medium"`; the server never reads the preference. It already trusted a
client-sent grade on flashcards, so this opens nothing new, and reading preferences
on every answer to learn what the client already knows would cost a JSON parse per
attempt. The attempt keeps `source = "quiz"`, so the stats can still tell the two
apart.

### Needs Recall

`last_correct_source` records whether a card's latest correct answer was a flashcard
or a quiz. **Needs Recall** in Study Setup is the due cards whose latest correct answer
was a quiz — known only by recognition. A graded quiz answer (the preference above) is
stored as `flashcard`, since it is scheduled like one. Choosing the filter switches the
mode to Flashcard but does not lock it.

### Leeches

A leech is a card forgotten 8 times since its text last changed (Anki's default,
`lib/leech.js`). The count is FSRS's own `fsrs_lapses` minus `card_states.leech_base`,
and the base moves up to the current count whenever the card's text changes — by the
learner's edit or by a KnowledgeApp update. A rewritten card therefore starts clean
without losing its schedule, and undo, which restores `fsrs_lapses`, keeps the count
right with nothing else to update. A second counter would have had to be kept in step
by every one of those paths.

On the answer that makes the eighth lapse, the study screen offers **Edit card**,
**Ask KnowledgeApp to rewrite** (term-def cards synced from KnowledgeApp only) or
**Keep studying**. The prompt is driven by the server's `became_leech`, not by the
client comparing counts, so it shows once, and an offline answer replayed later never
pops it up out of context. **Nothing is suspended.** Anki suspends leeches by default;
here the fix is a better card, not fewer reviews, and a suspended card is easy to
forget about.

---

## 6. Scheduling

### FSRS

The scheduler is FSRS through `ts-fsrs` (`server/fsrs.js`). Each card carries a
stability (days until recall falls to 90%) and a difficulty, and a card is scheduled
for the moment its predicted recall falls to the user's target. It replaced a fixed
ladder (10 min → 1 h → 4 h → 1 d → 3 d → 7 d → 21 d, then doubling) on 2026-08-06.
Existing progress was carried over by estimating each card's stability from its old
step, with a neutral difficulty of 5; due dates were left untouched so nobody's queue
reshuffled on the day.

The **maximum interval is 365 days**, against FSRS's default of 100 years, to match
the old ladder. Learning cards (FSRS states Learning and Relearning) step through
minutes; Review cards get intervals in days.

**Interval previews come from the server.** Each grade button shows what it would do
("Know It · 4h"). These are computed by `previewIntervals()` with the user's own
scheduler and attached to every card the API returns as `fsrs_preview_*`, rather than
recomputed in the browser. A client copy of FSRS would need a bundler and would drift
whenever the parameters or target changed. The preview is hidden on a card that is not
due, since grading it changes nothing (§5).

### How much to remember — three named choices

Preferences → Memory offers **Fewer reviews (85%)**, **Balanced (90%)** and **Remember
more (95%)**, stored as `preferences.targetRecall`. Each says what it buys (about 1
card in 7, 10 or 20 forgotten) and, once there are review cards, roughly what it costs
in reviews a day (`loadByTarget`, which leaves out lapses and so compares choices
rather than forecasting). The first version was a percentage slider plus a "train"
button that showed prediction errors; the user's verdict was that a learner cannot
weigh those numbers, so they were replaced with choices stated in reviews and
forgetting. A value saved by the old slider maps to the nearest choice.

### Adapt to my memory

FSRS has 21 parameters, fitted by default to a large public dataset. **Adapt to my
memory** (on by default) fits them to the user's own answers with the official
optimizer (`@open-spaced-repetition/binding`, the Rust `fsrs-rs`) (`lib/memory.js`):

- The first fit is at **400 answers**; below that a fit is mostly noise. The next fit
  comes after 1,000 more answers, or as many as the last fit used if that is fewer
  (400, 800, 1,600, 2,600…), because a small fit gains most from new data.
- Each card's history is rebuilt from `attempts` (rated with `ratingFor`, days in
  the user's local time). The fit trains on the earlier 80% and is compared with the
  defaults on the latest 20%, which neither saw; only each day's first cross-day answer
  counts there, since same-day reviews are not what the target controls (and the
  binding's `evaluate()` rejects them).
- **The fit is used only if it predicts better than the defaults.** Otherwise the
  defaults stay. Every outcome is written to `users.fsrs_last_fit`, so a fit that was
  no better is not retried on every answer. One status line under the switch says
  what happened.
- It runs in a **child process** (`lib/trainWorker.js`). On a history whose reviews all
  fell on one day the native optimizer panicked, and a native panic aborts the process
  it is in — in the server, every user's outage.

Measured: 3,200 training items fit in about 0.5 s, a real 596-answer history in 0.6 s.
On that history the fit was 27.5% error against the default's 27.8%, too close to be
worth applying — which is why the comparison decides, not the existence of a fit.

**What a new model does not do:** it applies to each card from its next answer.
Stability already stored is not recomputed. Replaying a history would have to
reproduce which answers were early (and so did not reschedule) and where the
balancer had moved each due date; a wrong replay would be worse than one review cycle
on old values. Turning the switch off ignores the stored model without deleting it.

`userScheduler(db, userId)` is the one place a scheduler is built, cached per
parameter set and target. Every due date, every preview and the recall KnowledgeApp
reads (`retrievability`) come from it.

### Load balancing and easy days

FSRS gives every card an exact interval, so cards learned together come due together,
and one big study day becomes a spike of reviews a week later. ts-fsrs's own fuzz was
off. `lib/workload.js` lets a review interval of **2.5 days or more** land anywhere in
**Anki's fuzz range** around it — about ±15% for short intervals, narrowing to ±5% past
20 days, so a 10-day interval can land on day 8 to 12 — and picks the day in that
range with the fewest reviews already due. Recall a few percent off the target date is
within a point or two of the target, so the schedule keeps its quality while the load
evens out.

- The pick is **deterministic** (fewest due, ties to the exact interval) rather than
  Anki's weighted random choice, so a test can say where a card lands. Each answer
  counts the cards already placed, so a batch learned together still spreads.
- **Easy days** are weekdays marked Light or Minimum. A Light day's reviews count
  double and a Minimum day's twenty times, so the balancer picks one only when every
  other day in range is fuller. A card never leaves its range, so a light day gets
  fewer reviews, not none.
- Learning steps and intervals under 2.5 days are never moved: they are minutes or
  hours, and moving one by a day would undo what the step is for.
- **Days here are local**, from the timezone offset each answer carries. Everywhere
  else days are UTC; a light Saturday that started at 07:00 in Vietnam would not be
  Saturday.

The cost is one indexed query over the user's due dates per review answer. The
interval shown on a grade button is the unbalanced one, so a card can land a day or
two either side of it.

---

## 7. Undo

After any flashcard grade a pill reads "Marked Confident · Undo" for 6 seconds
(`Ctrl/⌘+Z` too). Undo **deletes the attempt and writes back the schedule from the
snapshot** taken when the answer was recorded (`attempts.prev_state`,
`DELETE /api/attempts/:id`, `lib/undo.js`).

- **A snapshot, because FSRS cannot run backwards.** Stability and difficulty after an
  answer do not determine the values before it. The cost is a short JSON string on
  every attempt row, kept forever though only ten minutes of it can be used.
- **Deleted, not marked.** A misclick is not a study event. Marking it undone would
  have made every stat query — streak, goal, accuracy, study time, the rollup — learn
  to skip it. A trigger keeps `attempt_daily` right on the delete (§10).
- **Only the card's latest answer, and only for 10 minutes.** Restoring an older
  snapshot would silently discard the answers after it. "Latest" is by `rowid`, not
  `created_at`, so two answers in the same second are still ordered. The server window
  is longer than the pill so an undo waiting in the offline queue still lands.
- **Flashcards only.** A quiz answer is checked by the app, so there is no misjudged
  grade to take back, and an undo there would be a way to retry a wrong answer.

A snapshot of `{"notDue":true}` says the answer changed nothing, so nothing is
restored; `{"row":null}` says it was the card's first answer. A NULL `prev_state` is
an answer from before the column existed and cannot be undone.

---

## 8. Studying, on the client

A session is built in the browser from cards the API returns, and every answer is
posted as it is made. Nothing about a session is stored on the server except the
answers — so leaving mid-session loses nothing that matters, and the session's shape
(order, position) lives only in memory, or in `localStorage` for Resume.

### Study Setup

Four choices, saveable as named presets (server-stored, reorderable, keys 1–9):

- **Count**: 10, 25, 50 or all.
- **Filter**: All, Due Only, Needs Recall, Learning, Updated (changed by KnowledgeApp),
  Leeches. The footer reads "Study N of M matching cards" and Start is disabled at 0.
  When Due Only finds nothing only because of the daily review cap, Setup says so
  instead of "No cards match": the Home badge is deliberately uncapped, so an empty
  result next to "20 due" looked like a bug (§9).
- **Mode**: Flashcards, Flashcard & Write, Quiz.
- **Order**: In Order, Shuffle, Interleaved (multi-lesson only), Cram.

A preset chip is one button: a tap anywhere on it applies the preset, and it stays marked
until a pill changes what it set. Only its 78x20 name used to apply it, with a 22px
delete 4px away, so a slightly wide tap asked to delete it; deleting now lives only in
Manage presets.

**Shuffle** is weighted: a card's difficulty level, from its answer history, puts it in
the pool three times (hard), twice (medium) or once, before de-duplication, which front-
loads the hard ones. **Interleaved** groups cards by lesson, weighted-shuffles each
group, then takes one from each group in turn (`roundRobinMerge`). A plain shuffle only
interleaves on average; round-robin guarantees alternation while every group has cards,
which is the point of interleaved practice.

There is no study direction setting: a card is always studied front to back.

### Flashcards

- **Show answer first.** Until the card is flipped, the grade row is one Show answer
  button (`Space`), as in Anki. Grading a card sight-unseen contradicted the app's own
  advice to recall first, and four faded buttons read as broken.
- **Four grades**: Learning (Again), Hard, Know It (Good), Confident (Easy), keys 1–4,
  swipe right for Know It and left for Learning.
- **Flashcard & Write** adds a text box on the front. What is typed is never checked;
  it is echoed on the back for comparison. Two things make it more than a text box:
  - **Hints** uncover the answer one word at a time. Using one caps the grade at
    Hard — an answer recalled with words showing was not recalled unaided, and Know It
    or Confident would push the next review further out than the memory supports. The
    cap is enforced in `markCard()` as well as on the buttons, because the keys and the
    swipe do not go through a disabled button.
  - **Forced retype**: grading Learning or Hard requires typing the answer once on the
    back before moving on, tolerating one typo (edit distance 1). An answer containing
    LaTeX gets an "I recalled it" button instead, since its stored text is `$…$`
    source the learner never sees.
  - **Typing on a phone.** Curly quotes, dashes and "…" are folded to plain characters
    before the comparison (`normalizeAnswerText`), because iOS Smart Punctuation types
    `don’t` and a correct retype failed against the card's `don't`. Both boxes switch off
    autocorrect, autocapitalize and spellcheck: autocorrect "fixed" a term into a
    different word. Enter pressed while an IME is still composing (Telex or VNI,
    `isComposing` or keyCode 229) confirms the syllable and does not answer. Before, it
    sent half a Vietnamese word.
- **Why?** On a KnowledgeApp card, the learner writes a few words on why the answer is
  right, then sees the book passage the card came from. Explaining before checking makes
  a miss stick better than re-reading. The passage is stored on the card (`cards.source`),
  so there is no model call; what the learner writes is not saved.

### Quiz

`buildQuizOptions(card)` decides the choices:

| Format | Options |
|---|---|
| `mcq` | the card's own `correct` + `distractors` |
| `true-false` | True, False |
| `term-def`, `image-def` | the definition + up to 3 other definitions of the same format, from the session, then the quiz pool, then the open lesson |
| `cloze` | what fills the other cloze cards' gaps |
| `gapfill` | one gap asked, the others filled in; wrong words from the passage's own distractors first, then its other gaps, never another passage's |

With too few other definitions a question shows fewer choices rather than padding with
"—", which gave the answer away. A retry of missed cards keeps the whole session as the
distractor pool, or two missed cards would make a two-option question.

**MCQ options are only as good as the card.** The app never invents an MCQ distractor;
if a card's own `distractors` contains a correct statement, the quiz will show two right
answers. Such a card has to be edited.

A correct answer moves on by itself after 1.2 s (`QUIZ_ADVANCE_MS`); a wrong one waits for
Next, so the right option can be studied for as long as it takes. A correct answer used to
wait too whenever there was an explanation or a book passage, and since nearly every synced
card carries a passage, the user pressed Next after almost every question. Reading after a
right answer is opt-in instead: opening the explanation or the passage, or selecting a word
to save, stops the timer (`pauseQuizAdvance`) and shows Next. Briefly every answer moved on,
a wrong one after 2.5 s; the user wanted the wrong answer to wait. After a wrong answer the right
option is scrolled above the sheet (`revealRightQuizOption`): on a phone the sheet
covered the lower options, so the one thing worth seeing was under it. Each new question
starts at the top of the page, since a page left scrolled put a different option under
the finger that had pressed Next. A bottom sheet answers each choice (praise, combos
at 3, 5, 10 and every ten after, a calm line on a miss) and holds Next in the same place
every time. It appears only in Quiz, where the app decides right from wrong: praising a
flashcard self-grade would be praising the learner for their own button press.

### Cram

Cramming is the opposite of what FSRS is for — the same card several times in an hour —
so cram is **a different queue in front of the scheduler, not a change to it**. Every
answer still goes to `POST /api/attempts`, which leaves a card that is not due untouched
(§5), so drilling cannot push intervals around. In a round, a missed card comes back 3
cards later and a recalled one 8, and a card leaves after 3 correct answers. A dated
cram (`crams` table) spaces rounds at 15% of the time left, between 20 minutes and a
day, turns into a final review of the most-missed cards within 12 hours of the test, and
suggests sleep after 22:00 with the test under a day away (`docs/research.md` §6).
Per-card progress is read from `attempts` since the cram began rather than stored, so
undo and offline replays correct it with nothing to keep in step.

### Study now

Home's Today tile starts one session across every class: due cards, most overdue first,
then never-answered cards in course order (class, lesson, card). **The server picks the
cards** (`POST /api/cards/study-now`): building the session in the browser would mean
downloading every card of every lesson, thousands for a library made from whole books,
to use a few dozen. **The client says how many of each**, because it already holds the
review cap, today's reviews and the new-card estimate the Today meters show, and the
button must promise the numbers those meters show. `reviews: null` means no cap.

Due cards come first and are not mixed with new ones: overdue reviews are what a missed
day costs, new cards are optional. New cards keep course order, because a book's
chapters build on each other.

**Reviews and new cards are two sessions.** The user quizzes to review and uses flashcards
to learn new terms: a quiz on a card never seen tests a guess, and a flip card on a known
one is slower than picking an answer. So the button starts the due cards in the mode the
switch under it chooses (Flashcards or Quiz, remembered in the account's preferences as
`studyNowMode` because it is a habit, not a property of one phone), and holds the new cards
back. The reviews' summary then offers "Learn N new cards", which starts them as
flashcards; Back to Home drops them. With nothing due the button goes straight to the new
cards and the switch is hidden, since it has nothing to decide. The cards are fetched once,
when the button is pressed, and split by whether they have a due date, so the second
session costs no request. The cost: a learner who wants to quiz new cards has to go
through Study Setup.

**An account with no cards is not "done".** With nothing due the tile reads "All done for
today", which on a new account told someone who had not started that they had finished.
With no cards at all (`summary.cards` is 0) it says "No cards yet" and offers New class.
Likewise an empty Home says "No classes match these filters" when filters hide every
class, and offers New class only when there are none. An empty class offers + Lesson.

### Resume

A flashcard session left part way comes back on Home as "Continue · 5 cards left". It is
saved in `localStorage` (`fc-resume-<user id>`) after every grade and undo — card ids in
order, grades so far, which cards were new, the lessons and the time spent. **On the
device, not the account**: every grade is already saved to the account; what a close
loses is only the session's shape, worth keeping for the rest of a day but not worth a
table, a route and a sync story. It expires at the UTC day change, and stores ids only,
so resuming reloads the cards and an edit made meanwhile is never undone by a stale copy.
Quiz and cram are not saved: a quiz's options are drawn per session, and cram rounds
reorder as they are answered. With two cards or fewer left nothing is saved.

### Session end

The summary compares `GET /api/stats/today` from the start of the session with a fresh
read at the end, after the offline queue has drained (`store.writesSettled()`), and says
what changed: "Day streak 9 → 10", "Daily goal reached", a new medal, a finished lesson,
a new daily record. **Measured, not inferred**: the server owns the day boundary and the
rest-day rule, and a client-side guess would disagree with Home the first time either
changed. The cost is a request at each end; offline, the lines are left out rather than
guessed. At most three extras are shown, what happened before what nearly happened.

Those lines arrive a second or so after the screen, so on a phone the buttons are pinned
to the bottom of the screen from the start. Below the content, the late lines pushed Back to
Lesson from 560px to 1034px down a 667px screen, moving it out from under a finger on its
way to tap. The cost is a strip of screen the buttons always hold: two rows on Results.

---

## 9. The daily numbers

### Streak and rest days

`lib/streak.js` counts consecutive UTC days with at least one graded answer, flashcard
or quiz. **One missed day per Monday–Sunday week is a rest day**: it does not break the
streak and does not add to it. It is Duolingo's Streak Freeze made automatic and free —
the app has no currency to buy one with, and a rule nobody has to manage cannot be
forgotten. Its purpose is to stop one missed Sunday ending a 60-day run, which is when
people stop altogether.

- A rest day bridges **one** gap. Two missed days in a row end the streak, even across a
  week boundary, so the rule cannot be read as "every other day".
- Walking back from today, the most recent gap of a week takes that week's rest day.
- **Today is never a gap**: until UTC midnight it is still open.
- It is computed over the whole history, so some streaks grew on the day it shipped.

While today is unstudied and the rest day is still free, Home says "Rest day available
today" instead of a countdown, because missing today would not reset anything.

### The UTC day

The streak's day, the daily goal, the review cap and the weekly recap use the UTC date
(`date(created_at, 'unixepoch')`), so they roll over together at one moment. For a
learner in Vietnam that moment is 07:00. The countdown's tooltip says so, the evening
streak reminder is timed for it (§17), and its text names no hour. Moving to local days
would be the better design but would change every user's history.

### New cards and reviews today

`lib/today.js`: **a card is new on the UTC day of its first answer, and every answer to a
card first answered on an earlier day is a review.** A new card answered twice today is
one new card and no reviews: the second answer is still learning it. No "new" flag is
stored; a card's first answer date says when it was new.

- **Max reviews per day** caps sessions, not badges. It applies to Due Only, Needs
  Recall, the lesson's quick quiz, the Dashboard's due rows and Study now; due counts
  elsewhere stay true, as in Anki ("limits affect sessions, not totals"). It counts
  reviews only — the same number Home shows against it ("269 / 300"). It once counted
  every answer today, new cards included; changing it meant anyone who had set the cap
  with the old count in mind now gets a few more reviews a day.
- **New cards recommended today** (`GET /api/stats/new-card-estimate`) is the user's
  average new cards per active day, scaled by accuracy over the last 7 days (×1.15 at
  85% or more, ×1.0 from 70%, ×0.7 from 50%, ×0.4 below), capped at the cards left.
  Under three active days it is a flat 10, with different wording, so a new account is
  not shown a fake-precise number. Today's new cards count towards the pool: capping by
  the never-touched pool alone shrank the goal as it was met ("6 / 0" after learning the
  last six).
- **Daily goal**: cards answered today, every graded flashcard and quiz answer (Off, 10,
  20, 30, 50; default 20). Cards, not minutes or XP, because cards are what the app
  already counts and the number visibly moves with every answer.

### Above-average run

A second streak in the Streak tile: consecutive days whose study time beat the mean of
the 30 days before them, **unstudied days counted as 0** (`lib/aboveAvg.js`). Counting
skipped days is what makes it a rolling mean of the habit: after a week off the bar
drops and a normal day counts again, while a study-day average would hold the bar at
the learner's best weeks. Today joins the run only after it passes its mean; until then
the run shown ends yesterday, with the minutes still needed — the same convention as
the day streak, so a run does not read as broken every morning.

### Weekly recap

On the first Home of a week, a sheet: days studied, answers and new cards against the
week before, and the class with the most answers. It was meant to show "the class that
advanced most", but mastery is a current state with no history, so when a card became
mastered is not known. Seen weeks are stored in preferences (`weekRecapSeen`), so a recap
closed on the phone does not reappear on the laptop.

---

## 10. Stats and the rollup

**`attempt_daily`** holds attempts summed per user, UTC day, source, grade and
correct (`lib/attemptDaily.js`). The heatmap, weekly trends, grade mix and study time
read it instead of rescanning `attempts`.

Measured on a synthetic account the size of the real one (80k cards, 120k attempts):
`/api/stats/analytics` took 0.98 s and `/api/stats/dashboard` 0.38 s, during which the
synchronous server answered nobody. The rollup is about 3k rows for 120k attempts, and
the heatmap query fell from 182 ms to 1 ms.

- **Kept by triggers, not by route code.** Attempts are written by grading, deleted by
  undo, re-sent by the account import and removed by an account's cascade delete. A
  trigger runs inside whichever transaction wrote the attempt, so no future writer can
  forget it. The write cost was too small to measure, about 15 ms per answer either way,
  nearly all of it the commit.
- **Derived data.** `attempts` stays the source of truth; `rebuild()` recomputes the
  table, and a test holds the incrementally kept table equal to a rebuild after inserts,
  undo, edits, a duplicate import and an account delete.
- **The trap:** a migration that rebuilds `attempts` drops the triggers with the old
  table and must call `attemptDaily.install` again. `db.js` says so where the
  migrations are.
- `grade` is `''` rather than NULL in the key, because a NULL never conflicts and the
  upsert would add a row each time.

The per-card queries (lesson breakdown, struggling lessons) need each attempt's card,
which the rollup drops. An index on `(user_id, card_id, created_at, correct)` sped the
breakdown up, but node-sqlite3-wasm's planner, which has no statistics, also chose it
for the dashboard's `ORDER BY created_at DESC LIMIT` query — 1 ms to 159 ms — so there is
no such index. Summing per card before joining took the breakdown from 287 to 145 ms.

**Windows are whole UTC days.** Counting back `days × 86400` seconds cut the oldest
heatmap day partway (331 of its 1,024 attempts in the measurement).

**Mastered** means a Review card scheduled 21 days or more out — Anki's "mature" line,
and an edge of the Memory Interval chart, so the two agree (`lib/mastery.js`). The
lesson mastery bar, the class medallion and the achievements all use this one
definition. A class shows **Learned** once no card is New or Learning and **Mastered**
once every card is mastered; neither is stored, so a card falling back takes it away —
a badge that outlived its claim would say something untrue. An incomplete class shows at
most 99%, so 239 of 240 never reads "100%".

**Accuracy is observed, not predicted**: the weekly Accuracy chart is correct answers
over all answers, not FSRS's predicted recall.

**A list screen's bars come in one request.** Home asked twice per class (its lesson list,
only to count it, and `GET /progress/class/:id`), 22 requests for six classes, and the class
screen twice per lesson (every card, only to count them, and `GET /progress/lesson/:id`),
a hundred for a fifty-lesson book, each a round trip on a phone connection. Now
`GET /api/classes` carries `lesson_count`, the lesson list carries `card_count`, and
`POST /progress/classes` and `POST /progress/lessons` answer for every id at once, from the
same `classProgress`/`lessonProgress` the single routes use, and leave out ids that are not
the user's. Home keeps what it loaded, so a re-sort or a filter asks nothing; coming back
to Home loads it again. The offline store has no round trips to save and answers the batch
calls one id at a time. POST because the id lists outgrow a URL; nothing is written.

---

## 11. Achievements

27 achievements in five groups, **computed from stored data on every request**
(`lib/achievements.js` is pure; `routes/achievements.js` gathers the facts, about 30 ms
on the test account). Computing rather than counting means the rules can change and the
whole history counts at once. They reward showing up, struggling and method more than
volume; nothing rewards cramming (there is no "most cards in a day").

- **Earned tiers are stored** (`user_achievements`) only so an achievement about the past
  — a 30-day streak — is not taken away when the streak ends, and so the page can say
  when it was earned.
- **Five describe the present** (Class mastered, Lesson mastered, Cards in long-term
  memory, Vocabulary in use, Recall cleared). Those show the current tier and fade to
  "was earned" when lost.
- **Four needed data the app did not record**, so they count from the day they shipped:
  `attempts.typed` (Writer), and `study_events` rows `second_look`, `card_fix` and
  `due_zero`. **Due zero is written only by the server**, after an answer leaves nothing
  due, because a client-reported "nothing was due" could be posted by anyone. Second look
  and Card fixer are client events, since only the client sees them; the worst a forged
  one does is award itself a badge.
- Sessions are inferred from 10-minute gaps, because attempts carry no session id.

---

## 12. Offline, and the service worker

**Answers survive a bad connection.** A grade made on flaky mobile data used to be
dropped silently: the card turned green, the request never landed, and the schedule
drifted. Now every answer and known-state write goes through one queue in the client
(`SQLiteAdapter`):

- A write that fails for a reason that may pass — no response, a 15 s timeout, 401,
  408, 429, 5xx, or a 200 that is not JSON (a captive portal) — is appended to
  `localStorage["fc-pending-writes:<userId>"]` and replayed in order. Other 4xx are
  dropped. A plain 500 is retried up to 5 times, so a persistent server bug cannot wedge
  the queue.
- **The key is chosen when the answer is made**, because a 401 signs the user out before
  the failure comes back.
- **One promise chain** carries every queued write, new or replayed, so a replay and a
  new answer never interleave and known-state PUTs stay in order with their attempts.
- **Idempotency by client id.** A request can arrive and lose its response, so each
  attempt carries a random `clientId` used as its primary key; the server answers
  `duplicate` for one it already has (§5). The insert, the flag clear and the schedule
  update share one transaction — otherwise a failure after the insert would leave an
  attempt whose schedule never moved, and the resend would be skipped as a duplicate.

Accepted costs: a replayed answer is dated and scheduled at replay time (accepting a
client timestamp would let any client backdate reviews), and two open tabs can both
replay the same queue — attempts de-duplicate, and the worst case is a stale known-state
PUT winning. Undo goes through the same queue, so offline an answer and its undo replay
in order.

**When the queue drains:** on `online`, at login, before the next answer, when the app
comes back to the screen (`visibilitychange`), and once a minute while it is on screen.
`online` alone was not enough: iOS rarely fires it when a weak signal recovers, and an
app reopened from the background fires nothing, so answers sat on the phone until the
next session. A drain with an empty queue sends nothing, so the timer costs no requests.

**Home says when it cannot load.** A failed class list used to leave Home blank with no
message, which is what an offline launch looked like. It now says the app is offline (or
that the classes could not load), offers Try again, and reloads on its own at `online`.
A list already shown in this visit is kept rather than replaced by the message.

**The service worker** (`client/sw.js`) keeps the app shell available offline:
network-first for the app files, so a deploy shows on the next load, but the network
gets 3 seconds (`NETWORK_WAIT_MS`) before a cached copy answers instead. On a weak
signal a request neither fails nor answers, and waiting on it was a white screen for as
long as the phone held the connection; the late answer still refreshes the cache. The
cost: a deploy can take one extra launch to show on a slow connection. With nothing
cached the app keeps waiting rather than answer with an error; cache-first for
`/vendor/` (KaTeX ships with the app, since loading it from a CDN on a weak signal left
formulas as raw `$\hat\beta$`); and it never answers `/api`, `/auth`, `/uploads`,
`/share` or `/reset-password`. It also shows reminder notifications (§17).

---

## 13. KnowledgeApp integration

KnowledgeApp runs on the owner's Mac; FlashcardApp runs on Railway. **Only KnowledgeApp
can start a conversation**, so the integration is push: KnowledgeApp calls
`/api/integrations/knowledge/*` and reads back what it needs. A manual "import the
updated file" was rejected because changes had to arrive without a manual step.

### Authentication

A **personal API token** (Preferences → Account & data), not OAuth or a session cookie:
one user, one trusted local client, and a revocable random token is the smallest thing
that works. Only its SHA-256 is stored — 256 bits of randomness need no slow hash. The
router is mounted **before** the session middleware and sets `req.userId`, never
`req.session`: sessions use `saveUninitialized: false`, and touching the session from a
token-authenticated call would create a session row per request. It is rate-limited to
120 requests a minute per token.

### Links

A KnowledgeApp unit and the FlashcardApp cards made from it share an id:
`cards.external_id`. Several cards may carry one id (a card in two classes, or a class
cloned). Cards imported before external ids existed were linked once by **exact**
trimmed term and definition (`/link`), skipping any text that matched more than one
unit: a wrong link means a later update silently overwrites an unrelated card. Links by
meaning come from KnowledgeApp's side (`/link-cards`), which never overwrites a
different link.

### Events — `POST /events`

Up to 500 events a request, each applied in its own transaction so one bad event does
not undo the rest:

| Event | Effect on every linked card |
|---|---|
| `updated` | new text; flagged `updated`; **due now**, stability kept; leech count reset |
| `deleted` | flagged `deleted` only — card, schedule and history stay |
| `restored` | clears a `deleted` flag, then applies the text |
| `split` | the card's text becomes the first part; the other parts are added after it in its lesson |

- **Auto-apply and flag**, instead of proposing and waiting for acceptance, so there is
  no review queue to clear before studying. `upstream_prev_data` keeps the content from
  before the **first** unacknowledged change, so several edits still compare against
  what the learner actually studied. If an update brings the text back to that version,
  the flag clears itself.
- **Due now, memory kept.** Resetting a reworded card to new would throw away real
  learning for what is usually a clarification; leaving its schedule alone would let a
  changed card sit unseen for months. A card never answered has no due date and stays
  new.
- **A deletion only flags.** The learner's card, schedule and history belong to them.
  Answering does not clear a `deleted` flag (unlike `updated`), so the notice is not
  lost by studying.
- **Replay-safe from the card's current state, not an event log.** Same text → `noop`,
  split card already in the lesson → skipped, already deleted → `noop`. KnowledgeApp
  retries whole batches whose response it never saw; a processed-event table would be
  one more thing to grow and prune.
- If an event for a card fails, later events for the same card in that request are
  held, so they cannot apply out of order.

The **Updates** screen lists flagged cards with a word-level diff of the old and new
text — except for fields containing LaTeX, where highlight spans cannot be threaded
through KaTeX output and a diff of the raw source would show noise the learner never
sees. Mark reviewed clears the flag (with a 6-second Undo, sent when it expires, because
the server has no un-acknowledge). The Undo bar's text is one line cut with an ellipsis; a
long card name had run it past the edge of a phone screen, taking the Undo button with it.

### Classes and lessons from KnowledgeApp's side

| Route | What it is for |
|---|---|
| `GET /classes`, `POST /classes` | list classes; create one for a book that has none |
| `POST /add-cards` | add cards into an existing class, into a lesson, after a card, or into a new lesson |
| `PUT /classes/:id/layout` | move linked cards into KnowledgeApp's current lessons, in its order |
| `PUT /lessons/:id` | rename a lesson in place |
| `GET /classes/:id/cards` | every card with its position, for reconciling |
| `POST /convert-cards` | rewrite mcq / true-false cards as term-def in place |
| `POST /sources` | set the book passage shown under a card |
| `POST /remove-cards` | delete cards KnowledgeApp made, for a kind of card the learner asked to take back |
| `GET /deletions?since=` | linked cards the learner deleted |

**The study order of a KnowledgeApp class belongs to KnowledgeApp.** Lesson order and
card order follow the book as KnowledgeApp lays it out, and a change to that order starts
there (`ka lessons`, then `ka sync --relayout`, which arrives through `layout` below);
FlashcardApp does not reorder those cards by itself. Study now's "course order" (§8) is
therefore the book's order. Reordering here by prerequisite links was measured and
rejected (2026-10-19): of 38,044 links, 62% already follow book order and 26%
point to a later lesson, but most of those reach more than ten lessons ahead and a sample
of them was half word matches ("Kernel Trick" needing a convolution "Kernel") -- the rest
were the book naming a concept before its chapter explains it, on purpose. Following them
would pull chapter 18 into chapter 13. A knowledge map was considered at the same time and
not built: Khan Academy and Duolingo both moved to a linear path, and this data's 2-D map
positions carry little meaning.

The rule behind all of them: **a card is moved or rewritten in place, never recreated**,
so its id, schedule and answer history survive. `layout` reuses, for each target lesson,
the existing lesson that already holds most of its cards (renamed if needed), removes
lessons the moves leave empty, and leaves the learner's own cards and empty lessons
alone. `convert-cards` keeps the schedule as it was (deliberately not due) and stores the
original in `converted_from` so the conversion can be undone. `sort_order` repeats, so
a lesson's order is rewritten densely when cards are inserted after an anchor.

**No route edits an existing card's data except through events.** A wrong card fixed on
KnowledgeApp's side arrives as an `updated` event; a card that exists only here (an MCQ
typed by hand) can only be fixed in the app.

**Deletions flow back.** A linked card the learner deletes is recorded in
`external_card_deletions` with a `kind`: `card` means "this card is wrong", and
KnowledgeApp removes the unit; `lesson` came with its whole lesson, "stop studying
these", and KnowledgeApp keeps the units but stops sending them. Deleting a class
writes none — that is unpairing the book, handled on KnowledgeApp's side. KnowledgeApp
keeps the cursor, so a lost response is simply read again.

### Requests the learner sends

- **Saved words.** Selecting English text on a card (or in a quiz after answering)
  offers Save as English word; the selection and its sentence go to
  `vocabulary_requests`. KnowledgeApp defines it and adds a card to English
  Vocabulary → Saved Words, then marks the request complete. A word is a duplicate only
  **in the same context** (`lib/vocabularyDup.js`): "bank" by a river and "bank" that
  lends are two cards worth having, and the context is what tells KnowledgeApp which
  sense to define. A completed request counts only while its card exists, so deleting
  the card is how a word gets saved again.
- **Leech rewrites.** Ask KnowledgeApp to rewrite (§5) creates a `rewrite_requests` row;
  KnowledgeApp reads the card's current text, and the new wording comes back as an
  ordinary `updated` event, which also resets the leech count. The rewrite goes through
  KnowledgeApp rather than a model call here because KnowledgeApp owns the card's source
  passage and history; the cost is waiting for its next run.

KnowledgeApp also reads progress back — per-card recall from `userScheduler` — to show
how much of each book has been learned.

---

## 14. Reliability: living with a synchronous database

### Why it matters

node-sqlite3-wasm runs every statement on the event loop. One slow query stalls every
request at once — the 2026-08-13 incident's latency graph showed p50 through p99 rising
in lockstep. Each measure below removes one way of holding the loop.

### WAL, synchronous=NORMAL, behind an exclusive lock

A KnowledgeApp sync of 500 events, one transaction each, took 7.5 s on a laptop SSD with
SQLite's default rollback journal (several fsyncs per commit), and a `/health` request
sent during it waited 7.9 s; on Railway's slower volume it ended in 502s. With WAL and
`synchronous=NORMAL` the same sync took 0.1 s and the longest wait 0.07 s. WAL alone,
still syncing every commit, was 2.4 s.

- **The cost of NORMAL**: a power cut or host crash can lose the commits since the last
  checkpoint. The file stays consistent, and a process crash or restart loses nothing
  (tested with `kill -9` and `integrity_check`). A few seconds of possible loss on a host
  failure is a better trade than a server that stops answering during every sync.
- **Why EXCLUSIVE**: WAL needs shared memory, and this WASM build has no VFS for it.
  Without `locking_mode=EXCLUSIVE`, `PRAGMA journal_mode=WAL` quietly answers `delete`.
  With it, no second process can open the file while the server runs.
- **Rolling back past this change** needs one start with `DB_JOURNAL_MODE=delete`, which
  converts the file back; older code cannot open a WAL file at all.

### The lock and its heartbeat

node-sqlite3-wasm locks a database by creating the directory `flashcards.db.lock`. A
crash leaves it behind, so `db.js` used to delete it on every start — including when its
holder was alive: a second `npm start`, or any script requiring `db.js`, took the lock
from a running server and both wrote the same file. Two writers corrupt SQLite.

Now the holder writes `owner.json` (pid, host, start time) into the lock directory and
touches it every 3 s (`lib/dbLock.js`). A start clears the lock only if its holder is
gone: on the same host, the pid is not running (or is its own, reused in a fresh
container); on another host, where a pid means nothing, the heartbeat is more than 10 s
old. A holder that finds its owner file replaced exits rather than write a file someone
else has opened. On Railway each deploy is a new container with a new hostname, so after
an unclean stop the next start can wait up to 10 s, within the 30 s healthcheck.

### Every statement is finalized

node-sqlite3-wasm has no finalizer: a prepared statement stays in SQLite until
`finalize()` or the connection closes. The `db.prepare` wrapper (which lets routes pass
spread arguments, as with better-sqlite3) never finalized, so each of the 323 call sites
left a statement behind on every request — about 2.6 KB each, and every later call slowed
in proportion: after 16k, a read took 136 µs instead of 6. Only deploys, which restart
the server, kept it usable. The wrapper now prepares, runs and finalizes on every `run`,
`get` or `all`, including when the call throws. Re-preparing costs about 4 µs a call; a
statement cache would need resets, eviction and finalizing before every close and table
rebuild, and an open statement is exactly what once made a migration's `DROP TABLE` fail
with "database table is locked". A test holds the open-statement count at zero through
the migrations and real dashboard requests.

### Watchdog, rate limits, request log

- **Watchdog** (`middleware/watchdog.js`): if the event loop stops responding for too
  long, the process exits so Railway restarts it. Railway's healthcheck runs only during
  a deploy and its restart policy only reacts to an exit, so a hung but alive process was
  invisible to both. It cannot catch a true infinite loop, only the slow-but-finishes
  case that actually happened. It measures with a monotonic clock, so a host clock jump
  cannot kill a healthy process.
- **Rate limits** (`middleware/rateLimit.js`) are in memory, since the app is one process.
  Routes behind sign-in key by user, not IP, so people behind one NAT do not use up each
  other's quota; only pre-auth routes key by IP. `trust proxy` is on in production only:
  without Railway's proxy in front, trusting `X-Forwarded-For` would let a client choose
  its own IP.
- **Request log** writes the route **pattern**, never the path, because share,
  password-reset and invite tokens travel in paths. An unmatched request logs no path at
  all for the same reason.
- `express.json` is capped at 10 KB on `/api/auth` (a large body is parsed before any
  limiter can refuse it) and 10 MB elsewhere for account imports.

### Backups

Nightly at 18:00 UTC (01:00 in Vietnam), the server writes a copy with **`VACUUM INTO`**
from inside its own connection — under EXCLUSIVE nothing else may open the file, and
copying bytes would miss whatever is in the WAL. Measured 0.39 s for a 51 MB database. It
runs `quick_check` (0.14 s, against 1.2 s for `integrity_check`, all on the event loop),
keeps seven, and writes under a temporary name renamed only after the check. The owner's
Mac pulls the newest at 03:00 (`scripts/pull-backup.sh`, LaunchAgent
`com.flashcardapp.backup`), runs the full `integrity_check` where time costs nothing, and
keeps 30. Two places for two losses: copies on the volume cover a bad migration or a
mistaken delete, the pulled ones cover losing the volume.

The route uses its own `BACKUP_TOKEN` (the file holds every account, so no user's session
or API token may open it), sent in a header, compared in constant time, ten tries an hour
per address; without the variable it answers 404. **Failure is loud**: a failed pull, or a
server copy more than two days old, raises a macOS notification, because backups usually
fail by stopping quietly. Uploaded images are not included, and restoring is by hand.

---

## 15. Security

- **Sessions** are express-session cookies (30 days, `httpOnly`, `sameSite=lax`) stored in
  SQLite (`sessionStore.js`), because the original MemoryStore lost every login on each
  container restart.
- **Passwords** are bcrypt (cost 10). **Google sign-in** is a direct OAuth code exchange
  with `fetch`, not passport; its callback is rate-limited because each hit makes two
  outbound calls.
- **API tokens** are stored as SHA-256 and shown once (§13). The **backup token** is
  separate (§14).
- **Import cannot write into another account.** `POST /api/import` once resolved a
  parent as `idMap[old] || old`, so a row could name another user's class id and be
  inserted into it. Rows now attach only to parents created from the same file.
- **Push endpoints are checked** against known push services (Google, Mozilla, Apple,
  Windows): the endpoint comes from the browser, and otherwise any signed-in user could
  make the server post to an address of their choosing.
- **Server errors carry a `code`** the client translates (`error.<code>`), keeping the
  English `error` text for API clients. The server does not know the user's language on
  unauthenticated routes, and KnowledgeApp reads the text.
- **Parameterized SQL only** (`?` placeholders), a rule in `CLAUDE.md`. `IN (…)` lists go
  through `lib/batch.js` in chunks, since SQLite caps bound variables per statement.

---

## 16. The client

### One file, organised by section

`app.js` is plain ES5-style JavaScript: `var`, function declarations, string-built HTML.
Everything is global. `state` holds the session and screen state; `store` is either
`SQLiteAdapter` (server) or `LocalStorageAdapter` (local), with the same methods.
`showScreen(id)` swaps screens; there is no URL routing, so the last list screen is saved
in `localStorage["fc-last-screen"]` and restored on load.
Each screen still opens at the top, but Back from a lesson to its class, or from a class
to Home, returns to where the list was (`scrollMemory`, keyed by screen and class or
lesson id). Every screen used to open at the top, so leaving lesson 240 of a 300-lesson
class meant scrolling about 30,000px back to it. The list renders after its data
arrives, so the restore keeps trying for up to 3 s and gives up the moment the learner
scrolls.

**Every string from a card or a user goes through `escHtml()`** before it reaches
`innerHTML`. LaTeX (`$…$`) is rendered by KaTeX after the HTML is in place.

**A display formula scrolls inside itself** (`.katex-display`, everywhere, not only on the
card faces), and option text, explanations and book passages break long words and URLs.
Before, a wide formula in a quiz question or explanation made the whole study screen
wider than the phone (measured in WebKit: 458px of page on a 390px screen), so every
drag panned the page. On the flashcard a sideways drag that starts on a formula wider
than the card scrolls the formula and does not grade: the two are the same gesture, and
the formula was graded instead of read.

### i18n

`TRANSLATIONS.en` and `TRANSLATIONS.vi` are plain dictionaries; `t(key, vars)` looks a key
up with English as fallback, and `applyI18n()` fills elements carrying `data-i18n*`
attributes. Hand-rolled because i18next and FormatJS expect a build step. Plurals use a
`key_one` variant when `n` is 1 (English needs nothing more; Vietnamese has no plural
forms). `applyI18n` replaces only a button's last text node, so inline SVG icons survive
a language switch.

**Server messages are English, so Vietnamese never shows them.** `serverError()`
translates a response's `code` (`error.<code>`); without one it used to show the
server's `error` text, which in Vietnamese gave toasts like "Không lưu được: Not found".
In Vietnamese a codeless error now shows the translated fallback with its status, and
the validation errors a learner can trigger (cram name and test time, a vocabulary
selection) carry codes. English still shows the server's words, which say more.

**One word per idea in Vietnamese:** a card is *thẻ*, a tag is *nhãn* ("Gợi ý thẻ" read
as "suggest cards"); due is *đến hạn*; a leech is *thẻ khó nhớ* (plain "Khó nhớ" looked
like the Hard grade, *Khó*); the Know It grade and the session's known count are both
*Đã thuộc*; Flashcards and Quiz are *Thẻ ghi nhớ* and *Trắc nghiệm* everywhere. Markup
text, `aria-label` and `alt` carry `data-i18n`, `data-i18n-aria` or `data-i18n-alt`.

**Numbers and dates follow the app's language, not the phone's.** `appLocale()` returns
`vi-VN` or `en-US` and every `toLocaleString`/`toLocaleDateString` passes it. Left to the
browser, a phone set to English printed "1,234" and "Oct 19" inside Vietnamese
sentences, where a Vietnamese reader expects "1.234" and "19 Th10". Day-month order is a
translation (`chart.dayMonth`), not a locale call, so the heatmap tip reads the right way
round. The one exception is the cram clock in English, which keeps the phone's locale so
the phone's 12/24-hour setting wins.

### Look

Two independent preferences: **theme** (Light, Dark, Match device) and **palette**
(Parchment and about twenty others), so every palette works in both modes and Match
device keeps working whichever palette is chosen. Palettes override only neutrals,
accent and card back; semantic colours (wrong is red) are shared. **Contrast is tested,
not eyeballed**: `tests/palettes.test.js` checks every text token at 4.5:1 or more on
every surface it sits on, in every palette and mode — too many pairs to check by hand.
Dark mode has a separate High contrast option rather than a more saturated default,
following GitHub and Material: saturated colour vibrates on grey, and near-white text
halates for readers with astigmatism.

The retype check's Correct / Try again line uses `--success` and `--danger`, and the test
covers them on `--card-back`. It used fixed dark-mode greens and reds, `#4ade80` and
`#f87171`, which measured 1.47:1 and 2.34:1 on the light card back. Nord and Everforest
in dark mode get a lighter `--danger`, because their card backs are light enough to
take the shared dark red under 4.5:1 (3.98:1 in Nord).

### Screens on a phone

Most study happens on an iPhone, and several decisions are about it:

- **No Back trap on iPhone and iPad.** A history entry kept for Back made iOS run its own
  edge-swipe-back onto a blank snapshot of the page. On iOS no entry is ever pushed and
  the app's own edge swipe (`SCREEN_BACK_BTN`) is the only Back; elsewhere an entry exists
  only while there is somewhere in-app to go back to (`syncBackTrap`).
- **Vietnamese runs longer than English**, so a row of controls must wrap rather than
  squeeze. On Home "Lớp của bạn" shared a row with "Sắp xếp theo" and a select sized to
  "Hoạt động gần nhất", and became one word a line (81px tall at 375px, measured). The
  heading no longer wraps, the row does, and under 430px "Sort by" is for screen readers
  only.
- **The grades are the bottom row** of the flashcard screen, Prev/Next the row above.
  Prev/Next used to be the bottom row, 8px under Confident: a slip skipped a card
  ungraded, and on the last card the same spot is Finish. Landscape keeps one row.
- **Home reloads when the app comes back** after the UTC day changed or after 10 minutes
  away (`homeStaleOnReturn`). iOS reopens an installed app as it was left, so Home kept
  yesterday's due count and streak past the 07:00 rollover in Vietnam. A quicker glance
  away does not reload, and neither does a return with a dialog open.
- **The edge swipe closes an open dialog first**, through the same unsaved-changes guard
  as the dialog's Cancel. It used to ignore dialogs and go back behind them: the screen
  under an open card editor changed, and the editor's Save still wrote to the lesson that
  was no longer shown. The flashcard screen is the one screen it never leaves, because a
  swipe that starts at the edge there is also a swipe to grade.
- **Chart values answer a tap.** Exact numbers were only in hover titles, which a phone
  never shows. Every column of a column or line chart has a transparent, full-height hit
  area (a 2px bar, a 6px dot or a zero with no bar at all was nothing to tap), and grade
  segments and heatmap days carry the same `data-tip`. A tap writes that text into a line
  under the chart and outlines what was tapped; the `<title>` stays for a mouse.
- **A focused field is blurred before the next card hides it.** Hidden while it had focus
  (Flashcard & Write's answer field, when a gap-fill passage came next), the field closed
  the iPhone keyboard without a blur, and the home-screen app kept the keyboard's shorter
  viewport: the sticky grade row stayed about 300pt up, over the passage's word bank, until
  the app was reopened. `renderFlashcard` now blurs it first; Write mode focuses its field
  again in the same task, so on a word card the keyboard does not drop and come back.
- **Haptics** use `navigator.vibrate` on Android; iOS has no Vibration API, so on iPhone
  the app clicks the label of a hidden `<input type="checkbox" switch>`, which plays a
  system tick on iOS 18+. Every tick is the same strength, so a pattern becomes a count.
- **Answer sounds** are synthesized with Web Audio (a two-note marimba for right, a low
  knock for wrong), only where the app judges the answer. A self-graded flashcard stays
  silent: a "wrong" knock on the learner's own Learning would read as the app disagreeing.
- **Dialogs** set `inert` on everything behind the top one rather than trapping Tab, which
  covers keyboard, pointer and screen reader in one attribute sweep.
- **The card face turned away is `inert` and `aria-hidden`.** A flip only rotates the back
  out of sight, so VoiceOver read the answer before the flip. `setFlashcardFaces` sets both
  on whichever face is hidden: `inert` keeps Tab and taps out, `aria-hidden` covers readers
  that do not honour `inert`. Speak (P) still works, because a script's `click()` is not a tap.

### Preferences

A list of topics (Appearance, Daily plan, Memory, Reminders, Sound & speech, Account &
data) that **saves as you go**: 0.3 s after a tap, 0.8 s after typing, nothing sent when
nothing changed. There is no Cancel, so a regretted change is undone by hand.

**One bad field holds back only itself.** A Max reviews that is not a whole number keeps
its saved value and shows its error, and every other change still saves. It used to stop
the whole save, so nothing else stuck, and closing the dialog dropped every change.

---

## 17. Reminders

Web push, two kinds, each at most once a day (`lib/reminders.js`):

- **Daily**, at the learner's chosen local time (20:00 by default), only when cards are due
  **and** nothing has been answered since local midnight. A reminder on a day with nothing
  to do, or after studying, teaches people to ignore the next one.
- **Streak saver**, only when skipping today would actually end the streak (rest days
  count). It goes at 21:00 local or 22:00 UTC, whichever is earlier, so it always lands two
  hours or more before the streak's UTC day ends, and its text names no hour.

The server checks **once a minute** in the web process and sends within the hour after the
target; `reminder_log` makes each send once. A queue or cron service was not worth it for
one process on one machine; the cost is that a restart longer than an hour skips that
day's reminder. VAPID keys come from the environment or are generated once into
`app_secrets`, because they must outlive restarts or every subscription stops working. On
iPhone, push works only for a Home Screen web app, and the setting says so.

---

## 18. Sharing, export, import

- **Share links** (`class_share_links`): anyone with the token can view a class; a signed-in
  user can clone it into their account. **Invites** share a class with a named user, who
  can clone it. Clones copy content, never progress or pins.
- **Export** (classes, lessons or cards as JSON) is content only; the class **Import file**
  reads it back. **Full backup** (Preferences → Account & data, `GET /api/export`) carries
  every class, lesson, card, attempt and schedule. Restoring it is not in the UI yet:
  import only ever adds, with new ids, so restoring into the same account would duplicate
  everything, and whether restore should add or replace is undecided.
- **Bulk paste** reads `term | definition` lines (a tab when a line has no `|`, for
  spreadsheet pastes; `|` inside `$…$` keeps its meaning) and lists every skipped line with
  a reason.

---

## 19. Testing

Tests are `node:test` files in `tests/`, some driving a real browser through Playwright
(Chromium, or WebKit for iPhone behaviour). Run everything with:

```bash
node --test --test-reporter=tap tests/*.test.js
```

Patterns used throughout:

- **Client functions are extracted from `app.js` by text**: from
  `"\nfunction " + name + "("` to the next `"\n}\n"`, then run in a `vm` context with
  stubs for what they call. A function with a nested `}` at column 0 would break this,
  so client functions keep their closing brace as the only one at the margin.
- **Wiring is pinned by regex** where the harness reimplements a delegate: the test's copy
  and a regex over the real source must both hold, so the two cannot drift.
- **Server tests start the real app** on a temporary data directory and stub sign-in with
  an `x-user` header.
- **Layout is measured, not described**: tests load the real `style.css` into a browser at
  phone and desktop widths and assert positions (`hero-wide-layout`, `home-header-phone`).
- **Invariants that fail silently have a test that fails loudly**: open statements stay at
  zero (`statement-finalize`), the rollup equals a rebuild (`attempt-daily`), two servers
  cannot share a data directory (`db-lock`), WAL is really on (`wal-journal`), every
  palette passes contrast (`palettes`).

---

## 20. Keeping this guide current

This guide is ingested into KnowledgeApp as the book **FlashcardApp Guide** and studied as
a class in FlashcardApp itself. KnowledgeApp's nightly job refreshes that book at 02:00
when the committed guide has changed since its last refresh, updating cards in place so
their progress is kept. So a change to how the app works is not finished until this guide
says so, in the same commit series as the code; `CLAUDE.md` maps code to sections.

A rule alone was not trusted to hold, so `tests/guide-sync.test.js` reads git history:
since the guide was added, every commit that touches `client/`, `server/`,
`docs/features.md` or `docs/decisions.md` must be followed by a commit that touches this
guide, or the suite fails. A pure refactor opts out with a `Guide: unchanged` line in its
commit message. A forgotten update is repaired by a later guide commit, never by
rewriting pushed history. The cost: the check knows a guide commit happened, not that it
describes the change -- that part still rests on whoever writes it.
