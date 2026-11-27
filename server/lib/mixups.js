"use strict";

// Pairs of cards the learner has mixed up: a wrong term-def quiz answer that was the other
// card's definition (attempts.picked_card_id). A pair counts either way round, and stays
// until the last two quiz answers on either of its cards since its latest mix-up are both
// right; a third card's answers say nothing about this pair, but the two cards' own answers
// are the only record of whether the learner can now tell them apart.
//
// One query for every pair: a query per pair made a card list slow once a learner had
// hundreds of pairs.
const PAIRS_SQL = `
  WITH p AS (
    SELECT MIN(card_id, picked_card_id) AS a, MAX(card_id, picked_card_id) AS b,
           MAX(rowid) AS last, COUNT(*) AS n
    FROM attempts WHERE user_id = ? AND picked_card_id IS NOT NULL
    GROUP BY 1, 2
  ), r AS (
    SELECT p.a, p.b, t.correct,
           ROW_NUMBER() OVER (PARTITION BY p.a, p.b ORDER BY t.rowid DESC) AS k
    FROM p JOIN attempts t ON t.user_id = ? AND t.source = 'quiz'
      AND t.card_id IN (p.a, p.b) AND t.rowid > p.last
  )
  SELECT p.a, p.b, p.n,
         (SELECT COUNT(*) FROM r WHERE r.a = p.a AND r.b = p.b AND r.k <= 2 AND r.correct = 1) AS ok
  FROM p`;

function mixedWith(db, userId, cardIds) {
  const wanted = new Set(cardIds);
  const out = {};
  db.prepare(PAIRS_SQL).all(userId, userId).forEach((p) => {
    if (p.ok === 2 || (!wanted.has(p.a) && !wanted.has(p.b))) return;
    (out[p.a] = out[p.a] || []).push({ id: p.b, n: p.n });
    (out[p.b] = out[p.b] || []).push({ id: p.a, n: p.n });
  });
  return out;
}

module.exports = { mixedWith };
