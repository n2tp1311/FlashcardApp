# Universal Flashcard Learning App — Implementation Plan v3

> Last updated: 2026-06-18. See §11 for current build status and priority queue.

## 1. Project Overview

A universal flashcard learning platform. Users create Classes, add Lessons with cards in structured formats, study via flashcard flip or multiple-choice quiz, and track performance with difficulty scoring. Designed to scale from single-user local tool to multi-user hosted platform.

### 1.1 Scale Targets

| Scale | Classes | Cards | Users | Storage |
|-------|---------|-------|-------|---------|
| Phase 1 (Local) | ~20 | ~5,000 | 1 | localStorage |
| Phase 2 (Personal server) | ~200 | ~50,000 | 1–10 | SQLite |
| Phase 3 (Multi-tenant) | ~1,000+ | ~100,000+ | 100+ | PostgreSQL |

### 1.2 Architecture Principle: Storage-Agnostic from Day 1

Never call localStorage directly from UI code. All data flows through a DataStore abstraction that swaps from localStorage → SQLite → PostgreSQL without changing UI code.

```
UI Layer (screens, components)
    ↓ calls
DataStore API (abstract interface)
    ↓ implemented by
├── LocalStorageAdapter   (Phase 1: single-file, offline)
├── SQLiteAdapter         (Phase 2: server, small team)
└── PostgresAdapter       (Phase 3: multi-tenant, hosted)
```

---

## 2. Why localStorage Breaks at Scale

### 2.1 Hard Limits

| Constraint | localStorage | Impact at 100K cards |
|-----------|-------------|---------------------|
| Size limit | 5–10 MB per origin | 100K cards × ~200 bytes = ~20 MB. Exceeds limit. |
| Data format | Serialized JSON string | Parsing 20 MB JSON blocks main thread 200–500ms |
| Indexing | None | Finding cards in lesson X = deserialize all + filter. O(n) every query |
| Concurrency | Synchronous, single-thread | Two tabs = race conditions |
| Query capability | None | Aggregating difficulty across classes = load everything |
| Multi-user | Impossible | Data bound to single browser |

### 2.2 When Each Limit Hits

```
~500 cards    → localStorage works fine
~5,000 cards  → Noticeable parse lag on page load (~50ms)
~20,000 cards → Approaching 5 MB limit. UI jank.
~50,000 cards → Exceeds localStorage on most browsers. App breaks.
~100,000 cards→ Completely impossible without a database.
```

---

## 3. Data Architecture

### 3.1 Entity-Relationship Model

```
User ──< Class ──< Lesson ──< Card ──< Attempt
                                  └──< CardState (per-user)
```

### 3.2 Card Data Field (JSON by Format)

The card stores format-specific fields as JSON in a `data` column:

```js
// Format A: Term ↔ Definition
{ "term": "Ridge regression", "def": "L2-penalized least squares..." }

// Format B: Multiple Choice
{ "question": "What loss does AdaBoost minimize?",
  "correct": "Exponential loss",
  "distractors": ["Hinge loss", "Squared error", "Log loss"] }
```

New formats (cloze, image) only need a new JSON shape — no schema migration.

### 3.3 SQL Schema (Phase 2/3)

