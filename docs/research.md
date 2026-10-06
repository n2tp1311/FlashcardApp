# Learning Science Research

This file records the research findings that inform feature decisions for the Flashcard App. Each entry includes the evidence, what was decided, and the implementation status. Linked decisions are in `docs/decisions.md`.

---

## 1. Interleaved vs Blocked Practice

**Question:** When a study session spans multiple lessons, should cards from each lesson be completed before moving to the next (blocked), or should cards from all lessons be shuffled together (interleaved)?

**Evidence:**
- Bjork & Roediger (foundational): Interleaving slows down the feeling of learning during practice but dramatically improves long-term retention and transfer. The difficulty is desirable — it forces the brain to discriminate between similar concepts.
- 2024 study in *Learning and Instruction*: Confirmed interleaved practice produces more durable retention than blocked practice across multiple subject domains. The benefit is especially pronounced for conceptually related material (e.g., different lessons from the same class).

**Decision:** Interleaved is the default. A "Card Order" pill on the study setup screen lets users switch to Blocked. The pill is hidden when only one lesson is selected. Initially implemented as a flat weighted shuffle over the pooled cards (interleaved "in expectation" only); refined 2026-08-06 to a deterministic round-robin across lesson groups, guaranteeing alternation rather than relying on chance — see `docs/decisions.md`.

**Status:** Implemented.

---

## 2. FSRS Spaced Repetition Algorithm

**Question:** Should we replace the current fixed-interval spaced repetition (score → fixed days) with the FSRS algorithm?

**Evidence:**
- FSRS (Free Spaced Repetition Scheduler) is a modern, open-source algorithm based on the DSR (Difficulty, Stability, Retrievability) model.
- Benchmark studies show FSRS achieves 20–30% fewer review sessions than SM-2 (the algorithm used by Anki) for the same 90% retention target.
- An open-source JavaScript implementation is available (github.com/open-spaced-repetition/ts-fsrs).
- The algorithm is per-card: each card tracks its own stability and difficulty parameters, updated after every review.

**Decision:** Implemented 2026-08-06 via `ts-fsrs`. The original "low-risk, only the interval-calculation step changes" assessment above was wrong — a full scoping pass found `srs_step` (not just the due-timestamp) was read directly by the "Needs Recall" filter, the flashcard interval-preview labels, and the SRS-distribution chart, all of which needed genuine redesign, plus a new `card_states` schema (stability/difficulty/state/reps/lapses/last-review). Existing per-card progress was preserved via a one-time backfill estimating initial stability/difficulty from each card's old `srs_step`, verified safe in an isolated copy of the production database before ever touching real data. See `docs/decisions.md` for the full design (rating mapping, migration verification, Needs Recall redesign).

**Status:** Implemented.

---

## 3. Confidence-Based Repetition (CBR)

**Question:** Should users rate their confidence (1–5) after each answer, and use that rating to modulate the next review interval?

