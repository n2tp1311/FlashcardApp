"use strict";

// Today's answers split the way the Home strip and the review cap need them. A card is new
// on the day of its first answer; every answer to a card first answered on an earlier day is
// a review. A new card answered twice today is one new card and no reviews: the second
// answer is still learning it, not reviewing it.
function summarizeToday(rows) {
  const newCards = new Set();
  let reviews = 0;
  let studyMs = 0;
  rows.forEach(r => {
    studyMs += r.duration_ms > 0 ? r.duration_ms : 0;
    if (r.seen_before) reviews++;
    else newCards.add(r.card_id);
  });
  return { studyMs, newCards: newCards.size, reviews };
}

module.exports = { summarizeToday };