```sql
create table users (
  id            text primary key,
  email         text unique not null,
  name          text not null,
  password_hash text not null,
  created_at    integer not null default (unixepoch())
);

create table classes (
  id            text primary key,
  user_id       text not null references users(id) on delete cascade,
  name          text not null,
  color         text not null default '#2563eb',
  icon          text not null default '📖',
  sort_order    integer not null default 0,
  created_at    integer not null default (unixepoch())
);

create table lessons (
  id            text primary key,
  class_id      text not null references classes(id) on delete cascade,
  title         text not null,
  format        text not null check (format in ('term-def', 'mcq')),
  sort_order    integer not null default 0,
  created_at    integer not null default (unixepoch())
);

create table cards (
  id            text primary key,
  lesson_id     text not null references lessons(id) on delete cascade,
  format        text not null check (format in ('term-def', 'mcq')),
  data          text not null,
  sort_order    integer not null default 0,
  created_at    integer not null default (unixepoch())
);

create table attempts (
  id            text primary key,
  card_id       text not null references cards(id) on delete cascade,
  user_id       text not null references users(id) on delete cascade,
  correct       integer not null check (correct in (0, 1)),
  source        text not null check (source in ('quiz', 'flashcard')),
  created_at    integer not null default (unixepoch())
);

create table card_states (
  card_id       text not null references cards(id) on delete cascade,
  user_id       text not null references users(id) on delete cascade,
  known         integer,
  updated_at    integer not null default (unixepoch()),
  primary key (card_id, user_id)
);

create index idx_classes_user on classes(user_id);
create index idx_lessons_class on lessons(class_id);
create index idx_cards_lesson on cards(lesson_id);
create index idx_attempts_card on attempts(card_id);
create index idx_attempts_user on attempts(user_id);
create index idx_attempts_card_user on attempts(card_id, user_id);
create index idx_card_states_user on card_states(user_id);
```

### 3.4 Query Performance Comparison

| Query | localStorage (100K cards) | SQLite (indexed) | PostgreSQL (indexed) |
|-------|--------------------------|-------------------|---------------------|
| Cards in a lesson | 200ms (parse all + filter) | <1ms | <1ms |
| Card difficulty | 500ms+ (nested loops) | <1ms | <1ms |
| Hardest 30 global | Seconds | ~50ms | ~20ms |
| Lesson card count | 200ms | <1ms | <1ms |

---

## 4. DataStore Abstraction Layer

### 4.1 Interface

```js
const DataStoreInterface = {
  // Classes
  getClasses()                              → Promise<Class[]>
  getClass(classId)                         → Promise<Class|null>
  createClass({ name, color, icon })        → Promise<Class>
  updateClass(classId, fields)              → Promise<Class>
  deleteClass(classId)                      → Promise<void>

  // Lessons
  getLessons(classId)                       → Promise<Lesson[]>
  createLesson({ classId, title, format })  → Promise<Lesson>
  updateLesson(lessonId, fields)            → Promise<Lesson>
  deleteLesson(lessonId)                    → Promise<void>

  // Cards
  getCards(lessonId)                        → Promise<Card[]>
  createCard({ lessonId, format, data })    → Promise<Card>
  createCards(cards[])                      → Promise<Card[]>
  updateCard(cardId, fields)               → Promise<Card>
  deleteCard(cardId)                        → Promise<void>

  // Attempts & Stats
  recordAttempt({ cardId, correct, source }) → Promise<void>
  getCardStats(cardId)                      → Promise<CardStats>
  getLessonStats(lessonId)                  → Promise<LessonStats>
  getHardestCards({ scope, limit })         → Promise<CardWithStats[]>

  // Card States
  setCardKnown(cardId, known)              → Promise<void>
  getKnownMap(lessonId)                    → Promise<{ [cardId]: boolean }>

  // Bulk
  exportAll()                              → Promise<JSON>
  importAll(json)                          → Promise<void>
  clearAll()                               → Promise<void>
};
```

### 4.2 Adapter Switching

```js
var store;
if (window.APP_MODE === "server") {
  store = new SQLiteAdapter("/api");
} else {
  store = new LocalStorageAdapter();
}
// UI always calls: await store.getCards(lessonId)
```

### 4.3 Phase 1 localStorage Optimization

Split card storage by lesson to avoid loading all cards:
```
"fc-cards-les_abc123" → [cards for that lesson]
"fc-cards-les_def456" → [cards for that lesson]
```
Extends ceiling from ~5K to ~20K total cards.

---

## 5. Feature Specification

### 5.1 Two Card Formats

