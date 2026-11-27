"use strict";

// Pairs of cards the learner has mixed up: a wrong term-def quiz answer that was the other
// card's definition (attempts.picked_card_id). A pair counts either way round, and stays
// until the last two quiz answers on either of its cards since its latest mix-up are both
// right; a third card's answers say nothing about this pair, but the two cards' own answers
// are the only record of whether the learner can now tell them apart.
function mixedWith(db, userId, cardIds) {
  const wanted = new Set(cardIds);
  const pairs = new Map();
  db.prepare(
    "SELECT card_id, picked_card_id, MAX(rowid) AS last, COUNT(*) AS n FROM attempts " +
    "WHERE user_id = ? AND picked_card_id IS NOT NULL GROUP BY card_id, picked_card_id"
  ).all(userId).forEach((r) => {
    if (!wanted.has(r.card_id) && !wanted.has(r.picked_card_id)) return;
    const [a, b] = [r.card_id, r.picked_card_id].sort();
    const key = a + "\n" + b;
    const p = pairs.get(key) || { a, b, last: 0, n: 0 };
    p.last = Math.max(p.last, r.last);
    p.n += r.n;
    pairs.set(key, p);
  });
  const since = db.prepare(
    "SELECT correct FROM attempts WHERE user_id = ? AND source = 'quiz' AND card_id IN (?, ?) AND rowid > ? " +
    "ORDER BY rowid DESC LIMIT 2"
  );
  const out = {};
  for (const p of pairs.values()) {
    const recent = since.all(userId, p.a, p.b, p.last);
    if (recent.length === 2 && recent.every((r) => r.correct === 1)) continue;
    (out[p.a] = out[p.a] || []).push({ id: p.b, n: p.n });
    (out[p.b] = out[p.b] || []).push({ id: p.a, n: p.n });
  }
  return out;
}

module.exports = { mixedWith };
