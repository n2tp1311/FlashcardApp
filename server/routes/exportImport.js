"use strict";

const express = require("express");
const db      = require("../db");
const { requireAuth } = require("../middleware/auth");
const { rateLimit, byUser } = require("../middleware/rateLimit");
const { forEachBatch } = require("../lib/batch");
// Two separate routers, not one mounted at both /api/export and /api/import — a
// single shared router responds to BOTH verbs at BOTH mount points (GET /api/import
// would silently run the export handler and consume exportLimiter's quota; POST
// /api/export would run the import handler under a URL that looks read-only). Kept
// in one file since both handlers share genId() and the same DB shape.
const exportRouter = express.Router();
const importRouter = express.Router();

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Each of these does several synchronous whole-table scans (export) or a
// transaction inserting every row of a full account dump (import) — the queries
// themselves are already properly scoped by user_id (no N+1/unbounded-aggregation
// bug to fix here, unlike share.js/cards.js), but neither had any throttling
// against being hit repeatedly in a loop. Keyed by userId, not IP — both sit behind
// requireAuth, and IP-keying would let unrelated accounts on the same office/campus
// NAT exhaust each other's quota.
const exportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: "Too many export requests. Try again later.", keyFn: byUser });
const importLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: "Too many import requests. Try again later.", keyFn: byUser });
// Separate bucket from exportLimiter above: a per-class/per-lesson export is a much lighter,
// much more frequently-clicked operation than a full-account backup (e.g. exporting several
// lessons one at a time in a session is a normal workflow) — sharing one 10/hour bucket would
// let that routine usage lock a user out of the unrelated full-backup endpoint for an hour.
const flashcardExportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, message: "Too many flashcard export requests. Try again later.", keyFn: byUser });
const flashcardImportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, message: "Too many flashcard import requests. Try again later.", keyFn: byUser });

const VALID_LESSON_FORMATS = ["term-def", "mcq", "true-false", "image-def"];

// Same per-format checks as POST /api/lessons/:lessonId/cards and its /bulk sibling in
// cards.js (not shared via import — cards.js doesn't export them, and this is the only other
// call site) — mcq needs question/correct/1-4 distractors, image-def needs an existing
// /uploads/ path + text def, true-false needs a statement + "true"/"false" correct value.
// term-def has no per-format check here either, matching those two existing routes.
function validateCardForImport(format, data) {
  if (format === "mcq") {
    if (!data || !data.question || !data.correct || !Array.isArray(data.distractors) ||
        data.distractors.length < 1 || data.distractors.length > 4)
      return "mcq requires question, correct, and 1–4 distractors";
    if (data.explanation !== undefined && (typeof data.explanation !== "string" || !data.explanation.trim()))
      return "explanation must be a non-empty string if provided";
  }
  if (format === "image-def") {
    if (!data || !data.imageUrl || typeof data.imageUrl !== "string" || !data.imageUrl.startsWith("/uploads/"))
      return "image-def requires imageUrl starting with /uploads/";
    if (!data.def || typeof data.def !== "string" || !data.def.trim())
      return "image-def requires def (text definition)";
  }
  if (format === "true-false") {
    if (!data || !data.statement || typeof data.statement !== "string" || !data.statement.trim())
      return "true-false requires statement";
    if (data.correct !== "true" && data.correct !== "false")
      return 'true-false requires correct to be "true" or "false"';
    if (data.explanation !== undefined && (typeof data.explanation !== "string" || !data.explanation.trim()))
      return "true-false explanation must be a non-empty string if provided";
  }
  return null;
}

// GET /api/export
exportRouter.get("/", requireAuth, exportLimiter, (req, res) => {
  const userId = req.session.userId;
  const classes = db.prepare("SELECT * FROM classes WHERE user_id = ?").all(userId);
  const lessons = db.prepare(
    "SELECT l.* FROM lessons l JOIN classes c ON l.class_id = c.id WHERE c.user_id = ?"
  ).all(userId);
  const cards = db.prepare(
    "SELECT cards.* FROM cards " +
    "JOIN lessons ON cards.lesson_id = lessons.id " +
    "JOIN classes ON lessons.class_id = classes.id " +
    "WHERE classes.user_id = ?"
  ).all(userId).map(c => ({ ...c, data: JSON.parse(c.data) }));
  const attempts = db.prepare("SELECT * FROM attempts WHERE user_id = ?").all(userId);
  const states   = db.prepare("SELECT * FROM card_states WHERE user_id = ?").all(userId);

  res.json({ classes, lessons, cards, attempts, states, exportedAt: Date.now() });
});