| | Format A: Term ↔ Definition | Format B: MCQ |
|---|---|---|
| Schema | `{ term, def }` | `{ question, correct, distractors[3] }` |
| Flashcard front | Term (with LaTeX rendering) | Question (with LaTeX rendering) |
| Flashcard back | Definition (with LaTeX rendering) | Correct answer (with LaTeX rendering) |
| Quiz options | 1 correct def + 3 auto-generated from same lesson | 1 correct + 3 user-provided, shuffled |
| Bulk input | `term \| definition` per line | `question \| correct \| wrong1 \| wrong2 \| wrong3` per line |
| Best for | Vocabulary, concepts, formulas | Exam prep, nuanced distinctions |

All text fields support **inline LaTeX** (`$...$`) and **display LaTeX** (`$$...$$`). See §5.7 for full specification.

### 5.2 Study Session Setup

User selects:
1. Lesson(s): single, multiple, or entire class
2. Card count: 10 / 25 / 50 / All
3. Filter: All cards or "Still learning only"
4. Direction (Format A only): Term → Def or Def → Term
5. Mode: Flashcards or Quiz

### 5.3 Flashcard Study Mode

- 3D flip animation (rotateY, perspective 1200px)
- Navigation: ← → buttons, keyboard arrows, dot strip
- Marking: ✗ Still learning (key: 1) / ✓ Know it (key: 2), auto-advance 400ms
- Toolbar: Shuffle, Reset, "Study ✗ only" toggle
- Difficulty badge on each card (Easy/Medium/Hard/New + correct/total)

### 5.4 Quiz Mode

- 4 numbered options (keyboard 1-4)
- Correct → green, wrong → red, others dim
- Space/Enter to advance after answering
- Results: score ring, percentage, grade, retry/change/back

### 5.5 History & Difficulty

```
blended = 0.4 × lifetime_error_rate + 0.6 × recent_5_error_rate
Easy < 0.3 | Medium 0.3–0.6 | Hard ≥ 0.6 | New = 0 attempts
```

### 5.6 Stats Screen

Three tabs: Overview (counts, accuracy, difficulty bar), Hardest Cards (top 30), All Attempted.
Accessible per-lesson, per-class, or globally.

### 5.7 LaTeX Rendering

#### Why LaTeX Is Essential

Flashcards for STEM subjects are crippled without math rendering. Compare:

```
Without LaTeX:  "beta-hat = (X^T X)^{-1} X^T y"
With LaTeX:     β̂ = (XᵀX)⁻¹Xᵀy           ← rendered from $\hat{\beta} = (X^TX)^{-1}X^Ty$
```

Users studying statistics, physics, chemistry, engineering, or computer science need proper equation rendering. This is not a nice-to-have — it's a requirement for the "universal" claim.

#### Library Choice: KaTeX

| Option | Size | Render Speed | Coverage | Verdict |
|--------|------|-------------|----------|---------|
| **KaTeX** | ~120 KB (min+gzip) | ~1ms per expression | 95% of LaTeX math | ✅ Best fit |
| MathJax 3 | ~250 KB | ~5ms per expression | 99% of LaTeX | Too heavy for flashcard app |
| Plain Unicode | 0 KB | instant | ~30% of math notation | Insufficient for real formulas |
| Custom renderer | 0 KB | varies | limited | Not worth building |

KaTeX is the right choice: fast enough for rendering 4 quiz options simultaneously without jank, small enough to load from CDN without slowing page load, and covers virtually all math notation students actually use.

#### CDN Import

```html
<head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js"></script>
</head>
```

Total additional load: ~120 KB gzipped. Cached after first visit.

For Phase 2+ (server), bundle KaTeX as a local static asset instead of CDN:
```
public/
├── vendor/
│   ├── katex.min.css
│   ├── katex.min.js
│   └── fonts/         ← KaTeX font files (required)
```

#### Delimiter Convention

| Delimiter | Type | Example Input | Rendered As |
|-----------|------|---------------|-------------|
| `$...$` | Inline math | `The estimator $\hat{\beta}$ is unbiased` | The estimator β̂ is unbiased |
| `$$...$$` | Display math (centered, larger) | `$$\hat{\beta} = (X^TX)^{-1}X^Ty$$` | Centered equation on its own line |

