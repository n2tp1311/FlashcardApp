"use strict";
// A KnowledgeApp class's lessons, in one of the two layouts KnowledgeApp sends: by chapter
// (the book's reading order) or by concept (one concept and everything under it). Both are
// stored in class_layouts, so the learner's switch applies at once, without KnowledgeApp.

const db = require("../db");

const LAYOUTS = ["chapter", "concept"];

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function stored(classId) {
  const row = db.prepare("SELECT chapter, concept, active FROM class_layouts WHERE class_id = ?").get(classId);
  if (!row) return null;
  return { chapter: JSON.parse(row.chapter), concept: row.concept ? JSON.parse(row.concept) : null, active: row.active };
}

// What the client needs: which layout is showing, and whether there is a choice at all.
function summary(classId) {
  const row = db.prepare("SELECT active, concept IS NOT NULL AS has_concept FROM class_layouts WHERE class_id = ?").get(classId);
  return row ? { active: row.active, concept: !!row.has_concept } : null;
}

function save(classId, chapter, concept, active) {
  db.prepare(
    "INSERT INTO class_layouts (class_id, chapter, concept, active, updated_at) VALUES (?, ?, ?, ?, unixepoch()) " +
    "ON CONFLICT(class_id) DO UPDATE SET chapter = excluded.chapter, concept = excluded.concept, " +
    "active = excluded.active, updated_at = excluded.updated_at"
  ).run(classId, JSON.stringify(chapter), concept ? JSON.stringify(concept) : null, active);
}

// Puts the class's linked cards into `targets` ([{ title, external_ids }]), in order. Cards are
// moved, never recreated, so each keeps its id, schedule and history. A target lesson reuses
// the existing lesson that already holds most of its cards, renamed if the title changed, so a
// lesson id survives wherever it still means something. A lesson the moves leave empty is
// removed; one that was already empty is the learner's and stays. Cards not named (the
// learner's own) stay put, and unnamed lessons follow the named ones in their old order.
// A cram that named a removed lesson is pointed at the lessons its cards moved to: a switch
// of layout removes most lessons, and a cram left naming none of them would hold no cards.
// Call inside a transaction.
function apply(userId, classId, targets) {
  const out = { moved: 0, unchanged: 0, created: 0, renamed: 0, removed: 0, not_found: 0, invalid: 0 };
  const lessons = db.prepare("SELECT id, title, format FROM lessons WHERE class_id = ? ORDER BY sort_order, created_at").all(classId);
  const byExt = new Map();
  db.prepare(
    "SELECT ca.id, ca.lesson_id, ca.format, ca.external_id, ca.sort_order FROM cards ca JOIN lessons l ON ca.lesson_id = l.id " +
    "WHERE l.class_id = ? AND ca.external_id IS NOT NULL ORDER BY ca.created_at, ca.rowid"
  ).all(classId).forEach(r => { if (!byExt.has(r.external_id)) byExt.set(r.external_id, r); });
  const before = new Map(db.prepare(
    "SELECT l.id, COUNT(ca.id) AS n FROM lessons l LEFT JOIN cards ca ON ca.lesson_id = l.id WHERE l.class_id = ? GROUP BY l.id"
  ).all(classId).map(r => [r.id, r.n]));

  const plan = targets.map(t => {
    const cards = [];
    t.external_ids.forEach(ext => {
      const c = byExt.get(ext);
      if (!c) out.not_found++;
      // Gap cards are named right after their term card, so they move with it.
      else if (c.format !== "term-def" && c.format !== "cloze" && c.format !== "gapfill") out.invalid++;
      else cards.push(c);
    });
    return { title: t.title.trim(), cards, lessonId: null };
  }).filter(p => p.cards.length);

  // Most-shared cards first, each existing lesson claimed once.
  const pairs = [];
  plan.forEach((p, i) => {
    const overlap = new Map();
    p.cards.forEach(c => overlap.set(c.lesson_id, (overlap.get(c.lesson_id) || 0) + 1));
    overlap.forEach((n, lessonId) => pairs.push({ i, lessonId, n }));
  });
  const termDef = new Set(lessons.filter(l => l.format === "term-def").map(l => l.id));
  const claimed = new Set();
  pairs.sort((a, b) => b.n - a.n || a.i - b.i).forEach(({ i, lessonId }) => {
    if (plan[i].lessonId || claimed.has(lessonId) || !termDef.has(lessonId)) return;
    plan[i].lessonId = lessonId; claimed.add(lessonId);
  });

  const movedFrom = new Map();          // old lesson id -> the lessons its cards went to
  const titleOf = new Map(lessons.map(l => [l.id, l.title]));
  const moveCard = db.prepare("UPDATE cards SET lesson_id = ?, sort_order = ? WHERE id = ?");
  const setOrder = db.prepare("UPDATE lessons SET sort_order = ? WHERE id = ?");
  plan.forEach((p, i) => {
    if (!p.lessonId) {
      p.lessonId = genId();
      db.prepare("INSERT INTO lessons (id, class_id, title, format, sort_order) VALUES (?, ?, ?, 'term-def', ?)")
        .run(p.lessonId, classId, p.title, i);
      out.created++;
    } else {
      if (titleOf.get(p.lessonId) !== p.title) {
        db.prepare("UPDATE lessons SET title = ? WHERE id = ?").run(p.title, p.lessonId);
        out.renamed++;
      }
      setOrder.run(i, p.lessonId);
    }
    p.cards.forEach((c, j) => {
      if (!movedFrom.has(c.lesson_id)) movedFrom.set(c.lesson_id, new Set());
      movedFrom.get(c.lesson_id).add(p.lessonId);
      if (c.lesson_id === p.lessonId && c.sort_order === j) { out.unchanged++; return; }
      moveCard.run(p.lessonId, j, c.id);
      out.moved++;
    });
  });

  const named = new Set(plan.map(p => p.lessonId));
  const left = db.prepare("SELECT COUNT(*) AS n FROM cards WHERE lesson_id = ?");
  const removed = new Set();
  let next = plan.length;
  lessons.forEach(l => {
    if (named.has(l.id)) return;
    if (before.get(l.id) > 0 && left.get(l.id).n === 0) {
      db.prepare("DELETE FROM lessons WHERE id = ?").run(l.id);
      removed.add(l.id);
      out.removed++;
    } else setOrder.run(next++, l.id);
  });
  if (removed.size) remapCrams(userId, removed, movedFrom);
  return out;
}

function remapCrams(userId, removed, movedFrom) {
  const update = db.prepare("UPDATE crams SET lesson_ids = ? WHERE id = ?");
  db.prepare("SELECT id, lesson_ids FROM crams WHERE user_id = ?").all(userId).forEach(cram => {
    let ids;
    try { ids = JSON.parse(cram.lesson_ids); } catch (_) { return; }
    if (!Array.isArray(ids) || !ids.some(id => removed.has(id))) return;
    const next = [];
    ids.forEach(id => {
      const to = removed.has(id) ? Array.from(movedFrom.get(id) || []) : [id];
      to.forEach(x => { if (!next.includes(x)) next.push(x); });
    });
    update.run(JSON.stringify(next), cram.id);
  });
}

module.exports = { LAYOUTS, stored, summary, save, apply };