**Evidence:**
- CBR has solid empirical support: self-assessment of confidence correlates with actual memory strength, and using confidence ratings to schedule reviews reduces over-review of well-known material and under-review of shaky material.
- Most effectively implemented as a post-answer rating (after correctness is revealed) to avoid anchoring bias.
- Common scales: 1–5 (Likert), 1–6 (SM-2's original "quality" scale), or simplified Easy/Medium/Hard/Blackout.

**Decision:** Deferred. The per-card rating UI interrupts study flow on every single card, which users found too intensive. A lighter-weight approach (e.g., only rating after incorrect answers) may be revisited.

**Status:** Deferred.

---

## 4. Delayed Feedback (Collapsed Explanation Panel)

**Question:** Should the quiz show a full explanation immediately after each answer, or should the explanation be collapsed and require a tap to expand?

**Evidence:**
- Immediate, complete feedback (correct answer + explanation shown automatically) is convenient but can reduce transfer to open-ended recall tasks. Students may read the explanation passively rather than actively retrieving the reasoning.
- Delayed or gated feedback (student must actively request the explanation after seeing correct/wrong) improves transfer to novel problems. The additional retrieval attempt reinforces encoding.
- Practical implementation: show the correct/wrong result immediately, but place the explanation in a collapsed panel labeled "Why?" or "Explanation" that expands on tap.

**Decision:** Plan to implement as part of the MCQ Explanation Field feature (Priority 2). The `explanation` field will be stored in card JSON data. During quiz, it appears in a collapsed panel beneath the answer reveal.

**Status:** Planned. Implementation spec in `docs/features.md` under "Upcoming: MCQ Explanation Field."

---

## 5. Recall Mode (Free Retrieval vs MCQ Recognition)

**Question:** Does free-text recall (typing the answer) produce better learning outcomes than MCQ recognition (picking from 4 options)?

**Evidence:**
- Testing Effect / Retrieval Practice research (Roediger & Karpicke, 2006 and many replications): Active recall produces stronger and more durable memory traces than passive re-reading or recognition.
- Quantitative estimates vary by study design, but a commonly cited result is ~80% retention at 1 week for free recall vs ~34% for re-reading conditions. Recognition (MCQ) falls in between but closer to re-reading on open-ended transfer tests.
- The benefit is larger for material that will be tested in open-ended format (e.g., exams, real-world application) than for material tested by recognition.
- Practical tradeoff: MCQ is faster and lower cognitive load; free recall is more effortful but pays off. Offering both as selectable modes gives users the right tool for their goal (quick review vs deep encoding).

**Decision:** Plan to implement Recall Mode as Priority 3. User types a free-text answer, taps "Reveal" to see the correct answer, then self-grades.

**Status:** Planned. Implementation spec in `docs/features.md` under "Upcoming: Recall Mode."

---

## 6. Cramming for a Test

**Question:** With a test a day or a few days away, what study method gives the best score?

**Findings:**
- Practice testing beats rereading: in Roediger & Karpicke (2006) retrieval practice gave about 50% better recall a week later, though rereading felt more effective. Dunlosky et al. (2013) rated practice testing and distributed practice the only two "high utility" techniques of ten; highlighting, rereading and summarising were rated low.
- Spacing helps inside a short window. Cepeda et al. (2008) put the best gap between sessions at roughly 10-20% of the time to the test.
- Rawson & Dunlosky (2011): about three correct recalls per item in a first session, then one or two in later sessions; beyond that the return falls off.
- Interleaving topics beats blocking them (Rohrer & Taylor, 2007), especially for telling similar concepts apart.
- Sleep consolidates memory; giving it up to study tends to lower the next day's results (Gillen-O'Neel et al., 2013).
- Massed practice feels better and works worse: in Kornell (2009) spaced flashcards beat massed for 90% of participants, while most believed the opposite.

**Decision:** Cram mode — a Cram card order (three correct recalls, missed cards back sooner, lessons interleaved) and saved crams with a test date that space rounds at 15% of the time left, hold a final review of the most-missed cards in the last 12 hours, and say "sleep" late on the eve.

**Status:** Implemented (2026-10-06). See `docs/features.md` "Cram for a test" and `docs/decisions.md`.

---

## Summary Table

| Finding | Implemented | Priority |
|---------|-------------|----------|
| Interleaved practice improves retention | Yes — default for multi-lesson sessions | — |
| FSRS reduces reviews by 20-30% vs SM-2 | Yes — replaced the fixed-step ladder | — |
| Confidence-Based Repetition improves scheduling | No | Low (deferred — UX concern) |
| Delayed/gated explanation improves transfer | No | 2 (MCQ Explanation Field) |
| Free recall produces ~80% retention vs ~34% re-reading | No | 3 (Recall Mode) |
| Cramming: test yourself, 3 correct recalls, spaced rounds, sleep | Yes — Cram mode | — |