These are the standard LaTeX delimiters that every STEM student already knows. No custom syntax.

#### Rendering Function

A single function handles all text rendering throughout the app. Every place that displays card content calls this instead of setting `textContent` directly:

```js
/**
 * Render text with LaTeX support.
 * Splits text on $...$ and $$...$$ delimiters,
 * renders math segments with KaTeX, leaves the rest as escaped HTML text.
 *
 * @param {string} text - Raw text potentially containing LaTeX
 * @param {HTMLElement} el - DOM element to render into
 */
function renderLatex(text, el) {
  // Clear the element
  el.innerHTML = "";

  // Regex to match $$...$$ (display) and $...$ (inline)
  // Process display math first to avoid $$ being consumed by $ pattern
  var parts = splitLatex(text);

  parts.forEach(function(part) {
    if (part.type === "display-math") {
      var span = document.createElement("div");
      span.className = "katex-display-wrapper";
      try {
        katex.render(part.content, span, {
          displayMode: true,
          throwOnError: false,     // render error message instead of crashing
          output: "html"           // faster than "htmlAndMathml"
        });
      } catch (e) {
        span.textContent = part.raw;  // fallback: show raw LaTeX
      }
      el.appendChild(span);
    } else if (part.type === "inline-math") {
      var span = document.createElement("span");
      try {
        katex.render(part.content, span, {
          displayMode: false,
          throwOnError: false,
          output: "html"
        });
      } catch (e) {
        span.textContent = part.raw;
      }
      el.appendChild(span);
    } else {
      // Plain text — escape HTML to prevent XSS
      var textNode = document.createTextNode(part.content);
      el.appendChild(textNode);
    }
  });
}

/**
 * Split text into segments: plain text, inline math, display math.
 * Handles nested braces inside LaTeX correctly.
 */
function splitLatex(text) {
  var parts = [];
  var regex = /(\$\$[\s\S]+?\$\$|\$(?!\$)[\s\S]+?(?<!\$)\$)/g;
  var lastIndex = 0;
  var match;

  while ((match = regex.exec(text)) !== null) {
    // Plain text before this match
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }

    var raw = match[0];
    if (raw.startsWith("$$") && raw.endsWith("$$")) {
      parts.push({ type: "display-math", content: raw.slice(2, -2).trim(), raw: raw });
    } else {
      parts.push({ type: "inline-math", content: raw.slice(1, -1).trim(), raw: raw });
    }

    lastIndex = regex.lastIndex;
  }

  // Remaining plain text
  if (lastIndex < text.length) {
    parts.push({ type: "text", content: text.slice(lastIndex) });
  }

  return parts;
}
```

#### Where renderLatex Is Called

Every place in the app that displays user-authored card text must use `renderLatex()` instead of `textContent`:

| Location | Current Code | Updated Code |
|----------|-------------|-------------|
| Flashcard front (term/question) | `el.textContent = card.term` | `renderLatex(card.term, el)` |
| Flashcard back (definition/answer) | `el.textContent = card.def` | `renderLatex(card.def, el)` |
| Quiz question | `el.textContent = card.question` | `renderLatex(card.question, el)` |
| Quiz options (all 4) | `btn.textContent = option` | `renderLatex(option, btn)` |
| Stats card term | `escHtml(card.q)` | `renderLatex(card.q, termEl)` |
| Stats card definition | `escHtml(card.a)` | `renderLatex(card.a, defEl)` |
| Card list in lesson editor | `escHtml(card.term)` | `renderLatex(card.term, el)` |
| Bulk paste preview | `escHtml(parsed.term)` | `renderLatex(parsed.term, el)` |

**Do NOT render LaTeX in**:
- Input fields (user types raw LaTeX, sees raw text)
- Search/filter operations (match against raw text, not rendered)
- Export/import (store raw text, never rendered HTML)

