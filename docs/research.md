# Learning Science Research

This file records the research findings that inform feature decisions for the Flashcard App. Each entry includes the evidence, what was decided, and the implementation status. Linked decisions are in `docs/decisions.md`.

---

## 1. Interleaved vs Blocked Practice

**Question:** When a study session spans multiple lessons, should cards from each lesson be completed before moving to the next (blocked), or should cards from all lessons be shuffled together (interleaved)?

**Evidence:**
- Bjork & Roediger (foundational): Interleaving slows down the feeling of learning during practice but dramatically improves long-term retention and transfer. The difficulty is desirable — it forces the brain to discriminate between similar concepts.
- 2024 study in *Learning and Instruction*: Confirmed interleaved practice produces more durable retention than blocked practice across multiple subject domains. The benefit is especially pronounced for conceptually related material (e.g., different lessons from the same class).

**Decision:** Interleaved is the default. A "Card Order" pill on the study setup screen lets users switch to Blocked. The pill is hidden when only one lesson is selected.

**Status:** Implemented.

---

## 2. FSRS Spaced Repetition Algorithm

**Question:** Should we replace the current fixed-interval spaced repetition (score → fixed days) with the FSRS algorithm?

**Evidence:**
- FSRS (Free Spaced Repetition Scheduler) is a modern, open-source algorithm based on the DSR (Difficulty, Stability, Retrievability) model.
- Benchmark studies show FSRS achieves 20–30% fewer review sessions than SM-2 (the algorithm used by Anki) for the same 90% retention target.
- An open-source JavaScript implementation is available (github.com/open-spaced-repetition/ts-fsrs).
- The algorithm is per-card: each card tracks its own stability and difficulty parameters, updated after every review.

**Decision:** Skipped for now. Current fixed-interval scheduler is sufficient for the user base. Adding FSRS later is low-risk — only the interval-calculation step changes; the quiz flow, UI, and database schema do not need to change.

**Status:** Deferred. See `docs/decisions.md` for rationale.

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

## Summary Table

| Finding | Implemented | Priority |
|---------|-------------|----------|
| Interleaved practice improves retention | Yes — default for multi-lesson sessions | — |
| FSRS reduces reviews by 20-30% vs SM-2 | No | Low (deferred) |
| Confidence-Based Repetition improves scheduling | No | Low (deferred — UX concern) |
| Delayed/gated explanation improves transfer | No | 2 (MCQ Explanation Field) |
| Free recall produces ~80% retention vs ~34% re-reading | No | 3 (Recall Mode) |