// A user-controlled string (class name, lesson title) lands directly in the
// Content-Disposition header below — CR/LF/quotes could break out of the quoted filename
// value or inject an extra header, so those are stripped outright (not just escaped), on
// top of the usual filesystem-reserved characters.
function sanitizeFilename(str) {
  const cleaned = String(str || "")
    .replace(/[\r\n"]/g, "")
    .replace(/[\\/:*?<>|]/g, "-")
    .trim();
  // Array.from splits by Unicode code point, not UTF-16 code unit — a plain .slice(0, 80)
  // can cut a surrogate pair in half (e.g. mid-emoji), leaving a malformed string that later
  // throws a URIError out of encodeURIComponent in contentDispositionHeader below.
  const truncated = Array.from(cleaned).slice(0, 80).join("");
  return truncated || "export";
}

// res.setHeader() throws synchronously (crashing the request as an uncaught 500) on any
// non-Latin1 byte in a plain `filename="..."` value — a real, common case here, not a
// theoretical one: this app ships full Vietnamese translations, and class/lesson names have
// no ASCII-only restriction anywhere. RFC 6266's two-part form fixes this: an ASCII-safe
// `filename=` fallback (non-ASCII characters replaced, so it's always header-safe) for
// clients that don't understand the extended form, plus a UTF-8 percent-encoded `filename*=`
// that every modern browser prefers and displays correctly.
// encodeURIComponent leaves *, ', (, ) unescaped, but RFC 5987's attr-char set excludes all
// four — a class named e.g. "Teacher's Notes" would produce a technically-invalid filename*=
// value (browsers tolerate it in practice, but it's cheap to just be correct).
function encodeRFC5987(str) {
  return encodeURIComponent(str).replace(/['()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function contentDispositionHeader(filename) {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRFC5987(filename)}`;
}

// GET /api/export/flashcards?lessonId=X | ?classId=X | ?classIds=a,b,c
// Exactly one of the three scoping params is required. Unlike GET /api/export above (a full
// account backup, paired with POST /api/import), this exports card CONTENT only — no
// attempts/SRS state — for a human-readable, portable snapshot: internal ids/timestamps/
// sort_order are omitted, just the fields a person would actually want in an exported file.
exportRouter.get("/flashcards", requireAuth, flashcardExportLimiter, (req, res) => {
  const userId = req.session.userId;
  // Query params can arrive as arrays (?classId=1&classId=2, repeated keys) — only a single
  // string value is ever valid here, so coerce defensively rather than let a non-string
  // reach better-sqlite3's bind param (which throws an uncaught TypeError, not a clean 400).
  // Also trims to "": an empty string is falsy in the branches below but was previously still
  // counted as "provided", letting a request like ?classId= silently fall through to the
  // classIds branch instead of hitting the validation error.
  const lessonId = typeof req.query.lessonId === "string" ? req.query.lessonId.trim() : "";
  const classId  = typeof req.query.classId  === "string" ? req.query.classId.trim()  : "";
  const classIds = typeof req.query.classIds === "string" ? req.query.classIds.trim() : "";
  const paramCount = [lessonId, classId, classIds].filter(Boolean).length;
  if (paramCount !== 1)
    return res.status(400).json({ error: "Provide exactly one of lessonId, classId, or classIds" });

  let classRows;
  let onlyLessonId = null; // set for the lessonId scope, to filter that one class down to one lesson
  let filenameSource; // captured directly in each branch below, where the name is plainly available
  let omittedCount = 0; // classIds scope only: requested ids that didn't resolve to a class

  if (lessonId) {
    const lesson = db.prepare(
      "SELECT l.class_id AS class_id, l.title AS title FROM lessons l JOIN classes c ON l.class_id = c.id WHERE l.id = ? AND c.user_id = ?"
    ).get(lessonId, userId);
    if (!lesson) return res.status(404).json({ error: "Not found" });
    classRows = db.prepare("SELECT * FROM classes WHERE id = ?").all(lesson.class_id);
    onlyLessonId = lessonId;
    filenameSource = lesson.title || "lesson";
  } else if (classId) {
    classRows = db.prepare("SELECT * FROM classes WHERE id = ? AND user_id = ?").all(classId, userId);
    if (classRows.length === 0) return res.status(404).json({ error: "Not found" });
    filenameSource = classRows[0].name || "class";
  } else {
    // Deduped so a repeated id (e.g. "1,1,2") doesn't get counted twice below and produce a
    // false-positive "omitted" count — IN(...) only ever returns one row per matching id
    // regardless of how many times it's repeated in the list, so the raw count would be wrong.
    const ids = Array.from(new Set(classIds.split(",").map(s => s.trim()).filter(Boolean)));
    if (ids.length === 0) return res.status(400).json({ error: "classIds must be a non-empty comma-separated list" });
    classRows = [];
    forEachBatch(ids, chunk => {
      const placeholders = chunk.map(() => "?").join(",");
      classRows.push(...db.prepare(
        `SELECT * FROM classes WHERE user_id = ? AND id IN (${placeholders})`
      ).all(userId, ...chunk));
    });
    if (classRows.length === 0) return res.status(404).json({ error: "Not found" });
    omittedCount = ids.length - classRows.length;
    filenameSource = "flashcards-export";
  }

  // Batched the same way GET /api/export above does — one query for every scoped class's
  // lessons, one for every one of those lessons' cards, instead of a query per class/lesson
  // in a nested map (the classIds scope especially can span many classes at once).
  const classIdList = classRows.map(c => c.id);
  const lessonsByClass = {};
  const allLessonIds = [];
  forEachBatch(classIdList, chunk => {
    const placeholders = chunk.map(() => "?").join(",");
    db.prepare(`SELECT * FROM lessons WHERE class_id IN (${placeholders}) ORDER BY class_id, sort_order`)
      .all(...chunk)
      .forEach(l => {
        if (onlyLessonId && l.id !== onlyLessonId) return;
        (lessonsByClass[l.class_id] = lessonsByClass[l.class_id] || []).push(l);
        allLessonIds.push(l.id);
      });
  });

  const cardsByLesson = {};
  forEachBatch(allLessonIds, chunk => {
    const placeholders = chunk.map(() => "?").join(",");
    db.prepare(`SELECT * FROM cards WHERE lesson_id IN (${placeholders}) ORDER BY lesson_id, sort_order`)
      .all(...chunk)
      .forEach(c => { (cardsByLesson[c.lesson_id] = cardsByLesson[c.lesson_id] || []).push(c); });
  });

  const exportedClasses = classRows.map(cls => {
    const lessons = lessonsByClass[cls.id] || [];
    const exportedLessons = lessons.map(lesson => {
      const cards = cardsByLesson[lesson.id] || [];
      const exportedCards = cards.map(c => {
        let data;
        try {
          data = JSON.parse(c.data);
        } catch (err) {
          // Don't fail the whole export over one corrupted row (unlike GET /api/export
          // above, which has no guard here and would 500 the entire account backup) — but
          // don't silently produce an empty-looking card with no trace either. Logged, not
          // surfaced to the client: this is a signal for an operator to go investigate the
          // row, not something the requesting user can act on.
          console.error(`[export] card ${c.id} has unparseable data, exporting as empty:`, err.message);
          data = {};
        }
        return { format: c.format, data };
      });
      return { title: lesson.title, format: lesson.format, cards: exportedCards };
    });
    let tags = [];
    if (cls.tags) {
      // Same reasoning as card.data above: POST /api/import writes req.body classes[].tags
      // straight through with no JSON validation, so a hand-edited or legacy backup file
      // could leave a non-JSON value in this column — degrade to an empty tag list for this
      // one class rather than 500ing the whole export over it.
      try { tags = JSON.parse(cls.tags); } catch (err) {
        console.error(`[export] class ${cls.id} has unparseable tags, exporting as empty:`, err.message);
      }
    }
    return {
      name: cls.name, color: cls.color, icon: cls.icon, level: cls.level,
      tags: tags,
      lessons: exportedLessons
    };
  });

  const filename = sanitizeFilename(filenameSource) + ".json";

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", contentDispositionHeader(filename));
  const body = { exportedAt: Date.now(), classes: exportedClasses };
  // classIds is the one scope where a requested id can silently fail to resolve (deleted in
  // another tab, belongs to another user, typo'd in the URL) — surface that instead of quietly
  // exporting fewer classes than asked for with no trace.
  if (omittedCount > 0) body.omittedCount = omittedCount;
  res.json(body);
});

// POST /api/import
importRouter.post("/", requireAuth, importLimiter, (req, res) => {
  const userId = req.session.userId;
  const { classes = [], lessons = [], cards = [], attempts = [], states = [] } = req.body;

  const idMap = {}; // old id → new id

  db.transaction(() => {
    classes.forEach(cls => {
      const newId = genId();
      idMap[cls.id] = newId;
      db.prepare(
        "INSERT OR IGNORE INTO classes (id, user_id, name, color, icon, sort_order, level, archived, created_at, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(newId, userId, cls.name, cls.color || "#2563eb", cls.icon || "book", cls.sort_order || 0, cls.level ?? null, cls.archived ? 1 : 0, cls.created_at || Math.floor(Date.now()/1000), cls.tags || null);
    });

    lessons.forEach(les => {
      const newId = genId();
      idMap[les.id] = newId;
      const classId = idMap[les.class_id] || les.class_id;
      db.prepare(
        "INSERT OR IGNORE INTO lessons (id, class_id, title, format, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(newId, classId, les.title, les.format, les.sort_order || 0, les.created_at || Math.floor(Date.now()/1000));
    });

    cards.forEach(card => {
      const newId = genId();
      idMap[card.id] = newId;
      const lessonId = idMap[card.lesson_id] || card.lesson_id;
      db.prepare(
        "INSERT OR IGNORE INTO cards (id, lesson_id, format, data, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(newId, lessonId, card.format, JSON.stringify(card.data), card.sort_order || 0, card.created_at || Math.floor(Date.now()/1000));
    });

    attempts.forEach(att => {
      const cardId = idMap[att.card_id] || att.card_id;
      db.prepare(
        "INSERT OR IGNORE INTO attempts (id, card_id, user_id, correct, source, created_at, duration_ms, grade) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(genId(), cardId, userId, att.correct, att.source || "flashcard", att.created_at || Math.floor(Date.now()/1000),
            att.duration_ms ?? null, att.grade ?? null);
    });

    states.forEach(s => {
      const cardId = idMap[s.card_id] || s.card_id;
      db.prepare(
        "INSERT OR REPLACE INTO card_states (card_id, user_id, known, updated_at, last_seen_at, srs_step, srs_due_at, " +
        "fsrs_stability, fsrs_difficulty, fsrs_state, fsrs_reps, fsrs_lapses, fsrs_learning_steps, fsrs_last_review_at, last_correct_source) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(cardId, userId, s.known, s.updated_at || Math.floor(Date.now()/1000), s.last_seen_at ?? null,
            s.srs_step ?? 0, s.srs_due_at ?? null, s.fsrs_stability ?? null, s.fsrs_difficulty ?? null,
            s.fsrs_state ?? 0, s.fsrs_reps ?? 0, s.fsrs_lapses ?? 0, s.fsrs_learning_steps ?? 0,
            s.fsrs_last_review_at ?? null, s.last_correct_source ?? null);
    });
  })();

  res.json({ ok: true, imported: { classes: classes.length, lessons: lessons.length, cards: cards.length } });
});

// POST /api/import/flashcards — the counterpart to GET /api/export/flashcards above. Takes
// that id-less, human-readable { classes: [{ name, ..., lessons: [{ title, ..., cards: [...] }] }] }
// shape (NOT the flat id-bearing rows POST /api/import expects — that route can't read this
// file) and always creates brand-new classes/lessons/cards, appended after whatever the user
// already has. No merge-into-existing-class option: every import is purely additive, so there's
// no risk of an import overwriting or colliding with existing data.
importRouter.post("/flashcards", requireAuth, flashcardImportLimiter, (req, res) => {
  const userId = req.session.userId;
  const classes = req.body.classes;
  if (!Array.isArray(classes) || classes.length === 0)
    return res.status(400).json({ error: "classes array required" });

  // Validate everything up front, before writing anything — a bad card buried in the 5th
  // class of a large import should fail the whole request, not leave 4 classes imported and
  // a silent gap where the 5th should be. `lessons`/`cards` are required to already BE arrays
  // (not defaulted via `|| []`) so that picking the wrong file — e.g. the full-account backup
  // from GET /api/export, whose classes have no `lessons` key at all — fails fast with a clear
  // error instead of silently importing a pile of empty classes.
  for (let i = 0; i < classes.length; i++) {
    const cls = classes[i];
    if (!cls || typeof cls.name !== "string" || !cls.name.trim())
      return res.status(400).json({ error: "class " + i + ": name required" });
    if (!Array.isArray(cls.lessons))
      return res.status(400).json({ error: "class " + i + ": lessons must be an array" });
    for (let j = 0; j < cls.lessons.length; j++) {
      const lesson = cls.lessons[j];
      if (!lesson || typeof lesson.title !== "string" || !lesson.title.trim())
        return res.status(400).json({ error: "class " + i + " lesson " + j + ": title required" });
      if (!VALID_LESSON_FORMATS.includes(lesson.format))
        return res.status(400).json({ error: "class " + i + " lesson " + j + ": format must be term-def, mcq, true-false, or image-def" });
      if (!Array.isArray(lesson.cards))
        return res.status(400).json({ error: "class " + i + " lesson " + j + ": cards must be an array" });
      for (let k = 0; k < lesson.cards.length; k++) {
        const card = lesson.cards[k];
        if (!card || !VALID_LESSON_FORMATS.includes(card.format))
          return res.status(400).json({ error: "class " + i + " lesson " + j + " card " + k + ": format must be term-def, mcq, true-false, or image-def" });
        const cardErr = validateCardForImport(card.format, card.data);
        if (cardErr) return res.status(400).json({ error: "class " + i + " lesson " + j + " card " + k + ": " + cardErr });
      }
    }
  }

  const startingClassOrder = db.prepare("SELECT COUNT(*) as n FROM classes WHERE user_id = ?").get(userId).n;
  let importedLessons = 0;
  let importedCards = 0;

  db.transaction(() => {
    classes.forEach((cls, i) => {
      const classId = genId();
      // Same shape as classes.js's normalizeLevel/normalizeTags (not exported from there, so
      // reimplemented here — the import file is hand-editable, so these fields need the same
      // sanitization as the manual-entry path, not just the "trust our own export" assumption).
      const levelNum = Number(cls.level);
      const level = cls.level === null || cls.level === undefined || isNaN(levelNum) ? null : levelNum;
      const tagSeen = [];
      (Array.isArray(cls.tags) ? cls.tags : []).forEach(tag => {
        if (typeof tag !== "string") return;
        const norm = tag.trim().toLowerCase();
        if (norm && !tagSeen.includes(norm)) tagSeen.push(norm);
      });
      const tags = tagSeen.slice(0, 10);
      // Constrained to a plain hex color (not the free-form string classes.js's own POST/PUT
      // accept) because this value is later interpolated into innerHTML unescaped on the
      // client (class-card rendering) — an import file is the easiest way to get an
      // attacker-controlled string into that field, since it can be shared between users
      // as a normal-looking "flashcard deck" file.
      const color = typeof cls.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(cls.color) ? cls.color : "#2563eb";
      db.prepare(
        "INSERT INTO classes (id, user_id, name, color, icon, sort_order, level, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(classId, userId, cls.name.trim(), color, cls.icon || "book", startingClassOrder + i, level, JSON.stringify(tags));

      cls.lessons.forEach((lesson, j) => {
        const lessonId = genId();
        db.prepare(
          "INSERT INTO lessons (id, class_id, title, format, sort_order) VALUES (?, ?, ?, ?, ?)"
        ).run(lessonId, classId, lesson.title.trim(), lesson.format, j);
        importedLessons++;

        lesson.cards.forEach((card, k) => {
          db.prepare(
            "INSERT INTO cards (id, lesson_id, format, data, sort_order) VALUES (?, ?, ?, ?, ?)"
          ).run(genId(), lessonId, card.format, JSON.stringify(card.data || {}), k);
          importedCards++;
        });
      });
    });
  })();

  res.status(201).json({ ok: true, imported: { classes: classes.length, lessons: importedLessons, cards: importedCards } });
});

module.exports = { exportRouter, importRouter };