#### Live Preview While Editing

When adding or editing a card, show a live preview below each text field:

```
┌──────────────────────────────────────────────────┐
│ Term: [The MLE is $\hat{\theta}_{MLE}$_______]   │
│                                                    │
│ Preview: The MLE is θ̂_MLE                         │  ← live rendered
│                                                    │
│ Definition: [$$\hat{\theta} = \arg\max_\theta     │
│              \mathcal{L}(\theta | x)$$___________] │
│                                                    │
│ Preview:                                           │
│              θ̂ = arg max_θ L(θ|x)                  │  ← live rendered, centered
│                                                    │
└──────────────────────────────────────────────────┘
```

Implementation: Debounce the preview render at 300ms after the user stops typing.

```js
var previewTimer = null;
inputEl.addEventListener("input", function() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(function() {
    renderLatex(inputEl.value, previewEl);
  }, 300);
});
```

#### Bulk Paste with LaTeX

LaTeX in bulk paste works naturally because `$...$` delimiters don't conflict with the `|` pipe delimiter:

```
Ridge estimator | $\hat{\beta}_{ridge} = (X^TX + \lambda I)^{-1}X^Ty$
Bias-variance | $MSE = \text{Bias}^2 + \text{Var} + \sigma^2$
Lasso objective | $$\min_\beta \|y - X\beta\|^2 + \lambda \|\beta\|_1$$
```

The parser splits on `|` first (finding term vs definition), then `renderLatex()` handles the `$...$` within each field during display.

**Edge case**: A LaTeX expression containing a pipe character `|` (e.g., `$|x|$` for absolute value) will break the pipe-delimited parser.

**Solution**: In the `splitLatex` step of parsing, temporarily replace `|` inside `$...$` with a placeholder before splitting on pipes, then restore after:

```js
function protectLatexPipes(line) {
  // Replace | inside $...$ with a placeholder
  return line.replace(/\$[^$]+\$/g, function(match) {
    return match.replace(/\|/g, "〡");  // Unicode replacement
  });
}

function restoreLatexPipes(text) {
  return text.replace(/〡/g, "|");
}

// Bulk parse:
lines.forEach(function(line) {
  var protected = protectLatexPipes(line);
  var parts = protected.split("|");  // safe split
  var term = restoreLatexPipes(parts[0].trim());
  var def = restoreLatexPipes(parts.slice(1).join("|").trim());
  // ...
});
```

#### Performance Considerations

| Scenario | Concern | Solution |
|----------|---------|---------|
| Quiz: render 4 options simultaneously | 4 KaTeX calls = ~4ms total | Fast enough. No optimization needed |
| Stats: render 30 hardest cards | 60 KaTeX calls (term + def each) | Lazy render: only render visible cards. Use IntersectionObserver |
| Card list: 500 cards in lesson editor | 500+ KaTeX calls | Paginate or virtual scroll. Render only visible rows |
| Complex equations | Single expression with 50+ symbols | KaTeX handles this in <5ms. Not a concern |
| KaTeX load time | 120KB first load | Cached after first visit. Use `defer` on script tag. Show "Loading math..." placeholder if KaTeX not yet loaded |

**KaTeX availability guard**:

```js
function renderLatex(text, el) {
  // If KaTeX hasn't loaded yet, fall back to plain text
  if (typeof katex === "undefined") {
    el.textContent = text;
    // Queue for re-render when KaTeX loads
    pendingRenders.push({ text: text, el: el });
    return;
  }
  // ... normal rendering
}

// When KaTeX finishes loading, re-render any pending elements
document.querySelector('script[src*="katex"]').addEventListener("load", function() {
  pendingRenders.forEach(function(item) {
    renderLatex(item.text, item.el);
  });
  pendingRenders = [];
});
```

#### CSS Adjustments for KaTeX

