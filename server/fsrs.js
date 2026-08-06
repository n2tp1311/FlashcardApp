"use strict";

const { FSRS, generatorParameters, createEmptyCard, Rating, State } = require("ts-fsrs");

// Cap at 1 year to match the old fixed-step ladder's behavior — FSRS defaults to a much
// longer max (100 years), which would be a surprising jump for this app's small user base.
const scheduler = new FSRS(generatorParameters({ maximum_interval: 365 }));

// Maps this app's (correct, grade, source) onto an FSRS rating. Quiz-mode recognition is
// weaker evidence of recall than active recall, so an ungraded quiz-correct answer is rated
// Hard rather than Good — FSRS's Hard rating always yields a shorter next interval than Good
// for the same card, by construction, which reproduces what RECOGNITION_CAP_STEP used to
// enforce via after-the-fact clamping, without needing any clamp arithmetic here.
function ratingFor(correct, grade, source) {
  if (!correct) return Rating.Again;
  if (grade === "easy") return Rating.Easy;
  if (grade === "hard") return Rating.Hard;
  if (grade === "medium") return Rating.Good;
  if (source === "quiz") return Rating.Hard;
  return Rating.Good;
}

function cardFromState(stateRow, nowDate) {
  if (!stateRow || stateRow.fsrs_stability == null) return createEmptyCard(nowDate);
  return {
    due: new Date((stateRow.srs_due_at || Math.floor(nowDate.getTime() / 1000)) * 1000),
    stability: stateRow.fsrs_stability,
    difficulty: stateRow.fsrs_difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: stateRow.fsrs_learning_steps || 0,
    reps: stateRow.fsrs_reps || 0,
    lapses: stateRow.fsrs_lapses || 0,
    state: stateRow.fsrs_state || State.New,
    last_review: stateRow.fsrs_last_review_at ? new Date(stateRow.fsrs_last_review_at * 1000) : undefined
  };
}

// Precomputes what each of the 4 grading buttons would produce, in seconds-from-now, without
// committing anything — powers the client's interval-preview text. Server-computed (not
// duplicated client-side) so the preview can never drift from the authoritative scheduler.
function previewIntervals(stateRow, nowDate) {
  var fsrsCard = cardFromState(stateRow, nowDate);
  var nowSec = Math.floor(nowDate.getTime() / 1000);
  return {
    again: Math.floor(scheduler.next(fsrsCard, nowDate, Rating.Again).card.due.getTime() / 1000) - nowSec,
    hard:  Math.floor(scheduler.next(fsrsCard, nowDate, Rating.Hard).card.due.getTime() / 1000) - nowSec,
    good:  Math.floor(scheduler.next(fsrsCard, nowDate, Rating.Good).card.due.getTime() / 1000) - nowSec,
    easy:  Math.floor(scheduler.next(fsrsCard, nowDate, Rating.Easy).card.due.getTime() / 1000) - nowSec
  };
}

module.exports = { scheduler, ratingFor, cardFromState, previewIntervals, Rating, State };