```css
/* Ensure KaTeX doesn't overflow flashcard boundaries */
.fc-front .katex-display,
.fc-back .katex-display {
  overflow-x: auto;
  overflow-y: hidden;
  padding: 4px 0;
}

/* Display math centering */
.katex-display-wrapper {
  text-align: center;
  margin: 8px 0;
}

/* Inline math vertical alignment */
.katex {
  font-size: 1.05em;  /* slightly larger than body text for readability */
}

/* Quiz options: prevent KaTeX from making options too tall */
.quiz-opt .katex-display {
  margin: 4px 0;
}

/* Dark background (flashcard back): invert KaTeX colors */
.fc-back .katex {
  color: #e8e6e1;
}

/* Print: ensure KaTeX renders in black */
@media print {
  .katex { color: #000 !important; }
}
```

#### Data Storage — No Changes Needed

LaTeX content is stored as raw text strings. The `$...$` delimiters are just characters in the string:

```js
// Stored in localStorage / database:
{
  term: "Ridge estimator",
  def: "$\\hat{\\beta} = (X^TX + \\lambda I)^{-1}X^Ty$"
}
```

No schema changes. No new columns. No migration. LaTeX rendering is purely a display-layer concern.

**Important**: In JSON strings, backslashes must be double-escaped: `\hat` → `\\hat`. This happens automatically when the user types in an input field and the value is read via `.value` then serialized with `JSON.stringify()`. But in bulk paste, the user types single backslashes — the parser must NOT double-escape them. Only `JSON.stringify` should handle escaping.

#### Common LaTeX for Flashcard Use Cases

Include these examples in the app's help/documentation to guide users:

```
Greek letters:    $\alpha$, $\beta$, $\theta$, $\lambda$, $\sigma$, $\mu$
Subscript/super:  $X_i$, $X^2$, $\hat{\beta}$, $\bar{x}$
Fractions:        $\frac{a}{b}$, $\frac{\partial f}{\partial x}$
Sums/products:    $\sum_{i=1}^n x_i$, $\prod_{k=1}^K \pi_k$
Matrices:         $\begin{pmatrix} a & b \\ c & d \end{pmatrix}$
Norms:            $\|x\|_2$, $\|X\beta - y\|^2$
Probability:      $P(Y=1|X=x)$, $E[X]$, $\text{Var}(X)$
Argmin/max:       $\arg\min_\beta L(\beta)$
Text in math:     $\text{MSE} = \text{Bias}^2 + \text{Var}$
```

---

## 6. Server Architecture (Phase 2+)

### 6.1 Tech Stack

| Layer | Phase 2 | Phase 3 |
|-------|---------|---------|
| Frontend | Same HTML/CSS/JS, served as static files | Same |
| API | Node.js + Express | Same |
| Database | SQLite (better-sqlite3) | PostgreSQL (pg) |
| Auth | Session cookies + bcrypt | JWT + OAuth |
| Hosting | $5/mo VPS + Docker | Managed cloud + CDN |

### 6.2 REST API

```
POST   /api/auth/register          POST   /api/auth/login
GET    /api/classes                 POST   /api/classes
PUT    /api/classes/:id             DELETE /api/classes/:id
GET    /api/classes/:id/lessons     POST   /api/classes/:id/lessons
PUT    /api/lessons/:id             DELETE /api/lessons/:id
GET    /api/lessons/:id/cards       POST   /api/lessons/:id/cards
POST   /api/lessons/:id/cards/bulk
PUT    /api/cards/:id               DELETE /api/cards/:id
POST   /api/attempts
GET    /api/cards/:id/stats
GET    /api/stats/lesson/:id        GET    /api/stats/class/:id
GET    /api/stats/hardest?scope=&limit=
PUT    /api/card-states/:cardId
GET    /api/export                  POST   /api/import
```

### 6.3 Server File Structure

```
flashcard-app/
├── server/
│   ├── index.js
│   ├── db.js
│   ├── middleware/auth.js
│   └── routes/ (auth, classes, lessons, cards, attempts, stats, export)
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── data/flashcards.db
├── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## 7. Migration Strategy: localStorage → Server

### 7.1 Export (Client)
```js
var dump = await store.exportAll();
downloadJSON("flashcard-backup.json", dump);
```

### 7.2 Import (Server)
```
POST /api/import  { classes, lessons, cards, history, known }
→ Transaction: insert all, remap IDs, set userId
```

### 7.3 Switch Adapter
```js
// Before: var store = new LocalStorageAdapter();
// After:  var store = new SQLiteAdapter("/api");
// UI code: zero changes.
```

---

## 8. Implementation Roadmap

### Phase 1: Local App (Weeks 1–3)

| Week | Deliverables |
|------|-------------|
| 1 | HTML skeleton (9 screens), CSS, DataStore interface, LocalStorageAdapter, navigation, **KaTeX CDN import + `renderLatex()` + `splitLatex()` functions + CSS adjustments** |
| 2 | Class CRUD, Lesson CRUD (format picker), Card CRUD (one-by-one + bulk paste with **LaTeX live preview** + **pipe-protection for LaTeX**, both formats) |
| 3 | Flashcard study (3D flip, nav, dots, marking, shuffle, filter) **with LaTeX rendering on all card faces**, Quiz **with LaTeX in question + all 4 options**, History, difficulty, Stats **with LaTeX in card displays** |

### Phase 2: Server + SQLite (Weeks 4–5)

| Week | Deliverables |
|------|-------------|
| 4 | Express server, SQLite schema, REST routes, SQLiteAdapter client |
| 5 | Auth, per-user isolation, import/export, Docker, deploy to VPS |

### Phase 3: Scale + Polish (Weeks 6–8)

| Week | Deliverables |
|------|-------------|
| 6 | PostgreSQL migration, connection pooling, query optimization |
| 7 | Mobile responsive, touch gestures, dark mode, settings |
| 8 | Spaced repetition (SM-2), daily review deck, shared decks |

---

## 9. Performance Budgets

| Metric | Phase 1 | Phase 2+ |
|--------|---------|----------|
| Page load | <500ms | <300ms |
| Screen nav | <50ms | <50ms |
| Card flip | 60fps | 60fps |
| API response (CRUD) | n/a | <20ms |
| API response (stats) | n/a | <100ms |
| Bulk insert 1K cards | n/a | <500ms |

---

## 10. Testing Checklist

### CRUD
- [ ] Create/edit/delete class with cascade
- [ ] Create lesson with format lock
- [ ] Add cards one-by-one and bulk (both formats)
- [ ] Edit/delete cards

### Study & Quiz
- [ ] Session respects count, filter, direction
- [ ] Flashcard flip, nav, dots, keyboard
- [ ] Quiz distractors correct per format
- [ ] Results display and keyboard shortcuts

### Scale
- [ ] 1K cards/lesson: no lag
- [ ] 10K total (Phase 1): load <200ms
- [ ] 100K cards (Phase 2): API <100ms
- [ ] Bulk import 1K cards: <2s

### Server (Phase 2+)
- [ ] Auth works, data isolated per user
- [ ] Concurrent tabs don't corrupt
- [ ] Export/import round-trip identical
- [ ] Foreign key cascades on delete

### LaTeX Rendering
- [ ] Inline math `$\hat{\beta}$` renders correctly on flashcard front
- [ ] Inline math renders correctly on flashcard back (dark background, light text)
- [ ] Display math `$$\sum_{i=1}^n x_i$$` renders centered on its own line
- [ ] Mixed text and math: "The estimator $\hat{\beta}$ minimizes $\|y - X\beta\|^2$"
- [ ] Quiz options with LaTeX render all 4 correctly without overflow
- [ ] Invalid LaTeX (e.g., `$\frac{$`) shows raw text fallback, doesn't crash
- [ ] KaTeX not yet loaded: plain text shown, re-renders when KaTeX loads
- [ ] Live preview in card editor updates within 300ms of typing
- [ ] Bulk paste with LaTeX containing `|` (e.g., `$|x|$`) parses correctly (pipe protection)
- [ ] Bulk paste preview shows rendered LaTeX, not raw source
- [ ] Card data stored as raw text (LaTeX source preserved, not rendered HTML)
- [ ] Export/import preserves LaTeX delimiters and backslashes correctly
- [ ] Stats screen: cards with LaTeX render correctly in hardest/all-attempted lists
- [ ] Long equations don't overflow flashcard boundaries (horizontal scroll)

---

## 11. Current Build Status (as of 2026-06-18)

### 11.1 Completed Features

All Phase 1 and Phase 2 core features are shipped. The following are confirmed built and deployed:

| Feature | Status | Notes |
|---------|--------|-------|
| Auth (email/password, Google OAuth) | Done | |
| Forgot/reset password with SMTP | Done | Dev token suppressed in production |
| Classes & Lessons CRUD | Done | |
| Card CRUD (one-by-one + bulk paste) | Done | Both term-def and MCQ formats |
| LaTeX rendering (KaTeX) | Done | Inline and display math |
| AI prompt guide with copy button | Done | |
| Flashcard study mode | Done | 3D flip, keyboard nav, marking |
| Quiz mode (MCQ) | Done | Auto-generated distractors, keyboard 1-4 |
| Study setup (count, filter, direction, mode) | Done | |
| Multi-lesson selection | Done | |
| Progressive difficulty (weighted shuffle) | Done | Hard 3×, medium 2× |
| Spaced repetition (score-based intervals) | Done | 7d / 3d / 1d / 4h |
| Due badges and review hints | Done | |
| Share (public link + invite by username) | Done | Clone into own account |
| Per-card stats and difficulty badges | Done | Easy/Medium/Hard/New |
| Stats screen (overview, hardest cards) | Done | |
| Dashboard screen | Done | Server mode only; streak, accuracy, due/struggling lessons |
| Interleaved vs Blocked card order | Done | Pill on setup screen, 2+ lessons only |
| SQLite via WASM (Railway compatible) | Done | Lock file cleared on startup |
| Session auth (express-session) | Done | MemoryStore, single-instance |
| Docker + Railway deploy | Done | |

### 11.2 Pending Features — Priority Order

**Priority 1 — Dashboard polish** (done, but watch for edge cases)
- Struggling lessons threshold is >40% hard-rated; revisit based on user feedback.

**Priority 2 — MCQ Explanation Field**
- Add `explanation` to card JSON data for both formats.
- Update AI prompt guide template to emit the field.
- Add explanation textarea to card editor.
- Show collapsed explanation panel in quiz results per card (expands on tap).
- Implements "delayed feedback" pattern from learning science research (see `docs/research.md`).

**Priority 3 — Recall Mode**
- New study mode: user types free-text answer, taps Reveal, self-grades.
- Requires new setup mode option and a new study screen (or branched quiz screen).
- Self-grade options: Easy / Hard (two-button) or thumbs up/down.
- Evidence: free recall produces ~80% long-term retention vs ~34% for passive re-reading.

**Priority 4 — FSRS Spaced Repetition** (deferred, revisit later)
- Replace or complement fixed-interval scheduler with FSRS algorithm.
- Open-source JS library available; only the interval-calculation step changes.
- See `docs/decisions.md` for rationale on deferral.

**Priority 5 — Confidence-Based Repetition** (deferred)
- Post-answer 1–5 rating. Deferred due to flow interruption concern.

### 11.3 Known Bugs Fixed

| Bug | Fix |
|-----|-----|
| Modal blank-screen on close | `closeAllModals()` scoped to `#modal-overlay .modal`; defensive `.remove("hidden")` added in share/prompt-guide openers |
| Dev reset token exposed in production | Suppressed when `NODE_ENV === "production"` |
| SQLite lock file on container restart | Lock file `flashcards.db.lock` removed on server startup |
