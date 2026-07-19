/* ============================================================
   FLASHCARD APP — Phase 1+2 (localStorage / SQLite server)
   ============================================================ */

"use strict";

/* ============================
   LATEX RENDERING
   ============================ */

var pendingRenders = [];

function renderLatex(text, el) {
  if (!text) { el.innerHTML = ""; return; }
  if (typeof katex === "undefined") {
    el.textContent = text;
    pendingRenders.push({ text: text, el: el });
    return;
  }
  el.innerHTML = "";
  var parts = splitLatex(text);
  parts.forEach(function(part) {
    if (part.type === "display-math") {
      var wrapper = document.createElement("div");
      wrapper.className = "katex-display-wrapper";
      try {
        katex.render(part.content, wrapper, { displayMode: true, throwOnError: false, output: "html" });
      } catch (e) {
        wrapper.textContent = part.raw;
      }
      el.appendChild(wrapper);
    } else if (part.type === "inline-math") {
      var span = document.createElement("span");
      try {
        katex.render(part.content, span, { displayMode: false, throwOnError: false, output: "html" });
      } catch (e) {
        span.textContent = part.raw;
      }
      el.appendChild(span);
    } else {
      el.appendChild(document.createTextNode(part.content));
    }
  });
}

function splitLatex(text) {
  var parts = [];
  var regex = /(\$\$[\s\S]+?\$\$|\$(?!\$)[\s\S]+?(?<!\$)\$)/g;
  var lastIndex = 0;
  var match;
  while ((match = regex.exec(text)) !== null) {
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
  if (lastIndex < text.length) {
    parts.push({ type: "text", content: text.slice(lastIndex) });
  }
  return parts;
}

// Re-render pending elements once KaTeX loads
(function() {
  var katexScript = document.querySelector('script[src*="katex"]');
  if (katexScript) {
    katexScript.addEventListener("load", function() {
      pendingRenders.forEach(function(item) {
        if (item.el.isConnected) renderLatex(item.text, item.el);
      });
      pendingRenders = [];
    });
  }
})();

/* ============================
   TEXT-TO-SPEECH
   ============================ */

var _ttsVoice = null;
function _pickVoice() {
  var voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  var en = voices.filter(function(v) { return /^en(-|$)/i.test(v.lang); });
  if (!en.length) return voices[0];
  return en.find(function(v) { return /google/i.test(v.name) && v.lang === "en-US"; }) ||
    en.find(function(v) { return /enhanced|premium|neural/i.test(v.name) && v.lang === "en-US"; }) ||
    en.find(function(v) { return v.lang === "en-US"; }) ||
    en[0];
}
if (window.speechSynthesis) {
  _ttsVoice = _pickVoice();
  if (typeof window.speechSynthesis.addEventListener === "function") {
    window.speechSynthesis.addEventListener("voiceschanged", function() { _ttsVoice = _pickVoice(); });
  }
}

function speakWith(text, rate) {
  if (!window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  setTimeout(function() {
    var u = new SpeechSynthesisUtterance(text);
    var voice = _ttsVoice || _pickVoice();
    if (voice) u.voice = voice;
    u.rate = rate || 0.9;
    window.speechSynthesis.speak(u);
  }, 50);
}

function speakText(text) {
  if (!window.speechSynthesis || !text) return;
  var clean = text
    .replace(/\$\$[\s\S]+?\$\$/g, "")
    .replace(/\$(?!\$)[\s\S]+?(?<!\$)\$/g, "")
    .trim();
  if (!clean) return;
  speakWith(clean, state.ttsRate);
}

function setStudyLessonLabel(elId, card) {
  var el = document.getElementById(elId);
  if (!el) return;
  var lessons = state.studyScope && state.studyScope.lessons;
  if (!lessons || lessons.length <= 1 || !card.lesson_id) {
    el.classList.add("hidden");
    return;
  }
  var lesson = lessons.find(function(l) { return l.id === card.lesson_id; });
  if (lesson) {
    el.textContent = lesson.title;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

/* ============================
   BULK PARSE (pipe protection)
   ============================ */

var PIPE_PLACEHOLDER = "ぁ"; // ぁ — unlikely to appear in user content

function protectLatexPipes(line) {
  return line.replace(/\$\$[\s\S]+?\$\$|\$(?!\$)[\s\S]+?(?<!\$)\$/g, function(m) {
    return m.replace(/\|/g, PIPE_PLACEHOLDER);
  });
}

function restoreLatexPipes(text) {
  return text.replace(new RegExp(PIPE_PLACEHOLDER, "g"), "|");
}

function parseBulkTermDef(raw) {
  var lines = raw.split("\n");
  var cards = [];
  lines.forEach(function(line) {
    var trimmed = line.trim();
    if (!trimmed) return;
    var protected_ = protectLatexPipes(trimmed);
    var parts = protected_.split("|");
    if (parts.length < 2) return;
    var term = restoreLatexPipes(parts[0].trim());
    var def  = restoreLatexPipes(parts.slice(1).join("|").trim());
    if (term && def) cards.push({ format: "term-def", data: { term: term, def: def } });
  });
  return cards;
}

function parseBulkMCQ(raw) {
  var lines = raw.split("\n");
  var cards = [];
  lines.forEach(function(line) {
    var trimmed = line.trim();
    if (!trimmed) return;
    // Split off optional explanation after ";;"
    var semiIdx     = trimmed.indexOf(";;");
    var mcqPart     = semiIdx >= 0 ? trimmed.slice(0, semiIdx) : trimmed;
    var explanation = semiIdx >= 0 ? trimmed.slice(semiIdx + 2).trim() : null;
    var protected_ = protectLatexPipes(mcqPart);
    var parts = protected_.split("|");
    if (parts.length < 3) return;
    var q           = restoreLatexPipes(parts[0].trim());
    var correct     = restoreLatexPipes(parts[1].trim());
    var distractors = parts.slice(2).map(function(p) { return restoreLatexPipes(p.trim()); }).filter(Boolean);
    if (distractors.length > 4) distractors = distractors.slice(0, 4);
    if (q && correct && distractors.length >= 1) {
      var data = { question: q, correct: correct, distractors: distractors };
      if (explanation) data.explanation = explanation;
      cards.push({ format: "mcq", data: data });
    }
  });
  return cards;
}

function parseBulkTF(raw) {
  var lines = raw.split("\n");
  var cards = [];
  lines.forEach(function(line) {
    var trimmed = line.trim();
    if (!trimmed) return;
    var semiIdx = trimmed.indexOf(";;");
    var tfPart = semiIdx >= 0 ? trimmed.slice(0, semiIdx) : trimmed;
    var explanation = semiIdx >= 0 ? trimmed.slice(semiIdx + 2).trim() : null;
    var protected_ = protectLatexPipes(tfPart);
    var parts = protected_.split("|");
    if (parts.length < 2) return;
    var statement = restoreLatexPipes(parts[0].trim());
    var answer = restoreLatexPipes(parts[1].trim()).toLowerCase();
    if (!statement || (answer !== "true" && answer !== "false")) return;
    var data = { statement: statement, correct: answer };
    if (explanation) data.explanation = explanation;
    cards.push({ format: "true-false", data: data });
  });
  return cards;
}

/* ============================
   ID GENERATOR
   ============================ */

function genId(prefix) {
  return (prefix || "id") + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

/* ============================
   DATA STORE INTERFACE (Phase 1: localStorage)
   ============================ */

var LocalStorageAdapter = (function() {
  var KEY_CLASSES = "fc-classes";
  var KEY_LESSONS = "fc-lessons";
  var CARDS_PREFIX = "fc-cards-";
  var KEY_ATTEMPTS = "fc-attempts";
  var KEY_STATES   = "fc-states";

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch(e) { return null; }
  }
  function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  return {
    // --- Classes ---
    getClasses: function() {
      return Promise.resolve(load(KEY_CLASSES) || []);
    },
    getClass: function(id) {
      return this.getClasses().then(function(list) {
        return list.find(function(c) { return c.id === id; }) || null;
      });
    },
    createClass: function(fields) {
      var self = this;
      return self.getClasses().then(function(list) {
        var cls = {
          id: genId("cls"),
          name: fields.name,
          color: fields.color || "#2563eb",
          icon: fields.icon || "📚",
          sort_order: list.length,
          created_at: Date.now()
        };
        list.push(cls);
        save(KEY_CLASSES, list);
        return cls;
      });
    },
    updateClass: function(id, fields) {
      return this.getClasses().then(function(list) {
        var idx = list.findIndex(function(c) { return c.id === id; });
        if (idx === -1) return null;
        Object.assign(list[idx], fields);
        save(KEY_CLASSES, list);
        return list[idx];
      });
    },
    deleteClass: function(id) {
      var self = this;
      return self.getLessons(id).then(function(lessons) {
        var deletes = lessons.map(function(l) { return self.deleteLesson(l.id); });
        return Promise.all(deletes);
      }).then(function() {
        return self.getClasses();
      }).then(function(list) {
        save(KEY_CLASSES, list.filter(function(c) { return c.id !== id; }));
      });
    },

    // --- Lessons ---
    getLessons: function(classId) {
      var all = load(KEY_LESSONS) || [];
      return Promise.resolve(all.filter(function(l) { return l.class_id === classId; }));
    },
    createLesson: function(fields) {
      var all = load(KEY_LESSONS) || [];
      var lesson = {
        id: genId("les"),
        class_id: fields.classId,
        title: fields.title,
        format: fields.format,
        sort_order: all.filter(function(l) { return l.class_id === fields.classId; }).length,
        created_at: Date.now()
      };
      all.push(lesson);
      save(KEY_LESSONS, all);
      return Promise.resolve(lesson);
    },
    updateLesson: function(id, fields) {
      var all = load(KEY_LESSONS) || [];
      var idx = all.findIndex(function(l) { return l.id === id; });
      if (idx === -1) return Promise.resolve(null);
      Object.assign(all[idx], fields);
      save(KEY_LESSONS, all);
      return Promise.resolve(all[idx]);
    },
    deleteLesson: function(id) {
      var self = this;
      return self.getCards(id).then(function(cards) {
        var deletes = cards.map(function(c) { return self.deleteCard(c.id); });
        return Promise.all(deletes);
      }).then(function() {
        var all = load(KEY_LESSONS) || [];
        save(KEY_LESSONS, all.filter(function(l) { return l.id !== id; }));
        localStorage.removeItem(CARDS_PREFIX + id);
      });
    },

    // --- Cards ---
    getCards: function(lessonId) {
      return Promise.resolve(load(CARDS_PREFIX + lessonId) || []);
    },
    createCard: function(fields) {
      var key = CARDS_PREFIX + fields.lessonId;
      var cards = load(key) || [];
      var card = {
        id: genId("crd"),
        lesson_id: fields.lessonId,
        format: fields.format,
        data: fields.data,
        sort_order: cards.length,
        created_at: Date.now()
      };
      cards.push(card);
      save(key, cards);
      return Promise.resolve(card);
    },
    createCards: function(cardList) {
      // Group by lessonId so each lesson key is read and written exactly once,
      // not once per card (which would be O(n²) on large imports).
      var byLesson = {};
      cardList.forEach(function(fields) {
        if (!byLesson[fields.lessonId]) byLesson[fields.lessonId] = [];
        byLesson[fields.lessonId].push(fields);
      });
      var created = [];
      Object.keys(byLesson).forEach(function(lessonId) {
        var key = CARDS_PREFIX + lessonId;
        var existing = load(key) || [];
        var startOrder = existing.length;
        byLesson[lessonId].forEach(function(fields, i) {
          var card = {
            id: genId("crd"),
            lesson_id: lessonId,
            format: fields.format,
            data: fields.data,
            sort_order: startOrder + i,
            created_at: Date.now()
          };
          existing.push(card);
          created.push(card);
        });
        save(key, existing); // one write per lesson regardless of card count
      });
      return Promise.resolve(created);
    },
    updateCard: function(id, lessonId, fields) {
      var key = CARDS_PREFIX + lessonId;
      var cards = load(key) || [];
      var idx = cards.findIndex(function(c) { return c.id === id; });
      if (idx === -1) return Promise.resolve(null);
      Object.assign(cards[idx], fields);
      save(key, cards);
      return Promise.resolve(cards[idx]);
    },
    deleteCard: function(id, lessonId) {
      if (lessonId) {
        var key = CARDS_PREFIX + lessonId;
        var cards = load(key) || [];
        save(key, cards.filter(function(c) { return c.id !== id; }));
        return Promise.resolve();
      }
      // scan all lessons
      var all = load(KEY_LESSONS) || [];
      all.forEach(function(l) {
        var key = CARDS_PREFIX + l.id;
        var cards = load(key) || [];
        var filtered = cards.filter(function(c) { return c.id !== id; });
        if (filtered.length !== cards.length) save(key, filtered);
      });
      return Promise.resolve();
    },

    // --- Attempts ---
    recordAttempt: function(fields) {
      var attempts = load(KEY_ATTEMPTS) || [];
      attempts.push({
        id: genId("att"),
        card_id: fields.cardId,
        correct: fields.correct ? 1 : 0,
        source: fields.source,
        created_at: Date.now()
      });
      // Keep only last 10K to avoid unbounded growth
      if (attempts.length > 10000) attempts = attempts.slice(-10000);
      save(KEY_ATTEMPTS, attempts);
      return Promise.resolve();
    },
    getCardStats: function(cardId) {
      var attempts = (load(KEY_ATTEMPTS) || []).filter(function(a) { return a.card_id === cardId; });
      return Promise.resolve(computeStats(attempts));
    },
    getDifficultyMap: function(cardIds) {
      var allAttempts = load(KEY_ATTEMPTS) || [];
      var map = {};
      cardIds.forEach(function(id) {
        var attempts = allAttempts.filter(function(a) { return a.card_id === id; });
        map[id] = computeStats(attempts);
      });
      return Promise.resolve(map);
    },
    saveQuizSession: function(lessonIds, score, total) {
      var KEY_SESSIONS = "fc-quiz-sessions";
      var sessions = load(KEY_SESSIONS) || [];
      var now = Date.now();
      var pct = total > 0 ? (score / total) * 100 : 0;
      var interval = pct >= 90 ? 7 : pct >= 70 ? 3 : pct >= 50 ? 1 : 0;
      var nextReview = interval > 0 ? now + interval * 86400000 : now + 4 * 3600000;
      sessions.push({ lessonIds: lessonIds, score: score, total: total, takenAt: now, nextReviewAt: nextReview });
      save(KEY_SESSIONS, sessions);
      return Promise.resolve();
    },
    getDueLessons: function(lessonIds) {
      var KEY_SESSIONS = "fc-quiz-sessions";
      var sessions = load(KEY_SESSIONS) || [];
      var now = Date.now();
      var due = [];
      var schedule = {};
      lessonIds.forEach(function(id) {
        var last = null;
        sessions.forEach(function(s) {
          if (s.lessonIds.indexOf(id) !== -1 && (!last || s.takenAt > last.takenAt)) last = s;
        });
        if (!last || last.nextReviewAt <= now) due.push(id);
        if (last) schedule[id] = Math.floor(last.nextReviewAt / 1000);
      });
      return Promise.resolve({ due: due, schedule: schedule, dueCounts: {} });
    },
    getLessonStats: function(lessonId) {
      var self = this;
      return self.getCards(lessonId).then(function(cards) {
        var allAttempts = load(KEY_ATTEMPTS) || [];
        var cardIds = new Set(cards.map(function(c) { return c.id; }));
        var filtered = allAttempts.filter(function(a) { return cardIds.has(a.card_id); });
        var statsMap = {};
        cards.forEach(function(c) { statsMap[c.id] = computeStats([]); });
        filtered.forEach(function(a) {
          if (!statsMap[a.card_id]) statsMap[a.card_id] = computeStats([]);
          // recalculated below
        });
        cards.forEach(function(c) {
          var cardAttempts = filtered.filter(function(a) { return a.card_id === c.id; });
          statsMap[c.id] = computeStats(cardAttempts);
        });
        return { cards: cards, statsMap: statsMap };
      });
    },
    getHardestCards: function(opts) {
      var self = this;
      var scope = opts.scope; // { type: 'lesson'|'class', id }
      var limit = opts.limit || 30;
      var cardsPromise;
      if (scope.type === "lesson") {
        cardsPromise = self.getCards(scope.id);
      } else if (scope.type === "class") {
        cardsPromise = self.getLessons(scope.id).then(function(lessons) {
          return Promise.all(lessons.map(function(l) { return self.getCards(l.id); })).then(function(all) {
            return all.reduce(function(acc, c) { return acc.concat(c); }, []);
          });
        });
      } else {
        // global — all cards
        var all = load(KEY_LESSONS) || [];
        cardsPromise = Promise.all(all.map(function(l) { return self.getCards(l.id); })).then(function(res) {
          return res.reduce(function(acc, c) { return acc.concat(c); }, []);
        });
      }
      var allAttempts = load(KEY_ATTEMPTS) || [];
      return cardsPromise.then(function(cards) {
        return cards.map(function(card) {
          var cardAttempts = allAttempts.filter(function(a) { return a.card_id === card.id; });
          var stats = computeStats(cardAttempts);
          return { card: card, stats: stats };
        })
        .filter(function(x) { return x.stats.total > 0; })
        .sort(function(a, b) { return b.stats.blended - a.stats.blended; })
        .slice(0, limit);
      });
    },

    // --- Card States ---
    setCardKnown: function(cardId, known) {
      var states = load(KEY_STATES) || {};
      states[cardId] = { known: known, updated_at: Date.now() };
      save(KEY_STATES, states);
      return Promise.resolve();
    },
    getBulkCards: function(lessonIds) {
      var self = this;
      var states = load(KEY_STATES) || {};
      return Promise.all(lessonIds.map(function(id) { return self.getCards(id); })).then(function(arrays) {
        var cards = arrays.reduce(function(acc, arr) { return acc.concat(arr); }, []);
        return cards.map(function(c) {
          var s = states[c.id];
          return Object.assign({}, c, { known: s !== undefined ? (s.known ? 1 : 0) : null });
        });
      });
    },
    getKnownMap: function(lessonId) {
      var self = this;
      return self.getCards(lessonId).then(function(cards) {
        var states = load(KEY_STATES) || {};
        var map = {};
        cards.forEach(function(c) {
          if (states[c.id] !== undefined) map[c.id] = states[c.id].known;
        });
        return map;
      });
    },

    // --- Progress ---
    getProgress: function(type, id) {
      var states = load(KEY_STATES) || {};
      if (type === "lesson") {
        var cards = load(CARDS_PREFIX + id) || [];
        var known = cards.filter(function(c) { return states[c.id] && states[c.id].known === true; }).length;
        return Promise.resolve({ total: cards.length, known: known });
      }
      // class
      var lessons = (load(KEY_LESSONS) || []).filter(function(l) { return l.class_id === id; });
      var total = 0, known = 0;
      lessons.forEach(function(l) {
        var cards = load(CARDS_PREFIX + l.id) || [];
        total += cards.length;
        known += cards.filter(function(c) { return states[c.id] && states[c.id].known === true; }).length;
      });
      return Promise.resolve({ total: total, known: known });
    },

    // --- Export / Import ---
    exportAll: function() {
      var all = load(KEY_LESSONS) || [];
      var cardData = {};
      all.forEach(function(l) {
        cardData[l.id] = load(CARDS_PREFIX + l.id) || [];
      });
      return Promise.resolve({
        classes: load(KEY_CLASSES) || [],
        lessons: all,
        cards: cardData,
        attempts: load(KEY_ATTEMPTS) || [],
        states: load(KEY_STATES) || {}
      });
    },
    importAll: function(json) {
      if (json.classes) save(KEY_CLASSES, json.classes);
      if (json.lessons) save(KEY_LESSONS, json.lessons);
      if (json.cards) {
        Object.keys(json.cards).forEach(function(lid) {
          save(CARDS_PREFIX + lid, json.cards[lid]);
        });
      }
      if (json.attempts) save(KEY_ATTEMPTS, json.attempts);
      if (json.states)   save(KEY_STATES, json.states);
      return Promise.resolve();
    },
    markCardsSeen: function() { return Promise.resolve(); },
    clearAll: function() {
      var all = load(KEY_LESSONS) || [];
      all.forEach(function(l) { localStorage.removeItem(CARDS_PREFIX + l.id); });
      localStorage.removeItem(KEY_CLASSES);
      localStorage.removeItem(KEY_LESSONS);
      localStorage.removeItem(KEY_ATTEMPTS);
      localStorage.removeItem(KEY_STATES);
      return Promise.resolve();
    },

    search: function(q) {
      var ql = q.toLowerCase();
      var classMap = {};
      (load(KEY_CLASSES) || []).forEach(function(c) { classMap[c.id] = c; });

      var classes = (load(KEY_CLASSES) || [])
        .filter(function(c) { return c.name.toLowerCase().indexOf(ql) !== -1; })
        .slice(0, 5)
        .map(function(c) { return { id: c.id, name: c.name, icon: c.icon, color: c.color }; });

      var allLessons = load(KEY_LESSONS) || [];
      var lessons = allLessons
        .filter(function(l) { return l.title.toLowerCase().indexOf(ql) !== -1; })
        .slice(0, 5)
        .map(function(l) {
          var cls = classMap[l.class_id] || {};
          return { id: l.id, class_id: l.class_id, title: l.title, format: l.format,
                   class_name: cls.name || "", class_icon: cls.icon || "" };
        });

      var cards = [];
      for (var i = 0; i < allLessons.length && cards.length < 5; i++) {
        var lesson = allLessons[i];
        var cls = classMap[lesson.class_id] || {};
        var lessonCards = load(CARDS_PREFIX + lesson.id) || [];
        for (var j = 0; j < lessonCards.length && cards.length < 5; j++) {
          var ca = lessonCards[j];
          var d  = ca.data;
          var displayText = null;
          if      (ca.format === "term-def")   displayText = d && d.term      ? d.term      : null;
          else if (ca.format === "mcq")        displayText = d && d.question  ? d.question  : null;
          else if (ca.format === "true-false") displayText = d && d.statement ? d.statement : null;
          else if (ca.format === "image-def")  displayText = d && d.def       ? d.def       : null;
          if (!displayText || displayText.toLowerCase().indexOf(ql) === -1) continue;
          cards.push({ id: ca.id, lesson_id: lesson.id, format: ca.format,
                       display_text: displayText, lesson_title: lesson.title,
                       class_id: lesson.class_id, class_name: cls.name || "", class_icon: cls.icon || "" });
        }
      }
      return Promise.resolve({ classes: classes, lessons: lessons, cards: cards });
    }
  };
})();

/* ============================
   DIFFICULTY CALCULATION
   ============================ */

function computeStats(attempts) {
  if (!attempts || attempts.length === 0) {
    return { total: 0, correct: 0, blended: 0, level: "new" };
  }
  var total = attempts.length;
  var correct = attempts.filter(function(a) { return a.correct === 1; }).length;
  var lifetimeError = total > 0 ? (total - correct) / total : 0;
  var recent = attempts.slice(-5);
  var recentCorrect = recent.filter(function(a) { return a.correct === 1; }).length;
  var recentError = recent.length > 0 ? (recent.length - recentCorrect) / recent.length : 0;
  var blended = 0.4 * lifetimeError + 0.6 * recentError;
  var level = blended < 0.3 ? "easy" : blended < 0.6 ? "medium" : "hard";
  return { total: total, correct: correct, blended: blended, level: level };
}

function getDiffBadgeHTML(stats) {
  if (stats.total === 0) return '<span class="fc-difficulty-badge badge-new">New</span>';
  var labels = { easy: "Easy", medium: "Medium", hard: "Hard" };
  var classes = { easy: "badge-easy", medium: "badge-medium", hard: "badge-hard" };
  return '<span class="fc-difficulty-badge ' + classes[stats.level] + '">' +
    labels[stats.level] + ' · ' + stats.correct + '/' + stats.total + '</span>';
}

/* ============================
   SHUFFLE
   ============================ */

function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

/* ============================
   APP STATE
   ============================ */

var store = LocalStorageAdapter;

var state = {
  currentClass: null,
  currentLesson: null,
  editingClassId: null,
  editingLessonId: null,
  editingCardId: null,
  tfAnswer: null,
  deleteCallback: null,

  // Study
  studyCards: [],
  studyIndex: 0,
  studyMode: "flashcard",
  studyFlipped: false,
  studyKnownMap: {},
  studyFrontText: "",
  studyBackText: "",

  // Quiz
  quizCards: [],
  quizIndex: 0,
  quizScore: 0,
  quizResults: [],
  quizOptions: [],
  quizAnswered: false,

  // Setup snapshot (for retry)
  setupSnapshot: null,

  // Study scope (single lesson or multiple selected lessons)
  studyScope: null,

  // Multi-lesson selection mode
  selectMode: false,
  selectedLessonIds: [],

  // Card selection mode
  cardSelectMode: false,
  selectedCardIds: [],

  // Home multi-class selection mode
  homeSelectMode: false,
  selectedClassIds: [],
  homeClasses: [],

  // Cache for server-mode lookups
  currentClassLessons: [],

  // User preferences (loaded from server after login)
  darkMode: false,
  fontScale: 1,
  ttsRate: 0.9,

  // Lesson sort preference (persisted in localStorage)
  currentLessonSort: (function() {
    try { return localStorage.getItem("fc-lesson-sort") || "date_added"; } catch (_) { return "date_added"; }
  }()),

  // Class sort preference (persisted in localStorage)
  currentClassSort: (function() {
    try { return localStorage.getItem("fc-class-sort") || "level"; } catch (_) { return "level"; }
  }()),
  currentClassSortDir: (function() {
    try { return localStorage.getItem("fc-class-sort-dir") || "asc"; } catch (_) { return "asc"; }
  }()),
  currentLessonSortDir: (function() {
    try { return localStorage.getItem("fc-lesson-sort-dir") || "desc"; } catch (_) { return "desc"; }
  }()),

  // Home view toggle: "grid" or "list" (persisted)
  homeView: (function() {
    try { return localStorage.getItem("fc-home-view") || "grid"; } catch (_) { return "grid"; }
  }()),
  // Home slicer filter: "all" or a level string like "1", "2" (persisted)
  homeFilter: (function() {
    try { return localStorage.getItem("fc-home-filter") || "all"; } catch (_) { return "all"; }
  }()),
  // Show archived classes instead of active ones (persisted)
  showArchived: (function() {
    try { return localStorage.getItem("fc-show-archived") === "1"; } catch (_) { return false; }
  }()),
  _classAccuracyMap: {},

  // Lesson format filter: "all" or a format string (resets per class)
  lessonFilter: "all",
  _lessonAccuracyMap: {},

  // Dashboard period in days (persisted)
  dashPeriod: (function() {
    try { return parseInt(localStorage.getItem("fc-dash-period"), 10) || 60; } catch (_) { return 60; }
  }())
};

/* ============================
   SCREEN NAVIGATION
   ============================ */

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(function(s) { s.classList.remove("active"); });
  var el = document.getElementById("screen-" + id);
  if (el) { el.classList.add("active"); window.scrollTo(0, 0); }
}

function saveScreenState(screen, classId, lessonId) {
  if (!IS_SERVER) return;
  try {
    localStorage.setItem("fc-last-screen", JSON.stringify({
      screen: screen,
      classId: classId || null,
      lessonId: lessonId || null
    }));
  } catch (_) {}
}

function restoreLastScreen() {
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem("fc-last-screen") || "null"); } catch (_) {}

  if (!saved || !IS_SERVER) { renderHome(); showScreen("home"); return; }

  if (saved.screen === "class" && saved.classId) {
    store.getClass(saved.classId).then(function(cls) {
      state.currentClass = cls;
      document.getElementById("class-detail-name").textContent = cls.icon + " " + cls.name;
      setSelectMode(false);
      renderLessons();
      showScreen("class");
    }).catch(function() { renderHome(); showScreen("home"); });
    return;
  }

  if (saved.screen === "lesson" && saved.classId && saved.lessonId) {
    store.getClass(saved.classId).then(function(cls) {
      state.currentClass = cls;
      return store.getLessons(saved.classId).then(function(lessons) {
        state.currentClassLessons = lessons;
        var lesson = lessons.find(function(l) { return l.id === saved.lessonId; });
        if (!lesson) { renderHome(); showScreen("home"); return; }
        state.currentLesson = lesson;
        document.getElementById("lesson-detail-title").textContent = lesson.title;
        setCardSelectMode(false);
        renderCards();
        showScreen("lesson");
      });
    }).catch(function() { renderHome(); showScreen("home"); });
    return;
  }

  renderHome();
  showScreen("home");
}

/* ============================
   MODAL HELPERS
   ============================ */

function openModal(id) {
  document.getElementById("modal-overlay").classList.remove("hidden");
  document.getElementById("modal-" + id).classList.remove("hidden");
}

function closeModal(id) {
  document.getElementById("modal-" + id).classList.add("hidden");
  var anyOpen = Array.from(document.querySelectorAll("#modal-overlay .modal")).some(function(m) {
    return !m.classList.contains("hidden");
  });
  if (!anyOpen) document.getElementById("modal-overlay").classList.add("hidden");
}

function closeAllModals() {
  document.querySelectorAll("#modal-overlay .modal").forEach(function(m) { m.classList.add("hidden"); });
  document.getElementById("modal-overlay").classList.add("hidden");
}

// Close modal on overlay click
document.getElementById("modal-overlay").addEventListener("click", function(e) {
  if (e.target === this) closeAllModals();
});

// Close buttons
document.querySelectorAll(".modal-close, [data-modal]").forEach(function(btn) {
  btn.addEventListener("click", function() {
    var id = this.getAttribute("data-modal");
    if (id) closeModal(id);
  });
});

/* ============================
   CONSTANTS
   ============================ */

var CLASS_COLORS = [
  "#2563eb","#7c3aed","#db2777","#dc2626",
  "#d97706","#16a34a","#0891b2","#64748b"
];

var CLASS_ICONS = ["📚","🧮","🔬","⚗️","🧬","🎯","💡","🖥️","📊","🌍","⚡","🎓","🏛️","🧪","📐","🔭"];

/* ============================
   HOME SCREEN — Class List
   ============================ */

function sortClasses(classes, key, dir) {
  var d = dir === "desc" ? -1 : 1;
  var copy = classes.slice();
  copy.sort(function(a, b) {
    var r;
    if (key === "level") {
      var aNull = a.level == null, bNull = b.level == null;
      if (aNull && bNull) return d * ((a.created_at || 0) - (b.created_at || 0));
      if (aNull) return 1;
      if (bNull) return -1;
      if (a.level !== b.level) return d * (a.level - b.level);
      return d * ((a.created_at || 0) - (b.created_at || 0));
    } else if (key === "name") {
      r = a.name.localeCompare(b.name);
    } else if (key === "due_count") {
      r = (a.due_count || 0) - (b.due_count || 0);
    } else if (key === "date_added") {
      r = (a.created_at || 0) - (b.created_at || 0);
    } else {
      return 0;
    }
    return d * r;
  });
  return copy;
}

function renderHomeCharts() {
  if (!IS_SERVER) return;
  var section = document.getElementById("home-charts-section");
  document.getElementById("home-summary-grid").innerHTML = "";
  store.getDashboard().then(function(dash) {
    var grid = document.getElementById("home-summary-grid");
    grid.innerHTML = statCard("🔥 " + dash.streak, dash.streak === 1 ? "Day Streak" : "Days Streak");
    [
      [dash.summary.classes,      "Classes"],
      [dash.summary.lessons,      "Lessons"],
      [dash.summary.cards,        "Cards"],
      [dash.summary.quizSessions, "Sessions"],
      [dash.summary.attempts,     "Attempts"]
    ].forEach(function(item) { grid.innerHTML += statCard(item[0], item[1]); });
    section.classList.remove("hidden");
  }).catch(function() { section.classList.add("hidden"); });
}

function renderHome() {
  setHomeSelectMode(false);
  renderHomeCharts();
  _updateHomeViewToggle();
  store.getClasses().then(function(classes) {
    state.homeClasses = classes;
    renderSidebarClasses(classes.filter(function(c) { return !c.archived; }));
    classes = sortClasses(classes, state.currentClassSort, state.currentClassSortDir);
    document.getElementById("class-sort-select").value = state.currentClassSort;
    document.getElementById("class-sort-dir").textContent = state.currentClassSortDir === "desc" ? "↓" : "↑";

    // Build slicer pills from unique levels among classes in the current archived/active view
    _renderHomeSlicer(classes.filter(function(c) { return !!c.archived === state.showArchived; }));

    // Apply filter
    var filtered = _applyHomeFilter(classes);

    _renderClassItems(filtered);

    // Load accuracy async (server only)
    if (IS_SERVER && store.getClassAccuracy) {
      store.getClassAccuracy().then(function(accMap) {
        state._classAccuracyMap = accMap;
        _applyClassAccuracy(accMap);
      }).catch(function() {});
    }
  });
}

function _updateHomeViewToggle() {
  document.querySelectorAll("#home-view-toggle .view-toggle-btn").forEach(function(btn) {
    btn.classList.toggle("active", btn.dataset.view === state.homeView);
  });
}

function _renderHomeSlicer(classes) {
  var bar = document.getElementById("home-slicer-bar");
  if (!bar) return;
  var levels = [];
  classes.forEach(function(c) {
    if (c.level != null && c.level !== "" && levels.indexOf(String(c.level)) === -1) {
      levels.push(String(c.level));
    }
  });
  levels.sort(function(a, b) { return parseInt(a, 10) - parseInt(b, 10); });

  bar.innerHTML = "";
  if (levels.length === 0) {
    bar.classList.add("hidden");
    if (state.homeFilter !== "all") {
      state.homeFilter = "all";
      try { localStorage.setItem("fc-home-filter", "all"); } catch (_) {}
    }
    return;
  }

  // Validate before building pills so active class is applied correctly
  if (state.homeFilter !== "all" && levels.indexOf(state.homeFilter) === -1) {
    state.homeFilter = "all";
    try { localStorage.setItem("fc-home-filter", "all"); } catch (_) {}
  }

  bar.classList.remove("hidden");

  var allBtn = document.createElement("button");
  allBtn.className = "pill" + (state.homeFilter === "all" ? " active" : "");
  allBtn.dataset.filter = "all";
  allBtn.textContent = "All";
  bar.appendChild(allBtn);

  levels.forEach(function(lv) {
    var btn = document.createElement("button");
    btn.className = "pill" + (state.homeFilter === lv ? " active" : "");
    btn.dataset.filter = lv;
    btn.textContent = "L" + lv;
    bar.appendChild(btn);
  });
}

function _applyHomeFilter(classes) {
  var base = classes.filter(function(c) { return !!c.archived === state.showArchived; });
  if (state.homeFilter === "all") return base;
  return base.filter(function(c) { return String(c.level) === state.homeFilter; });
}

function _renderClassItems(classes) {
  var container = document.getElementById("class-list");
  var empty = document.getElementById("empty-home");
  container.innerHTML = "";

  if (classes.length === 0) {
    empty.querySelector("p").textContent = state.showArchived
      ? "No archived classes."
      : "No classes yet. Create your first class to get started.";
    empty.classList.remove("hidden");
    container.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  container.classList.remove("hidden");

  if (state.homeView === "list") {
    container.className = "class-list-view";
    classes.forEach(function(cls) { _renderClassListRow(cls, container); });
  } else {
    container.className = "class-grid";
    classes.forEach(function(cls) { _renderClassGridCard(cls, container); });
  }
}

function toggleClassArchived(cls) {
  return store.updateClass(cls.id, { archived: cls.archived ? 0 : 1 }).then(renderHome);
}

function _renderClassGridCard(cls, container) {
  var card = document.createElement("div");
  card.className = "class-card" + (cls.archived ? " class-card-archived" : "");
  card.tabIndex = -1;
  card.dataset.classId = cls.id;
  card.innerHTML =
    '<div class="class-card-accent" style="background:' + cls.color + '"></div>' +
    '<span class="class-icon">' + cls.icon + '</span>' +
    '<div class="class-name">' + escHtml(cls.name) + '</div>' +
    '<div class="class-meta" id="cls-meta-' + cls.id + '">Loading...</div>' +
    (cls.due_count > 0 ? '<span class="due-badge class-due-badge">' + cls.due_count + ' due</span>' : '') +
    '<span class="class-acc-pill hidden" id="cls-acc-' + cls.id + '"></span>' +
    '<div class="progress-mini-wrap" id="cls-prog-wrap-' + cls.id + '" style="display:none">' +
      '<div class="progress-mini"><div class="progress-mini-fill" id="cls-prog-fill-' + cls.id + '" style="width:0%;background:' + cls.color + '"></div></div>' +
      '<span class="progress-mini-text" id="cls-prog-text-' + cls.id + '"></span>' +
    '</div>' +
    '<div class="class-card-actions">' +
      '<button class="icon-btn" title="' + (cls.archived ? "Unarchive" : "Archive") + '" data-cls-archive="' + cls.id + '">' + (cls.archived ? "📤" : "🗄️") + '</button>' +
      '<button class="icon-btn" title="Edit" data-cls-edit="' + cls.id + '">✏️</button>' +
      '<button class="icon-btn danger" title="Delete" data-cls-del="' + cls.id + '">🗑️</button>' +
    '</div>';
  card.addEventListener("click", function(e) {
    if (e.target.closest("[data-cls-edit],[data-cls-del],[data-cls-archive]")) return;
    if (state.homeSelectMode) { toggleClassSelection(cls.id); return; }
    openClass(cls.id);
  });
  card.querySelector("[data-cls-archive]").addEventListener("click", function(e) {
    e.stopPropagation();
    toggleClassArchived(cls);
  });
  card.querySelector("[data-cls-edit]").addEventListener("click", function(e) {
    e.stopPropagation();
    openEditClass(cls.id);
  });
  card.querySelector("[data-cls-del]").addEventListener("click", function(e) {
    e.stopPropagation();
    confirmDelete('Delete class "' + cls.name + '" and all its lessons and cards?', function() {
      store.deleteClass(cls.id).then(renderHome);
    });
  });
  container.appendChild(card);

  store.getLessons(cls.id).then(function(lessons) {
    var meta = document.getElementById("cls-meta-" + cls.id);
    if (meta) meta.textContent = lessons.length + " lesson" + (lessons.length !== 1 ? "s" : "");
  });
  store.getProgress("class", cls.id).then(function(p) {
    if (!p || p.total === 0) return;
    var wrap = document.getElementById("cls-prog-wrap-" + cls.id);
    var fill = document.getElementById("cls-prog-fill-" + cls.id);
    var text = document.getElementById("cls-prog-text-" + cls.id);
    if (!wrap) return;
    var pct = Math.round(p.known / p.total * 100);
    wrap.style.display = "";
    fill.style.width = pct + "%";
    text.textContent = p.known + " / " + p.total + " known (" + pct + "%)";
  });
  // Apply cached accuracy immediately if available
  if (state._classAccuracyMap && state._classAccuracyMap[cls.id]) {
    _setClassAccuracyPill(cls.id, state._classAccuracyMap[cls.id]);
  }
}

function _renderClassListRow(cls, container) {
  var row = document.createElement("div");
  row.className = "class-list-row" + (cls.archived ? " class-list-row-archived" : "");
  row.tabIndex = -1;
  row.dataset.classId = cls.id;
  row.innerHTML =
    '<div class="class-list-colorbar" style="background:' + cls.color + '"></div>' +
    '<span class="class-list-icon">' + cls.icon + '</span>' +
    '<div class="class-list-info">' +
      '<div class="class-list-name">' + escHtml(cls.name) + '</div>' +
      '<div class="class-list-meta" id="cls-meta-' + cls.id + '">Loading...</div>' +
    '</div>' +
    '<div class="class-list-right">' +
      (cls.due_count > 0 ? '<span class="due-badge">' + cls.due_count + ' due</span>' : '') +
      '<span class="class-acc-pill hidden" id="cls-acc-' + cls.id + '"></span>' +
      (state.homeSelectMode ? '' :
        '<div class="class-list-actions">' +
          '<button class="icon-btn" title="' + (cls.archived ? "Unarchive" : "Archive") + '" data-cls-archive="' + cls.id + '">' + (cls.archived ? "📤" : "🗄️") + '</button>' +
          '<button class="icon-btn" title="Edit" data-cls-edit="' + cls.id + '">✏️</button>' +
          '<button class="icon-btn danger" title="Delete" data-cls-del="' + cls.id + '">🗑️</button>' +
        '</div>') +
    '</div>';
  row.addEventListener("click", function(e) {
    if (e.target.closest("[data-cls-edit],[data-cls-del],[data-cls-archive]")) return;
    if (state.homeSelectMode) { toggleClassSelection(cls.id); return; }
    openClass(cls.id);
  });
  var archiveBtn = row.querySelector("[data-cls-archive]");
  var editBtn = row.querySelector("[data-cls-edit]");
  var delBtn = row.querySelector("[data-cls-del]");
  if (archiveBtn) archiveBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    toggleClassArchived(cls);
  });
  if (editBtn) editBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    openEditClass(cls.id);
  });
  if (delBtn) delBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    confirmDelete('Delete class "' + cls.name + '" and all its lessons and cards?', function() {
      store.deleteClass(cls.id).then(renderHome);
    });
  });
  container.appendChild(row);

  store.getLessons(cls.id).then(function(lessons) {
    var meta = document.getElementById("cls-meta-" + cls.id);
    if (meta) meta.textContent = lessons.length + " lesson" + (lessons.length !== 1 ? "s" : "");
  });
  if (state._classAccuracyMap && state._classAccuracyMap[cls.id]) {
    _setClassAccuracyPill(cls.id, state._classAccuracyMap[cls.id]);
  }
}

function _setClassAccuracyPill(classId, acc) {
  var el = document.getElementById("cls-acc-" + classId);
  if (!el || acc.total === 0) return;
  var pct = Math.round(acc.correct / acc.total * 100);
  el.textContent = pct + "%";
  el.classList.remove("hidden", "acc-high", "acc-mid", "acc-low");
  el.classList.add(pct >= 70 ? "acc-high" : pct >= 40 ? "acc-mid" : "acc-low");
}

function _applyClassAccuracy(accMap) {
  Object.keys(accMap).forEach(function(cid) {
    _setClassAccuracyPill(cid, accMap[cid]);
  });
}

(function initHomeFilterBar() {
  var slicerBar = document.getElementById("home-slicer-bar");
  if (slicerBar) {
    slicerBar.addEventListener("click", function(e) {
      var btn = e.target.closest(".pill");
      if (!btn) return;
      state.homeFilter = btn.dataset.filter;
      try { localStorage.setItem("fc-home-filter", state.homeFilter); } catch (_) {}
      slicerBar.querySelectorAll(".pill").forEach(function(b) {
        b.classList.toggle("active", b.dataset.filter === state.homeFilter);
      });
      _renderClassItems(_applyHomeFilter(state.homeClasses));
    });
  }

  var archiveToggle = document.getElementById("btn-toggle-archived");
  if (archiveToggle) {
    archiveToggle.classList.toggle("active", state.showArchived);
    archiveToggle.addEventListener("click", function() {
      state.showArchived = !state.showArchived;
      try { localStorage.setItem("fc-show-archived", state.showArchived ? "1" : "0"); } catch (_) {}
      archiveToggle.classList.toggle("active", state.showArchived);
      renderHome();
    });
  }

  var viewToggle = document.getElementById("home-view-toggle");
  if (viewToggle) {
    viewToggle.addEventListener("click", function(e) {
      var btn = e.target.closest(".view-toggle-btn");
      if (!btn) return;
      state.homeView = btn.dataset.view;
      try { localStorage.setItem("fc-home-view", state.homeView); } catch (_) {}
      _updateHomeViewToggle();
      _renderClassItems(_applyHomeFilter(state.homeClasses));
    });
  }
}());

document.getElementById("class-sort-select").addEventListener("change", function() {
  state.currentClassSort = this.value;
  try { localStorage.setItem("fc-class-sort", this.value); } catch (_) {}
  renderHome();
});

document.getElementById("class-sort-dir").addEventListener("click", function() {
  state.currentClassSortDir = state.currentClassSortDir === "asc" ? "desc" : "asc";
  try { localStorage.setItem("fc-class-sort-dir", state.currentClassSortDir); } catch (_) {}
  renderHome();
});

function openClass(classId) {
  store.getClass(classId).then(function(cls) {
    if (!cls) return;
    state.currentClass = cls;
    state.lessonFilter = "all";
    state._lessonAccuracyMap = {};
    var nameEl = document.getElementById("class-detail-name");
    nameEl.innerHTML = escHtml(cls.icon + " " + cls.name) +
      (cls.archived ? ' <span class="archived-badge">Archived</span>' : "");
    document.getElementById("btn-archive-class").textContent = cls.archived ? "📤 Unarchive Class" : "🗄️ Archive Class";
    setSelectMode(false);
    document.getElementById("lesson-sort-select").value = state.currentLessonSort;
    document.getElementById("lesson-sort-dir").textContent = state.currentLessonSortDir === "desc" ? "↓" : "↑";
    showScreen("class");
    saveScreenState("class", classId);
    renderLessons();
  });
}

document.getElementById("lesson-sort-select").addEventListener("change", function() {
  state.currentLessonSort = this.value;
  try { localStorage.setItem("fc-lesson-sort", this.value); } catch (_) {}
  renderLessons();
});

document.getElementById("lesson-sort-dir").addEventListener("click", function() {
  state.currentLessonSortDir = state.currentLessonSortDir === "asc" ? "desc" : "asc";
  try { localStorage.setItem("fc-lesson-sort-dir", state.currentLessonSortDir); } catch (_) {}
  document.getElementById("lesson-sort-dir").textContent = state.currentLessonSortDir === "desc" ? "↓" : "↑";
  renderLessons();
});

/* ============================
   CLASS FORM MODAL
   ============================ */

function initColorPicker() {
  var picker = document.getElementById("color-picker");
  picker.innerHTML = "";
  CLASS_COLORS.forEach(function(color) {
    var sw = document.createElement("div");
    sw.className = "color-swatch";
    sw.style.background = color;
    sw.dataset.color = color;
    sw.addEventListener("click", function() {
      picker.querySelectorAll(".color-swatch").forEach(function(s) { s.classList.remove("active"); });
      this.classList.add("active");
    });
    picker.appendChild(sw);
  });
}

function initIconPicker() {
  var picker = document.getElementById("icon-picker");
  picker.innerHTML = "";
  CLASS_ICONS.forEach(function(icon) {
    var opt = document.createElement("span");
    opt.className = "icon-opt";
    opt.textContent = icon;
    opt.dataset.icon = icon;
    opt.addEventListener("click", function() {
      picker.querySelectorAll(".icon-opt").forEach(function(o) { o.classList.remove("active"); });
      this.classList.add("active");
    });
    picker.appendChild(opt);
  });
}

function openNewClass() {
  state.editingClassId = null;
  document.getElementById("modal-class-title").textContent = "New Class";
  document.getElementById("class-name-input").value = "";
  document.getElementById("class-level-input").value = "";
  initColorPicker();
  initIconPicker();
  // Default selections
  document.querySelector("#color-picker .color-swatch").classList.add("active");
  document.querySelector("#icon-picker .icon-opt").classList.add("active");
  openModal("class");
  document.getElementById("class-name-input").focus();
}

function openEditClass(classId) {
  store.getClass(classId).then(function(cls) {
    if (!cls) return;
    state.editingClassId = classId;
    document.getElementById("modal-class-title").textContent = "Edit Class";
    document.getElementById("class-name-input").value = cls.name;
    document.getElementById("class-level-input").value = cls.level != null ? cls.level : "";
    initColorPicker();
    initIconPicker();
    var colorSwatch = document.querySelector('[data-color="' + cls.color + '"]');
    if (colorSwatch) colorSwatch.classList.add("active");
    else document.querySelector("#color-picker .color-swatch").classList.add("active");
    var iconOpt = document.querySelector('[data-icon="' + cls.icon + '"]');
    if (iconOpt) iconOpt.classList.add("active");
    else document.querySelector("#icon-picker .icon-opt").classList.add("active");
    openModal("class");
  });
}

document.getElementById("btn-save-class").addEventListener("click", function() {
  var name  = document.getElementById("class-name-input").value.trim();
  var active_color = document.querySelector("#color-picker .color-swatch.active");
  var active_icon  = document.querySelector("#icon-picker .icon-opt.active");
  if (!name) { alert("Please enter a class name."); return; }
  var color = active_color ? active_color.dataset.color : CLASS_COLORS[0];
  var icon  = active_icon  ? active_icon.dataset.icon   : CLASS_ICONS[0];
  var levelVal = document.getElementById("class-level-input").value.trim();
  var level = levelVal !== "" ? parseInt(levelVal, 10) : null;
  if (level !== null && isNaN(level)) { alert("Level must be a number."); return; }
  var p;
  if (state.editingClassId) {
    p = store.updateClass(state.editingClassId, { name: name, color: color, icon: icon, level: level });
  } else {
    p = store.createClass({ name: name, color: color, icon: icon, level: level });
  }
  p.then(function() {
    closeModal("class");
    renderHome();
  });
});

document.getElementById("btn-new-class").addEventListener("click", openNewClass);
document.getElementById("btn-class-back").addEventListener("click", function() { renderHome(); showScreen("home"); saveScreenState("home"); });
document.getElementById("btn-edit-class").addEventListener("click", function() {
  if (state.currentClass) openEditClass(state.currentClass.id);
});
document.getElementById("btn-archive-class").addEventListener("click", function() {
  if (!state.currentClass) return;
  toggleClassArchived(state.currentClass).then(function() {
    if (state.currentClass) openClass(state.currentClass.id);
  });
});
document.getElementById("btn-class-stats").addEventListener("click", function() {
  if (state.currentClass) openStats("class", state.currentClass.id, state.currentClass.name);
});

/* ============================
   LESSON LIST
   ============================ */

function sortLessons(lessons, dueInfo, key, dir) {
  var d = dir === "desc" ? -1 : 1;
  var copy = lessons.slice();
  copy.sort(function(a, b) {
    var r;
    if (key === "date_added") {
      r = (a.created_at || 0) - (b.created_at || 0);
    } else if (key === "date_interacted") {
      r = (a.last_interacted_at || 0) - (b.last_interacted_at || 0);
    } else if (key === "date_modified") {
      r = (a.last_modified_at || a.created_at || 0) - (b.last_modified_at || b.created_at || 0);
    } else if (key === "due_count") {
      var aCount = (dueInfo && dueInfo.dueCounts && dueInfo.dueCounts[a.id]) || 0;
      var bCount = (dueInfo && dueInfo.dueCounts && dueInfo.dueCounts[b.id]) || 0;
      r = aCount - bCount;
    } else {
      return 0;
    }
    return d * r;
  });
  return copy;
}

function renderLessons() {
  if (!state.currentClass) return;
  store.getLessons(state.currentClass.id).then(function(lessons) {
    state.currentClassLessons = lessons;
    _renderLessonSlicer(lessons);
    _renderLessonItems(lessons, state._lessonAccuracyMap);

    // Load accuracy async (server only)
    if (IS_SERVER && store.getLessonAccuracy) {
      store.getLessonAccuracy(state.currentClass.id).then(function(accMap) {
        state._lessonAccuracyMap = accMap;
        _applyLessonAccuracy(accMap);
      }).catch(function() {});
    }
  });
}

function _renderLessonSlicer(lessons) {
  var bar = document.getElementById("lesson-slicer-bar");
  if (!bar) return;
  var formats = [];
  lessons.forEach(function(l) {
    if (formats.indexOf(l.format) === -1) formats.push(l.format);
  });

  bar.innerHTML = "";
  if (formats.length <= 1) {
    bar.classList.add("hidden");
    state.lessonFilter = "all";
    return;
  }

  // Validate before building pills so active class is applied correctly
  if (state.lessonFilter !== "all" && formats.indexOf(state.lessonFilter) === -1) {
    state.lessonFilter = "all";
  }

  bar.classList.remove("hidden");

  var formatLabels = { "term-def": "Thẻ học", "mcq": "MCQ", "true-false": "True/False", "image-def": "Image↔Def" };
  var allBtn = document.createElement("button");
  allBtn.className = "pill" + (state.lessonFilter === "all" ? " active" : "");
  allBtn.dataset.filter = "all";
  allBtn.textContent = "All";
  bar.appendChild(allBtn);

  formats.forEach(function(fmt) {
    var btn = document.createElement("button");
    btn.className = "pill" + (state.lessonFilter === fmt ? " active" : "");
    btn.dataset.filter = fmt;
    btn.textContent = formatLabels[fmt] || fmt;
    bar.appendChild(btn);
  });
}

function _renderLessonItems(lessons, accMap) {
  var list = document.getElementById("lesson-list");
  var empty = document.getElementById("empty-class");

  var filtered = state.lessonFilter === "all" ? lessons
    : lessons.filter(function(l) { return l.format === state.lessonFilter; });

  if (filtered.length === 0) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    list.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  list.classList.remove("hidden");
  var lessonIds = filtered.map(function(l) { return l.id; });

  store.getDueLessons(lessonIds).then(function(dueInfo) {
    var sortKey = state.currentLessonSort || "date_added";
    filtered = sortLessons(filtered, dueInfo, sortKey, state.currentLessonSortDir);
    var now = Math.floor(Date.now() / 1000);

    // Clear and repopulate in the same tick as the resolved data — an empty
    // intermediate paint here would shrink the page and make the browser
    // clamp window.scrollY, which never gets restored once items are re-added.
    list.innerHTML = "";
    filtered.forEach(function(lesson) {
      var item = document.createElement("div");
      var selected = state.selectMode && state.selectedLessonIds.indexOf(lesson.id) !== -1;
      var isDue = dueInfo.due.indexOf(lesson.id) !== -1;
      var dueCount = (dueInfo.dueCounts && dueInfo.dueCounts[lesson.id]) || 0;
      var nextReviewAt = dueInfo.schedule && dueInfo.schedule[lesson.id];
      var reviewLabel = "";
      if (isDue) {
        reviewLabel = dueCount + " card" + (dueCount !== 1 ? "s" : "") + " due for review";
      } else if (nextReviewAt) {
        var secsLeft = nextReviewAt - now;
        var reviewLabel2 = secsLeft < 3600 ? Math.ceil(secsLeft / 60) + "m"
          : secsLeft < 86400 ? Math.ceil(secsLeft / 3600) + "h"
          : Math.ceil(secsLeft / 86400) + "d";
        reviewLabel = "Next review in " + reviewLabel2;
      }

      var acc = accMap && accMap[lesson.id];
      var accHtml = acc && acc.total > 0
        ? '<span class="lesson-acc-pill ' + (acc.pct >= 70 ? "acc-high" : acc.pct >= 40 ? "acc-mid" : "acc-low") + '" id="les-acc-' + lesson.id + '">' + acc.pct + '%</span>'
        : '<span class="lesson-acc-pill hidden" id="les-acc-' + lesson.id + '"></span>';

      item.className = "lesson-item" + (selected ? " selected" : "") + (isDue ? " lesson-due" : "");
      item.dataset.lessonId = lesson.id;
      item.tabIndex = -1;
      item.innerHTML =
        (state.selectMode
          ? '<input type="checkbox" class="lesson-check"' + (selected ? " checked" : "") + '>'
          : '') +
        '<div class="lesson-info">' +
          '<div class="lesson-title">' + escHtml(lesson.title) + '</div>' +
          '<div class="lesson-meta" id="les-meta-' + lesson.id + '">Loading...</div>' +
          (reviewLabel ? '<div class="lesson-due-label' + (isDue ? " is-due" : "") + '">' + reviewLabel + '</div>' : '') +
          '<div class="progress-mini-wrap" id="les-prog-wrap-' + lesson.id + '" style="display:none">' +
            '<div class="progress-mini"><div class="progress-mini-fill" id="les-prog-fill-' + lesson.id + '" style="width:0%"></div></div>' +
            '<span class="progress-mini-text" id="les-prog-text-' + lesson.id + '"></span>' +
          '</div>' +
        '</div>' +
        (isDue ? '<span class="due-badge">' + dueCount + ' due</span>' : '') +
        accHtml +
        '<span class="format-badge ' + lesson.format + '">' +
          (lesson.format === "term-def" ? "Thẻ học" : lesson.format === "mcq" ? "MCQ" : lesson.format === "true-false" ? "True/False" : "Image↔Def") +
        '</span>' +
        (state.selectMode
          ? ''
          : '<div class="lesson-actions">' +
              '<button class="icon-btn" title="Edit" data-les-edit="' + lesson.id + '">✏️</button>' +
              '<button class="icon-btn danger" title="Delete" data-les-del="' + lesson.id + '">🗑️</button>' +
            '</div>');
      item.addEventListener("click", function(e) {
        if (state.selectMode) { toggleLessonSelection(lesson.id); return; }
        if (e.target.closest("[data-les-edit],[data-les-del]")) return;
        openLesson(lesson.id);
      });
      if (!state.selectMode) {
        item.querySelector("[data-les-edit]").addEventListener("click", function(e) {
          e.stopPropagation();
          openEditLesson(lesson.id);
        });
        item.querySelector("[data-les-del]").addEventListener("click", function(e) {
          e.stopPropagation();
          confirmDelete('Delete lesson "' + lesson.title + '" and all its cards?', function() {
            store.deleteLesson(lesson.id).then(renderLessons);
          });
        });
      }
      list.appendChild(item);
      store.getCards(lesson.id).then(function(cards) {
        var meta = document.getElementById("les-meta-" + lesson.id);
        if (meta) meta.textContent = cards.length + " card" + (cards.length !== 1 ? "s" : "");
      });
      store.getProgress("lesson", lesson.id).then(function(p) {
        if (!p || p.total === 0) return;
        var wrap = document.getElementById("les-prog-wrap-" + lesson.id);
        var fill = document.getElementById("les-prog-fill-" + lesson.id);
        var text = document.getElementById("les-prog-text-" + lesson.id);
        if (!wrap) return;
        var pct = Math.round(p.known / p.total * 100);
        wrap.style.display = "";
        fill.style.width = pct + "%";
        text.textContent = p.known + " / " + p.total + " known (" + pct + "%)";
      });
    });
  });
}

function _applyLessonAccuracy(accMap) {
  Object.keys(accMap).forEach(function(lid) {
    var acc = accMap[lid];
    if (acc.total === 0) return;
    var el = document.getElementById("les-acc-" + lid);
    if (!el) return;
    el.textContent = acc.pct + "%";
    el.classList.remove("hidden", "acc-high", "acc-mid", "acc-low");
    el.classList.add(acc.pct >= 70 ? "acc-high" : acc.pct >= 40 ? "acc-mid" : "acc-low");
  });
}

(function initLessonSlicerBar() {
  var bar = document.getElementById("lesson-slicer-bar");
  if (!bar) return;
  bar.addEventListener("click", function(e) {
    var btn = e.target.closest(".pill");
    if (!btn) return;
    state.lessonFilter = btn.dataset.filter;
    bar.querySelectorAll(".pill").forEach(function(b) {
      b.classList.toggle("active", b.dataset.filter === state.lessonFilter);
    });
    _renderLessonItems(state.currentClassLessons, state._lessonAccuracyMap);
  });
}());

/* ============================
   MULTI-LESSON SELECTION
   ============================ */

function setSelectMode(on) {
  state.selectMode = on;
  state.selectedLessonIds = [];
  document.getElementById("lesson-select-bar").classList.toggle("hidden", !on);
  document.getElementById("btn-select-lessons").classList.toggle("active", on);
  document.getElementById("select-all-lessons").checked = false;

  // Update existing items in-place — no full re-render needed
  document.querySelectorAll("#lesson-list .lesson-item").forEach(function(item) {
    item.classList.remove("selected");
    var existing = item.querySelector(".lesson-check");
    if (on && !existing) {
      var check = document.createElement("input");
      check.type = "checkbox";
      check.className = "lesson-check";
      item.insertBefore(check, item.firstChild);
    } else if (!on && existing) {
      existing.remove();
    }
  });

  updateSelectBar();
}

function toggleLessonSelection(lessonId) {
  var idx = state.selectedLessonIds.indexOf(lessonId);
  if (idx === -1) state.selectedLessonIds.push(lessonId);
  else state.selectedLessonIds.splice(idx, 1);
  // Update only the affected item — no full re-render needed
  var item = document.querySelector('[data-lesson-id="' + lessonId + '"]');
  if (item) {
    var nowSelected = state.selectedLessonIds.indexOf(lessonId) !== -1;
    item.classList.toggle("selected", nowSelected);
    var check = item.querySelector(".lesson-check");
    if (check) check.checked = nowSelected;
  }
  updateSelectBar();
}

function updateSelectBar() {
  var n = state.selectedLessonIds.length;
  document.getElementById("select-count").textContent = n + " selected";
  document.getElementById("btn-study-selected").disabled = n === 0;
  document.getElementById("btn-delete-selected-lessons").disabled = n === 0;
  var total = (state.currentClassLessons || []).length;
  document.getElementById("select-all-lessons").checked = total > 0 && n === total;
}

document.getElementById("btn-select-lessons").addEventListener("click", function() {
  setSelectMode(!state.selectMode);
});

/* ============================
   HOME MULTI-CLASS SELECTION
   ============================ */

function setHomeSelectMode(on) {
  state.homeSelectMode = on;
  state.selectedClassIds = [];
  var bar = document.getElementById("home-select-bar");
  if (bar) bar.classList.toggle("hidden", !on);
  var btn = document.getElementById("btn-select-classes");
  if (btn) btn.classList.toggle("active", on);
  var allCheck = document.getElementById("select-all-classes");
  if (allCheck) allCheck.checked = false;

  document.querySelectorAll("#class-list [data-class-id]").forEach(function(card) {
    card.classList.remove("selected");
    var existing = card.querySelector(".lesson-check");
    if (on && !existing) {
      var check = document.createElement("input");
      check.type = "checkbox";
      check.className = "lesson-check";
      if (card.classList.contains("class-list-row")) {
        var colorbar = card.querySelector(".class-list-colorbar");
        card.insertBefore(check, colorbar ? colorbar.nextSibling : card.firstChild);
      } else {
        card.insertBefore(check, card.firstChild);
      }
    } else if (!on && existing) {
      existing.remove();
    }
  });

  updateHomeSelectBar();
}

function toggleClassSelection(classId) {
  var idx = state.selectedClassIds.indexOf(classId);
  if (idx === -1) state.selectedClassIds.push(classId);
  else state.selectedClassIds.splice(idx, 1);
  var card = document.querySelector('[data-class-id="' + classId + '"]');
  if (card) {
    var nowSelected = state.selectedClassIds.indexOf(classId) !== -1;
    card.classList.toggle("selected", nowSelected);
    var check = card.querySelector(".lesson-check");
    if (check) check.checked = nowSelected;
  }
  updateHomeSelectBar();
}

function updateHomeSelectBar() {
  var n = state.selectedClassIds.length;
  var countEl = document.getElementById("home-select-count");
  if (countEl) countEl.textContent = n + " class" + (n !== 1 ? "es" : "") + " selected";
  var studyBtn = document.getElementById("btn-study-classes");
  if (studyBtn) studyBtn.disabled = n === 0;
  var total = document.querySelectorAll("#class-list [data-class-id]").length;
  var allCheck = document.getElementById("select-all-classes");
  if (allCheck) allCheck.checked = total > 0 && n === total;
}

document.getElementById("btn-select-classes").addEventListener("click", function() {
  setHomeSelectMode(!state.homeSelectMode);
});

document.getElementById("btn-home-select").addEventListener("click", function() {
  setHomeSelectMode(!state.homeSelectMode);
});

document.getElementById("btn-select-classes-cancel").addEventListener("click", function() {
  setHomeSelectMode(false);
});

document.getElementById("select-all-classes").addEventListener("change", function() {
  if (this.checked) {
    state.selectedClassIds = Array.from(document.querySelectorAll("#class-list [data-class-id]"))
      .map(function(card) { return card.dataset.classId; });
  } else {
    state.selectedClassIds = [];
  }
  document.querySelectorAll("#class-list [data-class-id]").forEach(function(card) {
    var sel = state.selectedClassIds.indexOf(card.dataset.classId) !== -1;
    card.classList.toggle("selected", sel);
    var check = card.querySelector(".lesson-check");
    if (check) check.checked = sel;
  });
  updateHomeSelectBar();
});

document.getElementById("btn-study-classes").addEventListener("click", function() {
  var ids = state.selectedClassIds.slice();
  if (ids.length === 0) return;
  Promise.all(ids.map(function(id) { return store.getLessons(id); }))
    .then(function(lessonArrays) {
      var allLessons = lessonArrays.reduce(function(acc, arr) { return acc.concat(arr); }, []);
      if (allLessons.length === 0) {
        alert("The selected classes have no lessons.");
        return;
      }
      var lessonIds = allLessons.map(function(l) { return l.id; });
      var n = ids.length;
      setHomeSelectMode(false);
      openSetup({
        lessonIds: lessonIds,
        lessons: allLessons,
        returnScreen: "home",
        title: n + " class" + (n !== 1 ? "es" : "") + " selected"
      });
    });
});

function setCardSelectMode(on) {
  state.cardSelectMode = on;
  state.selectedCardIds = [];
  document.getElementById("btn-select-cards").classList.toggle("active", on);
  var toolbar = document.getElementById("lesson-toolbar");
  if (on) {
    toolbar.innerHTML =
      '<div class="select-bar">' +
        '<label class="select-all-label">' +
          '<input type="checkbox" id="select-all-cards"> Select all' +
        '</label>' +
        '<span id="card-select-count" class="select-count">0 selected</span>' +
        '<button class="btn btn-sm btn-ghost" id="btn-card-select-cancel">Cancel</button>' +
        '<button class="btn btn-sm btn-danger" id="btn-delete-selected-cards" disabled>Delete selected</button>' +
      '</div>';
    toolbar.style.display = "";
    document.getElementById("btn-card-select-cancel").addEventListener("click", function() {
      setCardSelectMode(false);
      renderCards();
    });
    document.getElementById("select-all-cards").addEventListener("change", function() {
      if (this.checked) {
        state.selectedCardIds = (state.currentLessonCards || []).map(function(c) { return c.id; });
      } else {
        state.selectedCardIds = [];
      }
      document.querySelectorAll("#card-list .card-item").forEach(function(item) {
        var sel = state.selectedCardIds.indexOf(item.dataset.cardId) !== -1;
        item.classList.toggle("selected", sel);
        var check = item.querySelector(".lesson-check");
        if (check) check.checked = sel;
      });
      updateCardSelectBar();
    });
    document.getElementById("btn-delete-selected-cards").addEventListener("click", function() {
      var ids = state.selectedCardIds.slice();
      if (ids.length === 0) return;
      confirmDelete(
        "Delete " + ids.length + " card" + (ids.length !== 1 ? "s" : "") + "?",
        function() {
          Promise.all(ids.map(function(id) {
            return store.deleteCard(id, state.currentLesson.id);
          })).then(function() { setCardSelectMode(false); renderCards(); })
            .catch(function() { setCardSelectMode(false); renderCards(); });
        }
      );
    });
  } else {
    toolbar.innerHTML = "";
    toolbar.style.display = "none";
  }
}

function toggleCardSelection(cardId) {
  var idx = state.selectedCardIds.indexOf(cardId);
  if (idx === -1) state.selectedCardIds.push(cardId);
  else state.selectedCardIds.splice(idx, 1);
  var item = document.querySelector('[data-card-id="' + cardId + '"]');
  if (item) {
    var sel = state.selectedCardIds.indexOf(cardId) !== -1;
    item.classList.toggle("selected", sel);
    var check = item.querySelector(".lesson-check");
    if (check) check.checked = sel;
  }
  updateCardSelectBar();
}

function updateCardSelectBar() {
  var n = state.selectedCardIds.length;
  var countEl = document.getElementById("card-select-count");
  var deleteBtn = document.getElementById("btn-delete-selected-cards");
  var allCheck = document.getElementById("select-all-cards");
  if (countEl) countEl.textContent = n + " selected";
  if (deleteBtn) deleteBtn.disabled = n === 0;
  var total = (state.currentLessonCards || []).length;
  if (allCheck) allCheck.checked = total > 0 && n === total;
}

document.getElementById("btn-select-cards").addEventListener("click", function() {
  setCardSelectMode(!state.cardSelectMode);
  renderCards();
});

document.getElementById("btn-select-cancel").addEventListener("click", function() {
  setSelectMode(false);
});

document.getElementById("select-all-lessons").addEventListener("change", function() {
  if (this.checked) {
    state.selectedLessonIds = (state.currentClassLessons || []).map(function(l) { return l.id; });
  } else {
    state.selectedLessonIds = [];
  }
  // Update items in-place — no full re-render needed
  document.querySelectorAll("#lesson-list .lesson-item").forEach(function(item) {
    var lessonId = item.dataset.lessonId;
    var sel = state.selectedLessonIds.indexOf(lessonId) !== -1;
    item.classList.toggle("selected", sel);
    var check = item.querySelector(".lesson-check");
    if (check) check.checked = sel;
  });
  updateSelectBar();
});

document.getElementById("btn-study-selected").addEventListener("click", function() {
  var ids = state.selectedLessonIds.slice();
  if (ids.length === 0) return;
  var lessons = (state.currentClassLessons || []).filter(function(l) {
    return ids.indexOf(l.id) !== -1;
  });
  openSetup({
    lessonIds: ids,
    lessons: lessons,
    returnScreen: "class",
    title: lessons.length + " lessons selected"
  });
});

document.getElementById("btn-delete-selected-lessons").addEventListener("click", function() {
  var ids = state.selectedLessonIds.slice();
  if (ids.length === 0) return;
  confirmDelete(
    "Delete " + ids.length + " lesson" + (ids.length !== 1 ? "s" : "") + " and all their cards?",
    function() {
      Promise.all(ids.map(function(id) { return store.deleteLesson(id); }))
        .then(function() { setSelectMode(false); renderLessons(); })
        .catch(function() { setSelectMode(false); renderLessons(); });
    }
  );
});

/* ============================
   LESSON FORM MODAL
   ============================ */

var FORMAT_HINTS = {
  "term-def":   "Best for vocabulary, concepts, formulas. Bulk: term | definition",
  "mcq":        "Best for exam prep. Bulk: question | correct | wrong1 [| wrong2…] [;; explanation]",
  "true-false": "Best for T/F statements. Bulk: statement | true  or  statement | false [;; explanation]",
  "image-def":  "Image on front, text definition on back. Cards added one at a time (no bulk import)."
};

function initLessonFormatPicker(selectedFormat) {
  var picker = document.getElementById("lesson-format-picker");
  picker.querySelectorAll(".pill").forEach(function(p) {
    p.classList.toggle("active", p.dataset.value === selectedFormat);
    if (p.dataset.value === "image-def") p.style.display = IS_SERVER ? "" : "none";
  });
  document.getElementById("format-hint").textContent = FORMAT_HINTS[selectedFormat] || "";
}

document.getElementById("lesson-format-picker").addEventListener("click", function(e) {
  var pill = e.target.closest(".pill");
  if (!pill) return;
  this.querySelectorAll(".pill").forEach(function(p) { p.classList.remove("active"); });
  pill.classList.add("active");
  document.getElementById("format-hint").textContent = FORMAT_HINTS[pill.dataset.value];
});

function openNewLesson() {
  state.editingLessonId = null;
  document.getElementById("modal-lesson-title").textContent = "New Lesson";
  document.getElementById("lesson-title-input").value = "";
  initLessonFormatPicker("term-def");
  openModal("lesson");
  document.getElementById("lesson-title-input").focus();
}

function openEditLesson(lessonId) {
  var all = IS_SERVER
    ? state.currentClassLessons
    : JSON.parse(localStorage.getItem("fc-lessons") || "[]");
  var lesson = all.find(function(l) { return l.id === lessonId; });
  if (!lesson) return;
  state.editingLessonId = lessonId;
  document.getElementById("modal-lesson-title").textContent = "Edit Lesson";
  document.getElementById("lesson-title-input").value = lesson.title;
  initLessonFormatPicker(lesson.format);
  // Lock format for existing lessons
  document.getElementById("lesson-format-picker").querySelectorAll(".pill").forEach(function(p) {
    p.disabled = true;
    p.style.pointerEvents = "none";
    p.style.opacity = p.dataset.value === lesson.format ? "1" : "0.4";
  });
  openModal("lesson");
}

document.getElementById("btn-save-lesson").addEventListener("click", function() {
  var title = document.getElementById("lesson-title-input").value.trim();
  if (!title) { alert("Please enter a lesson title."); return; }
  var activePill = document.querySelector("#lesson-format-picker .pill.active");
  var format = activePill ? activePill.dataset.value : "term-def";
  // Re-enable pills after submit
  document.getElementById("lesson-format-picker").querySelectorAll(".pill").forEach(function(p) {
    p.disabled = false;
    p.style.pointerEvents = "";
    p.style.opacity = "";
  });
  var p;
  if (state.editingLessonId) {
    p = store.updateLesson(state.editingLessonId, { title: title });
  } else {
    p = store.createLesson({ classId: state.currentClass.id, title: title, format: format });
  }
  p.then(function() {
    closeModal("lesson");
    renderLessons();
  });
});

document.getElementById("btn-new-lesson").addEventListener("click", openNewLesson);

/* ============================
   LESSON DETAIL — Card List
   ============================ */

function openLesson(lessonId) {
  var all = IS_SERVER
    ? state.currentClassLessons
    : JSON.parse(localStorage.getItem("fc-lessons") || "[]");
  var lesson = all.find(function(l) { return l.id === lessonId; });
  if (!lesson) return;
  state.currentLesson = lesson;
  document.getElementById("lesson-detail-title").textContent = lesson.title;
  document.getElementById("btn-bulk-add").style.display = lesson.format === "image-def" ? "none" : "";
  var _countBadge = document.getElementById("lesson-card-count");
  if (_countBadge) _countBadge.classList.add("hidden");
  setCardSelectMode(false); // resets state + toolbar; renderCards() below handles the re-render
  renderCards();
  showScreen("lesson");
  saveScreenState("lesson", state.currentClass && state.currentClass.id, lessonId);
}

function renderCards() {
  if (!state.currentLesson) return;
  var lessonId = state.currentLesson.id;
  var dataPromise = IS_SERVER
    ? store.getLessonStats(lessonId)
    : store.getCards(lessonId).then(function(cards) {
        var attemptsRaw = JSON.parse(localStorage.getItem("fc-attempts") || "[]");
        var statsMap = {};
        cards.forEach(function(card) {
          var ca = attemptsRaw.filter(function(a) { return a.card_id === card.id; });
          statsMap[card.id] = computeStats(ca);
        });
        return { cards: cards, statsMap: statsMap };
      });

  dataPromise.then(function(result) {
    if (!state.currentLesson || state.currentLesson.id !== lessonId) return;
    var cards = result.cards;
    var statsMap = result.statsMap;
    var list = document.getElementById("card-list");
    var empty = document.getElementById("empty-lesson");
    var countBadge = document.getElementById("lesson-card-count");
    list.innerHTML = "";
    if (cards.length === 0) {
      empty.classList.remove("hidden");
      list.classList.add("hidden");
      if (countBadge) { countBadge.textContent = "0 cards"; countBadge.classList.remove("hidden"); }
      return;
    }
    empty.classList.add("hidden");
    list.classList.remove("hidden");
    if (countBadge) { countBadge.textContent = cards.length + " card" + (cards.length !== 1 ? "s" : ""); countBadge.classList.remove("hidden"); }
    cards.forEach(function(card, i) {
      var item = document.createElement("div");
      item.className = "card-item" + (state.selectedCardIds.indexOf(card.id) !== -1 ? " selected" : "");
      item.dataset.cardId = card.id;
      var stats = statsMap[card.id] || { total: 0, correct: 0, level: "new" };
      var pct = stats.total > 0 ? Math.round(stats.correct / stats.total * 100) : null;
      var pillLabel = stats.total === 0 ? "New"
        : stats.level.charAt(0).toUpperCase() + stats.level.slice(1) + " · " + pct + "%";
      var diffPill = '<span class="diff-pill ' + stats.level + '">' + pillLabel + '</span>';

      var termEl = document.createElement("div");
      var defEl  = document.createElement("div");
      termEl.className = "card-term";
      defEl.className  = "card-def";

      if (card.format === "term-def") {
        renderLatex(card.data.term, termEl);
        renderLatex(card.data.def, defEl);
      } else if (card.format === "image-def") {
        var cImg = document.createElement("img");
        cImg.src = card.data.imageUrl;
        cImg.alt = "Card image";
        cImg.style.maxHeight = "60px";
        cImg.style.maxWidth  = "120px";
        cImg.style.objectFit = "contain";
        cImg.style.borderRadius = "4px";
        termEl.appendChild(cImg);
        renderLatex(card.data.def, defEl);
      } else if (card.format === "true-false") {
        renderLatex(card.data.statement, termEl);
        defEl.textContent = card.data.correct === "true" ? "✓ True" : "✓ False";
      } else {
        renderLatex(card.data.question, termEl);
        renderLatex("✓ " + card.data.correct, defEl);
      }

      item.innerHTML =
        (state.cardSelectMode
          ? '<input type="checkbox" class="lesson-check"' + (state.selectedCardIds.indexOf(card.id) !== -1 ? " checked" : "") + '>'
          : '') +
        '<span class="card-num">' + (i + 1) + '</span>' +
        '<div class="card-content"></div>' +
        diffPill +
        (state.cardSelectMode ? '' :
          '<div class="card-actions">' +
            '<button class="icon-btn" title="Edit" data-card-edit="' + card.id + '">✏️</button>' +
            '<button class="icon-btn danger" title="Delete" data-card-del="' + card.id + '">🗑️</button>' +
          '</div>');

      var contentEl = item.querySelector(".card-content");
      contentEl.appendChild(termEl);
      contentEl.appendChild(defEl);

      if (IS_SERVER) {
        var tsDiv = document.createElement("div");
        tsDiv.className = "card-timestamps";
        var tsItems = [
          { label: "Last seen", value: relativeTime(card.last_seen_at) },
          { label: "Last studied", value: relativeTime(card.last_studied_at) },
          { label: "Next review", value: futureRelativeTime(card.srs_due_at) }
        ];
        tsItems.forEach(function(ts) {
          var span = document.createElement("span");
          span.className = "card-ts-item";
          span.textContent = ts.label + ": " + ts.value;
          tsDiv.appendChild(span);
        });
        contentEl.appendChild(tsDiv);
      }

      if (state.cardSelectMode) {
        item.addEventListener("click", function(e) {
          if (e.target.tagName === "INPUT") return;
          toggleCardSelection(card.id);
        });
        var cb = item.querySelector(".lesson-check");
        if (cb) cb.addEventListener("change", function() { toggleCardSelection(card.id); });
      } else {
        item.querySelector("[data-card-edit]").addEventListener("click", function() {
          openEditCard(card.id);
        });
        item.querySelector("[data-card-del]").addEventListener("click", function() {
          confirmDelete("Delete this card?", function() {
            store.deleteCard(card.id, state.currentLesson.id).then(renderCards);
          });
        });
      }
      list.appendChild(item);
    });

    // Cache cards and update "Review X due" button
    state.currentLessonCards = cards;
    if (IS_SERVER) {
      var nowSec = Math.floor(Date.now() / 1000);
      var dueCount = cards.filter(function(c) { return c.srs_due_at && c.srs_due_at <= nowSec; }).length;
      var dueBtn = document.getElementById("btn-review-due");
      if (dueCount > 0) {
        dueBtn.textContent = "Review " + dueCount + " due";
        dueBtn.classList.remove("hidden");
      } else {
        dueBtn.classList.add("hidden");
      }
    }
  });
}

document.getElementById("btn-lesson-back").addEventListener("click", function() {
  setCardSelectMode(false);
  showScreen("class");
  saveScreenState("class", state.currentClass && state.currentClass.id);
  renderLessons();
});

document.getElementById("btn-edit-lesson").addEventListener("click", function() {
  if (state.currentLesson) openEditLesson(state.currentLesson.id);
});

document.getElementById("btn-lesson-stats").addEventListener("click", function() {
  if (state.currentLesson) openStats("lesson", state.currentLesson.id, state.currentLesson.title);
});

document.getElementById("btn-study-lesson").addEventListener("click", function() {
  if (state.currentLesson) openSetup();
});

document.getElementById("btn-review-due").addEventListener("click", function() {
  if (!state.currentLesson) return;
  var nowSec = Math.floor(Date.now() / 1000);
  var dueCards = (state.currentLessonCards || []).filter(function(c) {
    return c.srs_due_at && c.srs_due_at <= nowSec;
  });
  if (!dueCards.length) { alert("No cards are due for review right now."); return; }
  state.studyScope = {
    lessonIds: [state.currentLesson.id],
    lessons: [state.currentLesson],
    returnScreen: "lesson",
    title: state.currentLesson.title
  };
  state.studyMode = "quiz";
  state.quizCards  = shuffle(dueCards);
  state.quizIndex  = 0;
  state.quizScore  = 0;
  state.quizResults = [];
  store.markCardsSeen(dueCards.map(function(c) { return c.id; }));
  startQuiz();
});

/* ============================
   CARD FORM MODALS
   ============================ */

function makePreviewDebounce(inputId, previewId) {
  var timer = null;
  var input = document.getElementById(inputId);
  var preview = document.getElementById(previewId);
  input.addEventListener("input", function() {
    clearTimeout(timer);
    timer = setTimeout(function() { renderLatex(input.value, preview); }, 300);
  });
}

makePreviewDebounce("card-term-input",    "card-term-preview");
makePreviewDebounce("card-def-input",     "card-def-preview");
makePreviewDebounce("card-q-input",       "card-q-preview");
makePreviewDebounce("card-correct-input", "card-correct-preview");

function mcqDistractorRow(value) {
  var row = document.createElement("div");
  row.style.cssText = "display:flex;gap:6px;align-items:center;margin-top:6px";
  var input = document.createElement("input");
  input.type = "text";
  input.className = "form-input";
  input.placeholder = "Wrong answer";
  input.value = value || "";
  var rm = document.createElement("button");
  rm.type = "button";
  rm.className = "icon-btn danger";
  rm.textContent = "✕";
  rm.addEventListener("click", function() {
    row.parentNode.removeChild(row);
    syncDistractorUI();
  });
  row.appendChild(input);
  row.appendChild(rm);
  return row;
}

function syncDistractorUI() {
  var list = document.getElementById("mcq-distractor-list");
  var rows = list.querySelectorAll("div");
  var count = rows.length;
  document.getElementById("mcq-distractor-count").textContent = "(" + count + ")";
  document.getElementById("btn-add-distractor").disabled = count >= 4;
  rows.forEach(function(row) {
    var rm = row.querySelector("button");
    rm.disabled = count <= 1;
  });
}

function clearDistractorList(values) {
  var list = document.getElementById("mcq-distractor-list");
  list.innerHTML = "";
  var raw = values && values.length ? values : [""];
  var vals = raw.length > 4 ? raw.slice(0, 4) : raw;
  vals.forEach(function(v) { list.appendChild(mcqDistractorRow(v)); });
  syncDistractorUI();
}

document.getElementById("btn-add-distractor").addEventListener("click", function() {
  var list = document.getElementById("mcq-distractor-list");
  if (list.querySelectorAll("div").length >= 4) return;
  list.appendChild(mcqDistractorRow(""));
  syncDistractorUI();
  list.lastElementChild.querySelector("input").focus();
});

function openAddCard() {
  if (!state.currentLesson) return;
  state.editingCardId = null;
  var format = state.currentLesson.format;
  if (format === "term-def") {
    document.getElementById("modal-card-termdef-title").textContent = "Add Card";
    document.getElementById("card-term-input").value = "";
    document.getElementById("card-def-input").value = "";
    document.getElementById("card-term-preview").innerHTML = "";
    document.getElementById("card-def-preview").innerHTML = "";
    openModal("card-termdef");
    document.getElementById("card-term-input").focus();
  } else if (format === "true-false") {
    document.getElementById("modal-card-tf-title").textContent = "Add Card";
    document.getElementById("card-tf-statement-input").value = "";
    document.getElementById("card-tf-statement-preview").innerHTML = "";
    document.getElementById("card-tf-explanation-input").value = "";
    document.getElementById("tf-explanation-details").removeAttribute("open");
    document.querySelectorAll(".tf-answer-btn").forEach(function(b) { b.classList.remove("selected"); });
    state.tfAnswer = null;
    openModal("card-tf");
    document.getElementById("card-tf-statement-input").focus();
  } else if (format === "image-def") {
    document.getElementById("modal-card-imagedef-title").textContent = "Add Card";
    document.getElementById("card-image-input").value = "";
    document.getElementById("card-imagedef-input").value = "";
    document.getElementById("card-image-preview").src = "";
    document.getElementById("card-image-preview").classList.add("hidden");
    document.getElementById("card-image-drop-label").classList.remove("hidden");
    stagedImageUrl = null;
    openModal("card-imagedef");
    document.getElementById("card-imagedef-input").focus();
  } else {
    document.getElementById("modal-card-mcq-title").textContent = "Add Card";
    document.getElementById("card-q-input").value = "";
    document.getElementById("card-correct-input").value = "";
    clearDistractorList();
    document.getElementById("card-q-preview").innerHTML = "";
    document.getElementById("card-correct-preview").innerHTML = "";
    document.getElementById("card-explanation-input").value = "";
    document.getElementById("mcq-explanation-details").removeAttribute("open");
    openModal("card-mcq");
    document.getElementById("card-q-input").focus();
  }
}

function openEditCard(cardId) {
  state.editingCardId = cardId;
  store.getCards(state.currentLesson.id).then(function(cards) {
    var card = cards.find(function(c) { return c.id === cardId; });
    if (!card) return;
    if (card.format === "term-def") {
      document.getElementById("modal-card-termdef-title").textContent = "Edit Card";
      document.getElementById("card-term-input").value = card.data.term;
      document.getElementById("card-def-input").value  = card.data.def;
      renderLatex(card.data.term, document.getElementById("card-term-preview"));
      renderLatex(card.data.def,  document.getElementById("card-def-preview"));
      openModal("card-termdef");
    } else if (card.format === "true-false") {
      document.getElementById("modal-card-tf-title").textContent = "Edit Card";
      document.getElementById("card-tf-statement-input").value = card.data.statement;
      renderLatex(card.data.statement, document.getElementById("card-tf-statement-preview"));
      state.tfAnswer = card.data.correct;
      document.querySelectorAll(".tf-answer-btn").forEach(function(b) {
        b.classList.toggle("selected", b.dataset.value === card.data.correct);
      });
      document.getElementById("card-tf-explanation-input").value = card.data.explanation || "";
      if (card.data.explanation) document.getElementById("tf-explanation-details").setAttribute("open", "");
      else document.getElementById("tf-explanation-details").removeAttribute("open");
      openModal("card-tf");
    } else if (card.format === "image-def") {
      document.getElementById("modal-card-imagedef-title").textContent = "Edit Card";
      stagedImageUrl = card.data.imageUrl;
      var prevImg = document.getElementById("card-image-preview");
      prevImg.src = card.data.imageUrl;
      prevImg.classList.remove("hidden");
      document.getElementById("card-image-drop-label").classList.add("hidden");
      document.getElementById("card-imagedef-input").value = card.data.def;
      openModal("card-imagedef");
    } else {
      document.getElementById("modal-card-mcq-title").textContent = "Edit Card";
      document.getElementById("card-q-input").value      = card.data.question;
      document.getElementById("card-correct-input").value = card.data.correct;
      clearDistractorList(card.data.distractors);
      renderLatex(card.data.question, document.getElementById("card-q-preview"));
      renderLatex(card.data.correct,  document.getElementById("card-correct-preview"));
      document.getElementById("card-explanation-input").value = card.data.explanation || "";
      if (card.data.explanation) document.getElementById("mcq-explanation-details").setAttribute("open", "");
      else document.getElementById("mcq-explanation-details").removeAttribute("open");
      openModal("card-mcq");
    }
  });
}

document.getElementById("btn-save-card-termdef").addEventListener("click", function() {
  var term = document.getElementById("card-term-input").value.trim();
  var def  = document.getElementById("card-def-input").value.trim();
  if (!term || !def) { alert("Please fill in both term and definition."); return; }
  var data = { term: term, def: def };
  var p;
  if (state.editingCardId) {
    p = store.updateCard(state.editingCardId, state.currentLesson.id, { data: data });
  } else {
    p = store.createCard({ lessonId: state.currentLesson.id, format: "term-def", data: data });
  }
  p.then(function() { closeModal("card-termdef"); renderCards(); });
});

document.getElementById("btn-save-card-mcq").addEventListener("click", function() {
  var q = document.getElementById("card-q-input").value.trim();
  var c = document.getElementById("card-correct-input").value.trim();
  var distractors = Array.from(
    document.getElementById("mcq-distractor-list").querySelectorAll("input")
  ).map(function(i) { return i.value.trim(); }).filter(Boolean);
  if (!q || !c || distractors.length === 0 || distractors.length > 4) {
    alert("Please fill in the question, correct answer, and 1–4 wrong answers.");
    return;
  }
  var explanation = document.getElementById("card-explanation-input").value.trim();
  var data = { question: q, correct: c, distractors: distractors };
  if (explanation) data.explanation = explanation;
  var p;
  if (state.editingCardId) {
    p = store.updateCard(state.editingCardId, state.currentLesson.id, { data: data });
  } else {
    p = store.createCard({ lessonId: state.currentLesson.id, format: "mcq", data: data });
  }
  p.then(function() { closeModal("card-mcq"); renderCards(); });
});

document.getElementById("btn-add-card").addEventListener("click", openAddCard);
document.getElementById("btn-empty-add-card").addEventListener("click", openAddCard);

/* ============================
   TRUE/FALSE CARD MODAL
   ============================ */

document.getElementById("tf-answer-picker").addEventListener("click", function(e) {
  var btn = e.target.closest(".tf-answer-btn");
  if (!btn) return;
  document.querySelectorAll(".tf-answer-btn").forEach(function(b) { b.classList.remove("selected"); });
  btn.classList.add("selected");
  state.tfAnswer = btn.dataset.value;
});

document.getElementById("card-tf-statement-input").addEventListener("input", function() {
  renderLatex(this.value, document.getElementById("card-tf-statement-preview"));
});

document.getElementById("btn-save-card-tf").addEventListener("click", function() {
  var statement = document.getElementById("card-tf-statement-input").value.trim();
  if (!statement) { alert("Please enter a statement."); return; }
  if (!state.tfAnswer) { alert("Please select True or False."); return; }
  var explanation = document.getElementById("card-tf-explanation-input").value.trim();
  var data = { statement: statement, correct: state.tfAnswer };
  if (explanation) data.explanation = explanation;
  var p = state.editingCardId
    ? store.updateCard(state.editingCardId, state.currentLesson.id, { data: data })
    : store.createCard({ lessonId: state.currentLesson.id, format: "true-false", data: data });
  p.then(function() { closeModal("card-tf"); renderCards(); });
});

/* ============================
   IMAGE-DEF CARD MODAL
   ============================ */

var stagedImageUrl = null;
var uploadSeq = 0;

document.getElementById("btn-pick-image").addEventListener("click", function() {
  document.getElementById("card-image-input").click();
});

document.getElementById("card-image-drop").addEventListener("click", function(e) {
  if (e.target.tagName === "IMG") return;
  document.getElementById("card-image-input").click();
});

function handleImageFile(file) {
  if (!file) return;
  if (!IS_SERVER) { alert("Image upload requires server mode."); return; }
  var ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  if (ALLOWED.indexOf(file.type) === -1) {
    alert("Unsupported file type. Please use JPEG, PNG, GIF, or WebP.");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    alert("File exceeds 5 MB limit.");
    return;
  }
  var reader = new FileReader();
  reader.onload = function(ev) {
    var prev = document.getElementById("card-image-preview");
    prev.src = ev.target.result;
    prev.classList.remove("hidden");
    document.getElementById("card-image-drop-label").classList.add("hidden");
  };
  reader.readAsDataURL(file);
  var mySeq = ++uploadSeq;
  var previousUrl = stagedImageUrl;
  stagedImageUrl = null;
  var formData = new FormData();
  formData.append("image", file);
  fetch("/api/upload", { method: "POST", credentials: "same-origin", body: formData })
    .then(function(r) { return r.json().then(function(d) { if (!r.ok) throw new Error(d.error || "Upload failed"); return d; }); })
    .then(function(d) { if (uploadSeq === mySeq) stagedImageUrl = d.url; })
    .catch(function(err) { if (uploadSeq === mySeq) { alert("Upload failed: " + err.message); stagedImageUrl = previousUrl; } });
}

document.getElementById("card-image-input").addEventListener("change", function() {
  handleImageFile(this.files[0]);
});

var dropZone = document.getElementById("card-image-drop");
dropZone.addEventListener("dragover", function(e) { e.preventDefault(); this.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", function() { this.classList.remove("drag-over"); });
dropZone.addEventListener("drop", function(e) {
  e.preventDefault();
  this.classList.remove("drag-over");
  handleImageFile(e.dataTransfer.files[0]);
});

document.getElementById("btn-save-card-imagedef").addEventListener("click", function() {
  if (!stagedImageUrl) { alert("Please choose an image first."); return; }
  var def = document.getElementById("card-imagedef-input").value.trim();
  if (!def) { alert("Please enter a definition."); return; }
  var data = { imageUrl: stagedImageUrl, def: def };
  var p = state.editingCardId
    ? store.updateCard(state.editingCardId, state.currentLesson.id, { data: data })
    : store.createCard({ lessonId: state.currentLesson.id, format: "image-def", data: data });
  p.then(function() { closeModal("card-imagedef"); renderCards(); });
});

/* ============================
   BULK ADD MODAL
   ============================ */

var bulkTimer = null;
document.getElementById("bulk-input").addEventListener("input", function() {
  clearTimeout(bulkTimer);
  var val = this.value;
  var format = state.currentLesson ? state.currentLesson.format : "term-def";
  bulkTimer = setTimeout(function() { renderBulkPreview(val, format); }, 300);
});

function renderBulkPreview(raw, format) {
  var preview = document.getElementById("bulk-preview");
  var cards = format === "term-def" ? parseBulkTermDef(raw) : format === "true-false" ? parseBulkTF(raw) : parseBulkMCQ(raw);
  if (cards.length === 0) { preview.innerHTML = ""; return; }
  preview.innerHTML = '<div class="bulk-preview-count">' + cards.length + ' card' + (cards.length !== 1 ? 's' : '') + ' detected</div>';
  cards.slice(0, 5).forEach(function(card) {
    var item = document.createElement("div");
    item.className = "bulk-preview-item";
    var termEl = document.createElement("div");
    var defEl  = document.createElement("div");
    termEl.className = "bp-term";
    defEl.className  = "bp-def";
    if (format === "term-def") {
      renderLatex(card.data.term, termEl);
      renderLatex(card.data.def, defEl);
    } else if (format === "true-false") {
      renderLatex(card.data.statement, termEl);
      defEl.textContent = card.data.correct === "true" ? "✓ True" : "✓ False";
    } else {
      renderLatex(card.data.question, termEl);
      renderLatex("✓ " + card.data.correct, defEl);
    }
    item.appendChild(termEl);
    item.appendChild(defEl);
    preview.appendChild(item);
  });
  if (cards.length > 5) {
    var more = document.createElement("div");
    more.className = "bulk-preview-count";
    more.textContent = "... and " + (cards.length - 5) + " more";
    preview.appendChild(more);
  }
}

function openBulkAdd() {
  if (!state.currentLesson) return;
  var format = state.currentLesson.format;
  document.getElementById("modal-bulk-title").textContent = "Bulk Add Cards";
  document.getElementById("bulk-input").value = "";
  document.getElementById("bulk-preview").innerHTML = "";
  var errEl = document.getElementById("bulk-error");
  if (errEl) errEl.classList.add("hidden");
  var hint = format === "term-def"
    ? "One card per line: term | definition\nSupports LaTeX: $\\hat{\\beta}$ or $$\\sum_{i=1}^n x_i$$"
    : format === "true-false"
    ? "One card per line: statement | true  or  statement | false [;; explanation]"
    : "One card per line: question | correct | wrong1 [| wrong2 | wrong3 | wrong4]";
  document.getElementById("bulk-hint").textContent = hint;
  openModal("bulk");
  document.getElementById("bulk-input").focus();
}

document.getElementById("btn-bulk-add").addEventListener("click", openBulkAdd);

document.getElementById("btn-save-bulk").addEventListener("click", function() {
  var raw    = document.getElementById("bulk-input").value;
  var format = state.currentLesson ? state.currentLesson.format : "term-def";
  var cards  = format === "term-def" ? parseBulkTermDef(raw) : format === "true-false" ? parseBulkTF(raw) : parseBulkMCQ(raw);
  var errEl  = document.getElementById("bulk-error");
  if (cards.length === 0) {
    if (errEl) { errEl.textContent = "No valid cards found. Check the format."; errEl.classList.remove("hidden"); }
    return;
  }
  if (errEl) errEl.classList.add("hidden");
  var withLesson = cards.map(function(c) {
    return { lessonId: state.currentLesson.id, format: c.format, data: c.data };
  });
  store.createCards(withLesson).then(function() {
    closeModal("bulk");
    renderCards();
  });
});

/* ============================
   DELETE CONFIRM
   ============================ */

function confirmDelete(msg, cb) {
  document.getElementById("delete-confirm-text").textContent = msg;
  state.deleteCallback = cb;
  openModal("delete");
}

document.getElementById("btn-confirm-delete").addEventListener("click", function() {
  closeModal("delete");
  if (state.deleteCallback) { state.deleteCallback(); state.deleteCallback = null; }
});

/* ============================
   STUDY SETUP
   ============================ */

function openSetup(scope) {
  // Build a study scope. Default = the single currently-open lesson.
  state.studyScope = scope || {
    lessonIds: [state.currentLesson.id],
    lessons: [state.currentLesson],
    returnScreen: "lesson",
    title: state.currentLesson.title
  };

  // Reset pills to defaults
  setPillGroup("setup-count", "all");
  setPillGroup("setup-filter", "all");
  setPillGroup("setup-mode", "flashcard");

  // Show scope label when studying more than one lesson
  var scopeLabel = document.getElementById("setup-scope-label");
  if (state.studyScope.lessons.length > 1) {
    scopeLabel.textContent = "Studying " + state.studyScope.lessons.length + " lessons together";
    scopeLabel.classList.remove("hidden");
  } else {
    scopeLabel.classList.add("hidden");
  }

  // Show Interleaved pill only for multi-lesson sessions; always default to in-order
  var multiLesson = state.studyScope.lessons.length > 1;
  document.getElementById("pill-order-interleaved").style.display = multiLesson ? "" : "none";
  setPillGroup("setup-order", "in-order");

  showScreen("setup");
}

function setPillGroup(groupId, value) {
  var group = document.getElementById(groupId);
  group.querySelectorAll(".pill").forEach(function(p) {
    p.classList.toggle("active", p.dataset.value === value);
  });
}

// Pill group click handlers
var FILTER_HINTS = {
  all:      "Học tất cả thẻ",
  due:      "Chỉ thẻ đến hạn ôn tập (SRS)",
  learning: "Thẻ chưa thuộc / đang học",
  hard:     "Thẻ khó được ưu tiên đầu tiên"
};

["setup-count","setup-filter","setup-mode","setup-order"].forEach(function(groupId) {
  document.getElementById(groupId).addEventListener("click", function(e) {
    var pill = e.target.closest(".pill");
    if (!pill) return;
    this.querySelectorAll(".pill").forEach(function(p) { p.classList.remove("active"); });
    pill.classList.add("active");
    if (groupId === "setup-filter") {
      var hint = document.getElementById("setup-filter-hint");
      if (hint) hint.textContent = FILTER_HINTS[pill.dataset.value] || "";
    }
  });
});

// Return to wherever study was launched from (a lesson, or the class list for multi-lesson study)
function returnFromStudy() {
  var target = state.studyScope && state.studyScope.returnScreen ? state.studyScope.returnScreen : "lesson";
  showScreen(target);
  if (target === "home") renderHome();
  else renderLessons();
}

document.getElementById("btn-setup-back").addEventListener("click", function() {
  returnFromStudy();
});

document.getElementById("btn-start-study").addEventListener("click", function() {
  var count   = document.querySelector("#setup-count .pill.active").dataset.value;
  var filter  = document.querySelector("#setup-filter .pill.active").dataset.value;
  var mode    = document.querySelector("#setup-mode .pill.active").dataset.value;
  var orderEl = document.querySelector("#setup-order .pill.active");
  var order   = orderEl ? orderEl.dataset.value : "in-order";
  state.setupSnapshot = true;
  startStudy(count, filter, mode, order);
});

function getDifficultyWeight(stats) {
  if (stats.level === "hard")   return 3;
  if (stats.level === "medium") return 2;
  return 1;
}

function weightedShuffle(cards, statsMap) {
  var pool = [];
  cards.forEach(function(c) {
    var stats = statsMap[c.id] || { level: "new" };
    var w = getDifficultyWeight(stats);
    for (var i = 0; i < w; i++) pool.push(c);
  });
  pool = shuffle(pool);
  // Deduplicate while preserving weighted-front order
  var seen = {};
  var result = [];
  pool.forEach(function(c) {
    if (!seen[c.id]) { seen[c.id] = true; result.push(c); }
  });
  return result;
}

function startStudy(count, filter, mode, order) {
  var ids = state.studyScope ? state.studyScope.lessonIds : [state.currentLesson.id];
  store.getBulkCards(ids).then(function(cards) {
    // Rebuild per-lesson grouping for blocked mode
    var byLesson = {};
    cards.forEach(function(c) {
      if (!byLesson[c.lesson_id]) byLesson[c.lesson_id] = [];
      byLesson[c.lesson_id].push(c);
    });
    var cardArrays = ids.map(function(id) { return byLesson[id] || []; });

    var knownMap = {};
    cards.forEach(function(c) {
      if (c.known !== null && c.known !== undefined) knownMap[c.id] = c.known === 1 || c.known === true;
    });
    state.studyKnownMap = knownMap;

    // Build stats map for difficulty weighting
    store.getDifficultyMap(cards.map(function(c) { return c.id; })).then(function(statsMap) {
        state.studyStatsMap = statsMap;

        var filtered = cards;
        if (filter === "due") {
          var nowSec2 = Math.floor(Date.now() / 1000);
          filtered = cards.filter(function(c) { return c.srs_due_at && c.srs_due_at <= nowSec2; });
        } else if (filter === "learning") {
          filtered = cards.filter(function(c) { return knownMap[c.id] !== true; });
        } else if (filter === "hard") {
          var hard = cards.filter(function(c) {
            var s = statsMap[c.id];
            return !s || s.level === "hard" || s.level === "medium" || s.level === "new";
          });
          filtered = hard.length ? hard : cards;
        }

        if (order === "blocked") {
          // Shuffle within each lesson group, then concatenate
          var grouped = cardArrays.map(function(arr) {
            var g = arr.filter(function(c) { return filtered.some(function(f) { return f.id === c.id; }); });
            return weightedShuffle(g, statsMap);
          });
          filtered = grouped.reduce(function(acc, g) { return acc.concat(g); }, []);
          if (count !== "all") filtered = filtered.slice(0, parseInt(count, 10));
        } else if (order === "shuffle" || order === "interleaved") {
          if (count !== "all") {
            filtered = weightedShuffle(filtered, statsMap).slice(0, parseInt(count, 10));
          } else {
            filtered = weightedShuffle(filtered, statsMap);
          }
        } else {
          // "in-order": keep original DB order
          if (count !== "all") filtered = filtered.slice(0, parseInt(count, 10));
        }

        if (filtered.length === 0) {
          alert("No cards match the selected filter.");
          return;
        }

        state.studyMode = mode;

        // Record last_seen_at for all cards in this session (fire-and-forget)
        store.markCardsSeen(filtered.map(function(c) { return c.id; }));

        if (mode === "flashcard") {
          state.studyCards = filtered;
          state.studyIndex = 0;
          state.studyFlipped = false;
          startFlashcards();
        } else if (mode === "quiz") {
          state.quizCards  = filtered;
          state.quizIndex  = 0;
          state.quizScore  = 0;
          state.quizResults = [];
          startQuiz();
        }
      });
  });
}

/* ============================
   FLASHCARD STUDY
   ============================ */

function startFlashcards() {
  renderFlashcard();
  showScreen("flashcard");
}

function renderFlashcard() {
  var cards = state.studyCards;
  var i     = state.studyIndex;
  var card  = cards[i];
  if (!card) return;

  // Progress
  document.getElementById("fc-progress-text").textContent = (i + 1) + " / " + cards.length;
  document.getElementById("fc-progress-fill").style.width = ((i + 1) / cards.length * 100) + "%";

  // Lesson label (multi-lesson sessions)
  setStudyLessonLabel("fc-lesson-label", card);

  // Flip state
  state.studyFlipped = false;
  document.getElementById("fc-card").classList.remove("flipped");

  // Content
  var frontEl = document.getElementById("fc-front-content");
  var backEl  = document.getElementById("fc-back-content");
  var front, back;

  var frontAudioBtn = document.getElementById("btn-fc-audio-front");
  if (card.format === "term-def") {
    front = card.data.term;
    back  = card.data.def;
    state.studyFrontText = front || "";
    state.studyBackText  = back  || "";
    frontEl.innerHTML = "";
    renderLatex(front, frontEl);
    renderLatex(back,  backEl);
    frontAudioBtn.style.visibility = "";
  } else if (card.format === "true-false") {
    front = card.data.statement;
    back  = card.data.correct === "true" ? "True" : "False";
    state.studyFrontText = front || "";
    state.studyBackText  = back  || "";
    frontEl.innerHTML = "";
    renderLatex(front, frontEl);
    backEl.innerHTML = "";
    backEl.textContent = back;
    frontAudioBtn.style.visibility = "";
  } else if (card.format === "image-def") {
    state.studyFrontText = "";
    state.studyBackText  = card.data.def || "";
    frontEl.innerHTML = "";
    var fcImg = document.createElement("img");
    fcImg.src = card.data.imageUrl;
    fcImg.alt = "Card image";
    fcImg.style.maxWidth  = "100%";
    fcImg.style.maxHeight = "240px";
    fcImg.style.objectFit = "contain";
    frontEl.appendChild(fcImg);
    renderLatex(card.data.def, backEl);
    frontAudioBtn.style.visibility = "hidden";
  } else {
    front = card.data.question;
    back  = card.data.correct;
    state.studyFrontText = front || "";
    state.studyBackText  = back  || "";
    frontEl.innerHTML = "";
    renderLatex(front, frontEl);
    renderLatex(back,  backEl);
    frontAudioBtn.style.visibility = "";
  }

  var expContainer = document.getElementById("fc-explanation");
  expContainer.innerHTML = "";
  expContainer.classList.add("hidden");
  if ((card.format === "mcq" || card.format === "true-false") && card.data.explanation) {
    var expEl = document.createElement("details");
    expEl.className = "explanation-panel";
    expEl.open = true;
    var sum = document.createElement("summary");
    sum.textContent = "Explanation";
    var body = document.createElement("div");
    body.className = "explanation-body";
    renderLatex(card.data.explanation, body);
    expEl.appendChild(sum);
    expEl.appendChild(body);
    expContainer.appendChild(expEl);
  }

  // Difficulty badge
  var attempts = JSON.parse(localStorage.getItem("fc-attempts") || "[]")
    .filter(function(a) { return a.card_id === card.id; });
  document.getElementById("fc-diff-badge").outerHTML;
  var badge = document.getElementById("fc-diff-badge");
  var stats = computeStats(attempts);
  badge.className = "fc-difficulty-badge badge-" + (stats.total === 0 ? "new" : stats.level);
  badge.textContent = stats.total === 0 ? "New" :
    (stats.level.charAt(0).toUpperCase() + stats.level.slice(1)) + " · " + stats.correct + "/" + stats.total;

  // Dots
  renderFcDots();

  // Mark buttons reflect known state
  var known = state.studyKnownMap[card.id];
  document.getElementById("btn-fc-learning").classList.toggle("btn-danger-active", known === false);
  document.getElementById("btn-fc-known").classList.toggle("btn-success-active", known === true);

  // Prev/Next
  document.getElementById("btn-fc-prev").disabled = i === 0;
  document.getElementById("btn-fc-next").textContent = i === cards.length - 1 ? "Finish" : "Next →";
}

function renderFcDots() {
  var dots = document.getElementById("fc-dots");
  dots.innerHTML = "";
  var cards = state.studyCards;
  var max = Math.min(cards.length, 40); // limit visible dots
  for (var i = 0; i < max; i++) {
    var dot = document.createElement("div");
    dot.className = "fc-dot";
    if (i === state.studyIndex) dot.classList.add("active");
    var card = cards[i];
    var known = state.studyKnownMap[card.id];
    if (known === true)  dot.classList.add("known");
    if (known === false) dot.classList.add("learning");
    (function(idx) {
      dot.addEventListener("click", function() {
        state.studyIndex = idx;
        renderFlashcard();
      });
    })(i);
    dots.appendChild(dot);
  }
}

document.getElementById("fc-scene").addEventListener("click", function() {
  state.studyFlipped = !state.studyFlipped;
  document.getElementById("fc-card").classList.toggle("flipped", state.studyFlipped);
  var expContainer = document.getElementById("fc-explanation");
  expContainer.classList.toggle("hidden", !state.studyFlipped || expContainer.innerHTML === "");
});

document.getElementById("btn-fc-audio-front").addEventListener("click", function(e) {
  e.stopPropagation();
  speakText(state.studyFrontText);
});

document.getElementById("btn-fc-audio-back").addEventListener("click", function(e) {
  e.stopPropagation();
  speakText(state.studyBackText);
});

document.getElementById("btn-fc-prev").addEventListener("click", function() {
  if (state.studyIndex > 0) { state.studyIndex--; renderFlashcard(); }
});

document.getElementById("btn-fc-next").addEventListener("click", function() {
  if (state.studyIndex < state.studyCards.length - 1) {
    state.studyIndex++;
    renderFlashcard();
  } else {
    // Finished
    returnFromStudy();
  }
});

document.getElementById("btn-fc-shuffle").addEventListener("click", function() {
  state.studyCards = shuffle(state.studyCards);
  state.studyIndex = 0;
  renderFlashcard();
});

document.getElementById("btn-fc-reset").addEventListener("click", function() {
  state.studyIndex = 0;
  renderFlashcard();
});

document.getElementById("btn-fc-study-hard").addEventListener("click", function() {
  var allAttempts = JSON.parse(localStorage.getItem("fc-attempts") || "[]");
  var hard = state.studyCards.filter(function(c) {
    var cardAttempts = allAttempts.filter(function(a) { return a.card_id === c.id; });
    var stats = computeStats(cardAttempts);
    return stats.level === "hard" || stats.total === 0;
  });
  if (hard.length === 0) { alert("No hard/new cards in current set."); return; }
  state.studyCards = shuffle(hard);
  state.studyIndex = 0;
  renderFlashcard();
});

function markCard(known) {
  var card = state.studyCards[state.studyIndex];
  if (!card) return;
  state.studyKnownMap[card.id] = known;
  store.setCardKnown(card.id, known);
  store.recordAttempt({ cardId: card.id, correct: known, source: "flashcard" });
  renderFcDots();
  // Auto-advance after 400ms
  setTimeout(function() {
    if (state.studyIndex < state.studyCards.length - 1) {
      state.studyIndex++;
      renderFlashcard();
    }
  }, 400);
}

document.getElementById("btn-fc-learning").addEventListener("click", function() { markCard(false); });
document.getElementById("btn-fc-known").addEventListener("click", function()    { markCard(true);  });

document.getElementById("btn-fc-back").addEventListener("click", function() {
  returnFromStudy();
});


/* ============================
   QUIZ
   ============================ */

function startQuiz() {
  state.quizIndex  = 0;
  state.quizScore  = 0;
  state.quizResults = [];
  renderQuizCard();
  showScreen("quiz");
}

function buildQuizOptions(card) {
  if (card.format === "true-false") {
    return ["True", "False"];
  }
  if (card.format === "mcq") {
    return shuffle([card.data.correct].concat(card.data.distractors));
  }
  if (card.format === "image-def") {
    var correct = card.data.def;
    var pool = state.quizCards
      .filter(function(c) { return c.id !== card.id && c.format === "image-def"; })
      .map(function(c) { return c.data.def; });
    var distractors = shuffle(pool).slice(0, 3);
    while (distractors.length < 3) distractors.push("—");
    return shuffle([correct].concat(distractors));
  }
  // term-def: auto-generate distractors from other term-def cards in session
  var correct = card.data.def;
  var pool = state.quizCards
    .filter(function(c) { return c.id !== card.id && c.format === "term-def"; })
    .map(function(c) { return c.data.def; });
  var distractors = shuffle(pool).slice(0, 3);
  while (distractors.length < 3) distractors.push("—");
  return shuffle([correct].concat(distractors));
}

function renderQuizCard() {
  var cards = state.quizCards;
  var i     = state.quizIndex;
  var total = cards.length;

  var prevExp = document.getElementById("quiz-explanation");
  if (prevExp) prevExp.remove();
  var prevNext = document.getElementById("quiz-next-btn");
  if (prevNext) prevNext.remove();

  if (i >= total) { showQuizResults(); return; }

  var card = cards[i];
  document.getElementById("quiz-progress-text").textContent = (i + 1) + " / " + total;
  document.getElementById("quiz-progress-fill").style.width = ((i + 1) / total * 100) + "%";
  document.getElementById("quiz-score-display").textContent = state.quizScore + " / " + i;

  // Lesson label (multi-lesson sessions)
  setStudyLessonLabel("quiz-lesson-label", card);

  // Question
  var qEl = document.getElementById("quiz-question");
  qEl.innerHTML = "";
  if (card.format === "mcq") {
    renderLatex(card.data.question, qEl);
  } else if (card.format === "true-false") {
    renderLatex(card.data.statement, qEl);
  } else if (card.format === "image-def") {
    var qImg = document.createElement("img");
    qImg.src = card.data.imageUrl;
    qImg.alt = "Card image";
    qImg.style.maxWidth  = "100%";
    qImg.style.maxHeight = "200px";
    qImg.style.objectFit = "contain";
    qEl.appendChild(qImg);
  } else {
    renderLatex(card.data.term, qEl);
  }

  // Options
  var opts = buildQuizOptions(card);
  state.quizOptions = opts;
  state.quizAnswered = false;

  var optsEl = document.getElementById("quiz-options");
  optsEl.innerHTML = "";
  optsEl.classList.toggle("tf-mode", card.format === "true-false");
  opts.forEach(function(opt, idx) {
    var btn = document.createElement("button");
    btn.className = "quiz-opt";
    btn.innerHTML = '<span class="opt-num">' + (idx + 1) + '</span><span class="opt-text"></span>';
    var textEl = btn.querySelector(".opt-text");
    renderLatex(opt, textEl);
    btn.addEventListener("click", function() { answerQuiz(idx); });
    optsEl.appendChild(btn);
  });
}

function answerQuiz(selectedIdx) {
  if (state.quizAnswered) return;
  state.quizAnswered = true;

  var card    = state.quizCards[state.quizIndex];
  var opts    = state.quizOptions;
  var correct = card.format === "mcq" ? card.data.correct :
    card.format === "true-false" ? (card.data.correct === "true" ? "True" : "False") :
    card.format === "image-def" ? card.data.def :
    card.data.def;
  var selectedVal = opts[selectedIdx];
  var isCorrect   = selectedVal === correct;

  if (isCorrect) state.quizScore++;

  store.recordAttempt({ cardId: card.id, correct: isCorrect, source: "quiz" });

  // Save result
  state.quizResults.push({ card: card, correct: isCorrect, selected: selectedVal });

  // Visual feedback
  var optsEl = document.getElementById("quiz-options");
  var btns = optsEl.querySelectorAll(".quiz-opt");
  btns.forEach(function(btn, idx) {
    btn.disabled = true;
    if (opts[idx] === correct) {
      btn.classList.add("correct");
    } else if (idx === selectedIdx) {
      btn.classList.add("wrong");
    } else {
      btn.classList.add("dimmed");
    }
  });

  document.getElementById("quiz-score-display").textContent =
    state.quizScore + " / " + (state.quizIndex + 1);

  var advanceTimer = setTimeout(function() {
    state.quizIndex++;
    renderQuizCard();
  }, 1200);

  if ((card.format === "mcq" || card.format === "true-false") && card.data.explanation) {
    var expEl  = document.createElement("details");
    expEl.id   = "quiz-explanation";
    expEl.className = "explanation-panel";
    var sumEl  = document.createElement("summary");
    sumEl.textContent = "Explanation";
    var bodyEl = document.createElement("div");
    bodyEl.className = "explanation-body";
    renderLatex(card.data.explanation, bodyEl);
    expEl.appendChild(sumEl);
    expEl.appendChild(bodyEl);
    document.getElementById("quiz-options").after(expEl);

    expEl.addEventListener("toggle", function() {
      if (!expEl.open) return;
      clearTimeout(advanceTimer);
      if (document.getElementById("quiz-next-btn")) return;
      var nextBtn = document.createElement("button");
      nextBtn.id = "quiz-next-btn";
      nextBtn.className = "btn btn-primary btn-full";
      nextBtn.style.marginTop = "8px";
      nextBtn.textContent = "Next →";
      nextBtn.addEventListener("click", function() {
        state.quizIndex++;
        renderQuizCard();
      });
      expEl.after(nextBtn);
    });
  }
}


document.getElementById("btn-quiz-back").addEventListener("click", function() {
  returnFromStudy();
});

/* ============================
   QUIZ RESULTS
   ============================ */

function showQuizResults() {
  var score  = state.quizScore;
  var total  = state.quizCards.length;
  var pct    = total > 0 ? Math.round(score / total * 100) : 0;

  document.getElementById("results-pct").textContent = pct + "%";
  document.getElementById("results-detail").textContent =
    score + " correct out of " + total + " questions";

  var grade;
  if (pct >= 90) grade = "A";
  else if (pct >= 80) grade = "B";
  else if (pct >= 70) grade = "C";
  else if (pct >= 60) grade = "D";
  else grade = "F";
  document.getElementById("results-grade").textContent = grade;

  // Animate ring
  var circumference = 314;
  var offset = circumference - (pct / 100) * circumference;
  setTimeout(function() {
    document.getElementById("results-ring-fill").style.strokeDashoffset = offset;
  }, 100);

  // SRS schedules each card individually based on correct/wrong answers
  var reviewMsg = pct >= 80
    ? "Great job! Cards scheduled for spaced repetition."
    : pct >= 50
    ? "Cards scheduled — focus on the ones you missed."
    : "Keep practicing — missed cards are due again soon.";
  document.getElementById("results-review-hint").textContent = reviewMsg;

  // Save session so reminder badges update
  if (state.studyScope) {
    store.saveQuizSession(state.studyScope.lessonIds, score, total);
  }

  showScreen("results");
}

document.getElementById("btn-results-retry").addEventListener("click", function() {
  var snap = state.setupSnapshot;
  if (!snap) { returnFromStudy(); return; }
  state.quizCards  = shuffle(state.quizCards);
  state.quizIndex  = 0;
  state.quizScore  = 0;
  state.quizResults = [];
  startQuiz();
});

document.getElementById("btn-results-change").addEventListener("click", function() {
  openSetup(state.studyScope);
});

document.getElementById("btn-results-back").addEventListener("click", function() {
  returnFromStudy();
});

/* ============================
   STATS
   ============================ */

function openStats(type, id, title) {
  document.getElementById("stats-title").textContent = "Stats: " + title;
  // Reset tabs
  document.querySelectorAll(".tab").forEach(function(t) { t.classList.toggle("active", t.dataset.tab === "overview"); });
  document.querySelectorAll(".stats-panel").forEach(function(p) { p.classList.toggle("active", p.id === "stats-overview"); });

  renderStatsOverview(type, id);
  renderStatsHardest(type, id);
  renderStatsAll(type, id);
  showScreen("stats");
}

function renderStatsOverview(type, id) {
  var panel = document.getElementById("stats-overview");

  // In server mode use getLessonStats / getHardestCards for aggregated data
  var statsPromise;
  if (IS_SERVER) {
    var scope = { type: type, id: id };
    statsPromise = store.getHardestCards({ scope: scope, limit: 9999 }).then(function(items) {
      // getHardestCards only returns attempted cards; we still need total count
      var cardsP = type === "lesson"
        ? store.getCards(id)
        : store.getLessons(id).then(function(lessons) {
            return Promise.all(lessons.map(function(l) { return store.getCards(l.id); }))
              .then(function(all) { return all.reduce(function(a,c){return a.concat(c);},[]); });
          });
      return cardsP.then(function(cards) {
        return { cards: cards, statsItems: items };
      });
    });
  } else {
    statsPromise = (type === "lesson"
      ? store.getCards(id).then(function(cards) { return { cards: cards }; })
      : store.getLessons(id).then(function(lessons) {
          return Promise.all(lessons.map(function(l) { return store.getCards(l.id); }))
            .then(function(all) { return { cards: all.reduce(function(a,c){return a.concat(c);},[])}; });
        })
    ).then(function(r) { return Object.assign(r, { statsItems: null }); });
  }

  statsPromise.then(function(result) {
    var cards = result.cards;
    var statsItems = result.statsItems; // server: [{card, stats}], local: null

    var totalCards = cards.length;
    var attempted, totalAttempts, correctAttempts, accuracy, diffCounts;

    if (IS_SERVER && statsItems) {
      var statsMap = {};
      statsItems.forEach(function(x) { statsMap[x.card.id] = x.stats; });
      attempted = statsItems.length;
      totalAttempts  = statsItems.reduce(function(n,x){return n+x.stats.total;},0);
      correctAttempts = statsItems.reduce(function(n,x){return n+x.stats.correct;},0);
      accuracy = totalAttempts > 0 ? Math.round(correctAttempts/totalAttempts*100) : 0;
      diffCounts = { new: 0, easy: 0, medium: 0, hard: 0 };
      cards.forEach(function(c) {
        var s = statsMap[c.id] || { level: "new" };
        diffCounts[s.level]++;
      });
    } else {
      var allAttempts = JSON.parse(localStorage.getItem("fc-attempts") || "[]");
      var cardIds = new Set(cards.map(function(c) { return c.id; }));
      var attempts = allAttempts.filter(function(a) { return cardIds.has(a.card_id); });
      attempted       = new Set(attempts.map(function(a) { return a.card_id; })).size;
      totalAttempts   = attempts.length;
      correctAttempts = attempts.filter(function(a) { return a.correct === 1; }).length;
      accuracy = totalAttempts > 0 ? Math.round(correctAttempts/totalAttempts*100) : 0;
      diffCounts = { new: 0, easy: 0, medium: 0, hard: 0 };
      cards.forEach(function(c) {
        var ca = attempts.filter(function(a) { return a.card_id === c.id; });
        var s = computeStats(ca);
        diffCounts[s.level]++;
      });
    }

    panel.innerHTML =
      '<div class="stats-overview-grid">' +
        statCard(totalCards, "Total Cards") +
        statCard(attempted, "Attempted") +
        statCard(accuracy + "%", "Accuracy") +
        statCard(totalAttempts, "Total Attempts") +
      '</div>' +
      '<div class="diff-bar-label">Difficulty Breakdown</div>' +
      diffBar("New", diffCounts.new, totalCards, "#9ca3af") +
      diffBar("Easy", diffCounts.easy, totalCards, "#16a34a") +
      diffBar("Medium", diffCounts.medium, totalCards, "#d97706") +
      diffBar("Hard", diffCounts.hard, totalCards, "#dc2626");
  });
}

function statCard(val, label) {
  return '<div class="stat-card"><div class="stat-value">' + val + '</div><div class="stat-label">' + label + '</div></div>';
}

function diffBar(name, count, total, color) {
  var pct = total > 0 ? (count / total * 100) : 0;
  return '<div class="diff-bar-row">' +
    '<span class="diff-bar-name">' + name + '</span>' +
    '<div class="diff-bar-track"><div class="diff-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
    '<span class="diff-bar-count">' + count + '</span>' +
  '</div>';
}

function renderStatsHardest(type, id) {
  var panel = document.getElementById("stats-hardest");
  var scope = { type: type, id: id };
  store.getHardestCards({ scope: scope, limit: 30 }).then(function(items) {
    if (items.length === 0) {
      panel.innerHTML = '<div class="empty-state"><p>No attempted cards yet.</p></div>';
      return;
    }
    panel.innerHTML = "";
    items.forEach(function(item) { panel.appendChild(buildStatsCardEl(item.card, item.stats)); });
  });
}

function renderStatsAll(type, id) {
  var panel = document.getElementById("stats-all");

  if (IS_SERVER) {
    // In server mode, getHardestCards returns ALL attempted cards sorted by difficulty
    store.getHardestCards({ scope: { type: type, id: id }, limit: 9999 }).then(function(items) {
      if (items.length === 0) {
        panel.innerHTML = '<div class="empty-state"><p>No attempted cards yet.</p></div>';
        return;
      }
      panel.innerHTML = "";
      items.forEach(function(item) { panel.appendChild(buildStatsCardEl(item.card, item.stats)); });
    });
    return;
  }

  var cardsPromise = type === "lesson"
    ? store.getCards(id)
    : store.getLessons(id).then(function(lessons) {
        return Promise.all(lessons.map(function(l) { return store.getCards(l.id); }))
          .then(function(all) { return all.reduce(function(a,c){return a.concat(c);},[]); });
      });

  var allAttempts = JSON.parse(localStorage.getItem("fc-attempts") || "[]");
  cardsPromise.then(function(cards) {
    var attempted = cards.filter(function(c) {
      return allAttempts.some(function(a) { return a.card_id === c.id; });
    });
    if (attempted.length === 0) {
      panel.innerHTML = '<div class="empty-state"><p>No attempted cards yet.</p></div>';
      return;
    }
    panel.innerHTML = "";
    attempted.forEach(function(card) {
      var ca = allAttempts.filter(function(a) { return a.card_id === card.id; });
      var stats = computeStats(ca);
      panel.appendChild(buildStatsCardEl(card, stats));
    });
  });
}

function buildStatsCardEl(card, stats) {
  var item = document.createElement("div");
  item.className = "stats-card-item";
  var qEl = document.createElement("div");
  var aEl = document.createElement("div");
  qEl.className = "stats-card-q";
  aEl.className = "stats-card-a";
  if (card.format === "term-def") {
    renderLatex(card.data.term, qEl);
    renderLatex(card.data.def,  aEl);
  } else if (card.format === "true-false") {
    renderLatex(card.data.statement, qEl);
    aEl.textContent = card.data.correct === "true" ? "True" : "False";
  } else if (card.format === "image-def") {
    qEl.textContent = "[image]";
    renderLatex(card.data.def, aEl);
  } else {
    renderLatex(card.data.question, qEl);
    renderLatex(card.data.correct,  aEl);
  }
  var header = document.createElement("div");
  header.className = "stats-card-header";
  header.appendChild(qEl);
  var pill = document.createElement("span");
  pill.className = "diff-pill " + stats.level;
  pill.textContent = stats.level.charAt(0).toUpperCase() + stats.level.slice(1);
  header.appendChild(pill);
  item.appendChild(header);
  item.appendChild(aEl);
  var acc = document.createElement("div");
  acc.className = "stats-accuracy";
  acc.textContent = stats.correct + " / " + stats.total + " correct (" +
    (stats.total > 0 ? Math.round(stats.correct / stats.total * 100) : 0) + "%)";
  item.appendChild(acc);
  return item;
}

// Stats tab switching
document.querySelectorAll(".tab").forEach(function(tab) {
  tab.addEventListener("click", function() {
    var tabName = this.dataset.tab;
    document.querySelectorAll(".tab").forEach(function(t) { t.classList.remove("active"); });
    document.querySelectorAll(".stats-panel").forEach(function(p) { p.classList.remove("active"); });
    this.classList.add("active");
    document.getElementById("stats-" + tabName).classList.add("active");
  });
});

document.getElementById("btn-stats-back").addEventListener("click", function() {
  // Go back to wherever we came from — check which screen makes sense
  if (state.currentLesson) {
    showScreen("lesson");
  } else if (state.currentClass) {
    showScreen("class");
  } else {
    showScreen("home");
  }
});

/* ============================
   DASHBOARD
   ============================ */

function openDueReview(lessonId, classId) {
  store.getClass(classId).then(function(cls) {
    if (!cls) return;
    state.currentClass = cls;
    store.getLessons(classId).then(function(lessons) {
      state.currentClassLessons = lessons;
      var lesson = lessons.find(function(l) { return l.id === lessonId; });
      if (!lesson) return;
      state.currentLesson = lesson;
      document.getElementById("lesson-detail-title").textContent = lesson.title;
      store.getCards(lessonId).then(function(cards) {
        state.currentLessonCards = cards;
        var nowSec = Math.floor(Date.now() / 1000);
        var dueCards = cards.filter(function(c) { return c.srs_due_at && c.srs_due_at <= nowSec; });
        if (!dueCards.length) { renderCards(); showScreen("lesson"); return; }
        state.studyScope = {
          lessonIds: [lessonId],
          lessons: [lesson],
          returnScreen: "lesson",
          title: lesson.title
        };
        state.studyMode = "quiz";
        state.quizCards  = shuffle(dueCards);
        state.quizIndex  = 0;
        state.quizScore  = 0;
        state.quizResults = [];
        store.markCardsSeen(dueCards.map(function(c) { return c.id; }));
        startQuiz();
      });
    });
  });
}

function renderDashboard() {
  var loadEl  = document.getElementById("dash-loading");
  var errEl   = document.getElementById("dash-error");
  loadEl.classList.remove("hidden");
  errEl.classList.add("hidden");
  var exportBtn = document.getElementById("btn-dashboard-export");
  if (exportBtn) exportBtn.disabled = true;
  ["dash-summary-grid","dash-accuracy-wrap","dash-diff-breakdown",
   "dash-heatmap-wrap","dash-trend-wrap","dash-srs-wrap","dash-lesson-wrap",
   "dash-due-list","dash-struggle-list"].forEach(function(id) {
    document.getElementById(id).innerHTML = "";
  });

  Promise.all([store.getDashboard(), store.getAnalytics(state.dashPeriod), store.getSrsDistribution()]).then(function(results) {
    var d = results[0], analytics = results[1], srs = results[2];
    var days = analytics.days || state.dashPeriod || 60;
    var heatmapTitle = document.getElementById("dash-heatmap-title");
    if (heatmapTitle) heatmapTitle.textContent = days + "-Day Study Heatmap";
    loadEl.classList.add("hidden");

    // Summary stat cards with streak first
    var summaryGrid = document.getElementById("dash-summary-grid");
    summaryGrid.innerHTML = statCard("🔥 " + d.streak, d.streak === 1 ? "Day Streak" : "Days Streak");
    [
      [d.summary.classes,      "Classes"],
      [d.summary.lessons,      "Lessons"],
      [d.summary.cards,        "Cards"],
      [d.summary.quizSessions, "Sessions"],
      [d.summary.attempts,     "Attempts"]
    ].forEach(function(item) { summaryGrid.innerHTML += statCard(item[0], item[1]); });

    // Accuracy bar
    var accPct = d.accuracy.total > 0
      ? Math.round(d.accuracy.correct / d.accuracy.total * 100) : 0;
    document.getElementById("dash-accuracy-wrap").innerHTML =
      '<div class="dash-accuracy-label">' + accPct + '% — ' +
        d.accuracy.correct + ' / ' + d.accuracy.total + ' correct</div>' +
      '<div class="dash-accuracy-bar">' +
        '<div class="dash-accuracy-fill" style="width:' + accPct + '%"></div>' +
      '</div>';

    // Difficulty breakdown
    var db_ = d.diffBreakdown;
    var totalCards = db_.new + db_.easy + db_.medium + db_.hard;
    document.getElementById("dash-diff-breakdown").innerHTML =
      diffBar("New",    db_.new,    totalCards, "#9ca3af") +
      diffBar("Easy",   db_.easy,   totalCards, "#16a34a") +
      diffBar("Medium", db_.medium, totalCards, "#d97706") +
      diffBar("Hard",   db_.hard,   totalCards, "#dc2626");

    // Charts (from analytics)
    renderHeatmap(analytics.heatmap, document.getElementById("dash-heatmap-wrap"), days);
    renderWeeklyTrend(analytics.weeklyTrend, document.getElementById("dash-trend-wrap"), Math.ceil(days / 7));
    renderSrsDistribution(srs, document.getElementById("dash-srs-wrap"));
    renderLessonBreakdown(analytics.lessonBreakdown, document.getElementById("dash-lesson-wrap"));

    // Enable export if there's data
    var totalAttempts = (analytics.lessonBreakdown || []).reduce(function(sum, l) { return sum + (l.total_attempts || 0); }, 0);
    if (exportBtn) exportBtn.disabled = totalAttempts === 0;

    // Due for review
    var dueList = document.getElementById("dash-due-list");
    var dueBadge = document.getElementById("dash-due-badge");
    var totalDueCards = (d.dueForReview || []).reduce(function(acc, l) { return acc + (l.dueCount || 0); }, 0);
    dueBadge.textContent = totalDueCards || "";
    dueList.innerHTML = "";
    if (!(d.dueForReview || []).length) {
      dueList.innerHTML = '<div class="dash-empty-note">All caught up — no cards due.</div>';
    } else {
      var byClass = {};
      var classOrder = [];
      d.dueForReview.forEach(function(l) {
        if (!byClass[l.class_id]) {
          byClass[l.class_id] = { class_name: l.class_name, lessons: [], total: 0 };
          classOrder.push(l.class_id);
        }
        byClass[l.class_id].lessons.push(l);
        byClass[l.class_id].total += (l.dueCount || 0);
      });
      classOrder.forEach(function(cid) {
        var group = byClass[cid];
        var header = document.createElement("div");
        header.className = "dash-class-due-header";
        header.innerHTML =
          '<span class="dash-class-due-name">' + escHtml(group.class_name) + '</span>' +
          '<span class="due-badge">' + group.total + ' due</span>';
        dueList.appendChild(header);
        group.lessons.forEach(function(l) {
          var row = document.createElement("div");
          row.className = "dash-lesson-row dash-lesson-clickable dash-lesson-sub";
          row.innerHTML =
            '<span class="dash-lesson-title">' + escHtml(l.title) + '</span>' +
            '<span class="due-badge">' + l.dueCount + ' due</span>';
          row.addEventListener("click", function() { openDueReview(l.id, l.class_id); });
          dueList.appendChild(row);
        });
      });
    }

    // Struggling lessons
    var strugList = document.getElementById("dash-struggle-list");
    var strugBadge = document.getElementById("dash-struggle-badge");
    strugBadge.textContent = d.strugglingLessons.length || "";
    if (!d.strugglingLessons.length) {
      strugList.innerHTML = '<div class="dash-empty-note">No struggling lessons — great work!</div>';
    } else {
      strugList.innerHTML = d.strugglingLessons.map(function(l) {
        return dashLessonRow(l, "struggle");
      }).join("");
    }

  }).catch(function() {
    loadEl.classList.add("hidden");
    errEl.classList.remove("hidden");
  });
}

function dashLessonRow(lesson, type) {
  var badge = type === "struggle"
    ? '<span class="diff-pill hard">' + Math.round(lesson.hardRatio * 100) + '% hard</span>'
    : '<span class="due-badge">Due</span>';
  return '<div class="dash-lesson-row">' +
    '<div class="dash-lesson-info">' +
      '<span class="dash-lesson-title">' + escHtml(lesson.title) + '</span>' +
      '<span class="dash-lesson-class">' + escHtml(lesson.class_name) + '</span>' +
    '</div>' + badge + '</div>';
}

document.getElementById("btn-dashboard").addEventListener("click", function() {
  renderDashboard();
  showScreen("dashboard");
});
document.getElementById("btn-dashboard-inline").addEventListener("click", function() {
  renderDashboard();
  showScreen("dashboard");
});

document.getElementById("btn-dashboard-back").addEventListener("click", function() {
  showScreen("home");
});

(function initDashPeriodPills() {
  var bar = document.getElementById("dash-period-bar");
  if (!bar) return;
  function updatePills() {
    bar.querySelectorAll(".pill").forEach(function(btn) {
      btn.classList.toggle("active", parseInt(btn.dataset.period, 10) === state.dashPeriod);
    });
  }
  updatePills();
  bar.addEventListener("click", function(e) {
    var btn = e.target.closest(".pill");
    if (!btn) return;
    state.dashPeriod = parseInt(btn.dataset.period, 10);
    try { localStorage.setItem("fc-dash-period", state.dashPeriod); } catch (_) {}
    updatePills();
    document.getElementById("dash-heatmap-wrap").innerHTML = "";
    document.getElementById("dash-trend-wrap").innerHTML = "";
    document.getElementById("dash-lesson-wrap").innerHTML = "";
    store.getAnalytics(state.dashPeriod).then(function(analytics) {
      var days = analytics.days || state.dashPeriod;
      var heatmapTitle = document.getElementById("dash-heatmap-title");
      if (heatmapTitle) heatmapTitle.textContent = days + "-Day Study Heatmap";
      renderHeatmap(analytics.heatmap, document.getElementById("dash-heatmap-wrap"), days);
      renderWeeklyTrend(analytics.weeklyTrend, document.getElementById("dash-trend-wrap"), Math.ceil(days / 7));
      renderLessonBreakdown(analytics.lessonBreakdown, document.getElementById("dash-lesson-wrap"));
    });
  });
}());

function renderHeatmap(rows, wrap, days) {
  if (!days) days = 60;
  var map = {};
  rows.forEach(function(r) { map[r.day] = r.cnt; });

  var today = new Date();
  var cells = [];
  for (var i = days - 1; i >= 0; i--) {
    // Use UTC date arithmetic to match server's date(created_at,'unixepoch') which returns UTC dates
    var d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    var key = d.toISOString().slice(0, 10);
    cells.push({ key: key, cnt: map[key] || 0, month: d.getUTCMonth(), dayOfWeek: d.getUTCDay() });
  }

  var maxCnt = rows.reduce(function(m, r) { return Math.max(m, r.cnt); }, 1);
  function intensity(cnt) {
    if (cnt === 0) return "heat-0";
    if (cnt <= maxCnt * 0.25) return "heat-1";
    if (cnt <= maxCnt * 0.60) return "heat-2";
    return "heat-3";
  }

  var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var firstDay = cells[0].dayOfWeek;
  var padded = [];
  for (var p = 0; p < firstDay; p++) padded.push(null);
  padded = padded.concat(cells);
  while (padded.length % 7 !== 0) padded.push(null);

  var numCols = padded.length / 7;
  var labelRow = document.createElement("div");
  labelRow.className = "heatmap-months";
  var grid = document.createElement("div");
  grid.className = "heatmap-grid";
  var lastMonthLabel = null;

  for (var col = 0; col < numCols; col++) {
    var colEl = document.createElement("div");
    colEl.className = "heatmap-col";
    var firstRealCell = null;
    for (var row = 0; row < 7; row++) {
      var cell = padded[col * 7 + row];
      var cellEl = document.createElement("div");
      if (!cell) {
        cellEl.className = "heatmap-cell heat-empty";
      } else {
        cellEl.className = "heatmap-cell " + intensity(cell.cnt);
        cellEl.title = cell.key + ": " + cell.cnt + " attempt" + (cell.cnt !== 1 ? "s" : "");
        if (!firstRealCell) firstRealCell = cell;
      }
      colEl.appendChild(cellEl);
    }
    grid.appendChild(colEl);

    var monthLabel = document.createElement("span");
    monthLabel.className = "heatmap-month-label";
    if (firstRealCell && firstRealCell.month !== lastMonthLabel) {
      monthLabel.textContent = MONTHS[firstRealCell.month];
      lastMonthLabel = firstRealCell.month;
    }
    labelRow.appendChild(monthLabel);
  }

  wrap.appendChild(labelRow);
  wrap.appendChild(grid);
}

function renderWeeklyTrend(rows, wrap, maxWeeksAgo) {
  if (maxWeeksAgo === undefined) maxWeeksAgo = 11;
  var map = {};
  rows.forEach(function(r) { map[r.weeks_ago] = r.cnt; });

  var max = 0;
  var weeks = [];
  for (var w = maxWeeksAgo; w >= 0; w--) {
    var cnt = map[w] || 0;
    if (cnt > max) max = cnt;
    weeks.push({ weeksAgo: w, cnt: cnt });
  }

  weeks.forEach(function(week) {
    var pct = max > 0 ? Math.round(week.cnt / max * 100) : 0;
    var label = week.weeksAgo === 0 ? "This week" :
                week.weeksAgo === 1 ? "Last week" :
                week.weeksAgo + "w ago";
    var rowEl = document.createElement("div");
    rowEl.className = "trend-row";
    rowEl.innerHTML =
      '<span class="trend-label">' + escHtml(label) + '</span>' +
      '<div class="trend-bar-track"><div class="trend-bar-fill" style="width:' + pct + '%"></div></div>' +
      '<span class="trend-count">' + week.cnt + '</span>';
    wrap.appendChild(rowEl);
  });
}

var SRS_STEP_LABELS = ["10m","1h","4h","1d","3d","7d","21d","42d","84d","168d","336d","1yr"];
function stepLabel(step) {
  return SRS_STEP_LABELS[Math.min(step, SRS_STEP_LABELS.length - 1)];
}

function renderSrsDistribution(rows, wrap) {
  if (!rows || !rows.length) {
    wrap.innerHTML = '<div class="dash-empty-note">No cards in SRS yet.</div>';
    return;
  }
  var max = rows.reduce(function(m, r) { return Math.max(m, r.cnt); }, 1);
  var total = rows.reduce(function(s, r) { return s + r.cnt; }, 0);
  rows.forEach(function(r) {
    var pct = Math.round(r.cnt / max * 100);
    var rowEl = document.createElement("div");
    rowEl.className = "trend-row";
    rowEl.innerHTML =
      '<span class="trend-label">' + escHtml(stepLabel(r.srs_step)) + '</span>' +
      '<div class="trend-bar-track"><div class="trend-bar-fill srs-bar-fill" style="width:' + pct + '%"></div></div>' +
      '<span class="trend-count">' + r.cnt + '</span>';
    wrap.appendChild(rowEl);
  });
  var note = document.createElement("div");
  note.className = "srs-total-note";
  note.textContent = total + ' card' + (total !== 1 ? 's' : '') + ' in SRS';
  wrap.appendChild(note);
}

function renderLessonBreakdown(rows, wrap) {
  wrap = wrap || document.getElementById("dash-lesson-wrap");
  if (!rows || !rows.length) {
    wrap.innerHTML = '<div class="dash-empty-note">No study data yet.</div>';
    return;
  }
  rows.forEach(function(lesson) {
    var accuracy = lesson.total_attempts > 0
      ? Math.round(lesson.correct_attempts / lesson.total_attempts * 100)
      : 0;
    var accClass = accuracy >= 70 ? "acc-good" : accuracy >= 40 ? "acc-mid" : "acc-bad";
    var barColor = accuracy >= 70 ? "#16a34a" : accuracy >= 40 ? "#d97706" : "#dc2626";
    var rowEl = document.createElement("div");
    rowEl.className = "analytics-lesson-row";
    rowEl.innerHTML =
      '<div class="analytics-lesson-info">' +
        '<span class="analytics-lesson-title">' + escHtml(lesson.title) + '</span>' +
        '<span class="analytics-lesson-class">' + escHtml(lesson.class_name) + '</span>' +
      '</div>' +
      '<div class="analytics-lesson-stats">' +
        '<span class="analytics-lesson-accuracy ' + accClass + '">' + accuracy + '%</span>' +
        '<div class="analytics-retention-bar">' +
          '<div class="analytics-retention-fill" style="width:' + accuracy + '%;background:' + barColor + '"></div>' +
        '</div>' +
        '<span class="analytics-lesson-attempts">' + lesson.total_attempts + ' att.</span>' +
      '</div>';
    rowEl.addEventListener("click", function() {
      openStats("lesson", lesson.id, lesson.title);
    });
    wrap.appendChild(rowEl);
  });
}

document.getElementById("btn-analytics").addEventListener("click", function() {
  renderDashboard(); showScreen("dashboard");
});
document.getElementById("btn-analytics-inline").addEventListener("click", function() {
  renderDashboard(); showScreen("dashboard");
});

document.getElementById("btn-dashboard-export").addEventListener("click", function() {
  window.location.href = "/api/stats/analytics/export";
});

/* ============================
   BULK LESSON + CARD IMPORT
   ============================ */

function parseBulkImport(raw) {
  var sections = [];
  var current = null;
  raw.split("\n").forEach(function(line) {
    var trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("#")) {
      var header = trimmed.slice(1).trim();
      var parts = header.split("|");
      var title  = parts[0].trim();
      var format = (parts[1] || "").trim().toLowerCase();
      if (format !== "mcq" && format !== "true-false") format = "term-def";
      current = { title: title, format: format, lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(trimmed);
    }
  });
  return sections.map(function(s) {
    var cards = s.format === "term-def"
      ? parseBulkTermDef(s.lines.join("\n"))
      : s.format === "true-false"
      ? parseBulkTF(s.lines.join("\n"))
      : parseBulkMCQ(s.lines.join("\n"));
    return { title: s.title, format: s.format, cards: cards };
  }).filter(function(s) { return s.title; });
}

function renderBulkImportPreview(raw) {
  var preview = document.getElementById("bulk-import-preview");
  preview.innerHTML = "";
  var sections = parseBulkImport(raw);
  if (sections.length === 0) return;

  sections.forEach(function(section) {
    var block = document.createElement("div");
    block.className = "bi-lesson-block";

    var header = document.createElement("div");
    header.className = "bi-lesson-header";
    var badge = '<span class="format-badge ' + section.format + '" style="margin-left:6px">' +
      (section.format === "term-def" ? "Thẻ học" : section.format === "true-false" ? "True/False" : "MCQ") + '</span>';
    header.innerHTML = escHtml(section.title) + badge +
      '<span class="bi-lesson-count">' + section.cards.length + ' card' +
      (section.cards.length !== 1 ? 's' : '') + '</span>';
    block.appendChild(header);

    // Show up to 3 card rows as preview
    section.cards.slice(0, 3).forEach(function(card) {
      var row = document.createElement("div");
      row.className = "bi-card-row";
      var termEl = document.createElement("span");
      termEl.className = "bi-card-term";
      if (card.format === "term-def") {
        renderLatex(card.data.term, termEl);
      } else if (card.format === "true-false") {
        renderLatex(card.data.statement, termEl);
      } else {
        renderLatex(card.data.question, termEl);
      }
      row.appendChild(termEl);
      block.appendChild(row);
    });
    if (section.cards.length > 3) {
      var more = document.createElement("div");
      more.className = "bi-card-row";
      more.textContent = "... and " + (section.cards.length - 3) + " more";
      block.appendChild(more);
    }
    preview.appendChild(block);
  });

  var total = sections.reduce(function(n, s) { return n + s.cards.length; }, 0);
  var summary = document.createElement("div");
  summary.className = "bulk-preview-count";
  summary.textContent = sections.length + " lesson" + (sections.length !== 1 ? "s" : "") +
    ", " + total + " card" + (total !== 1 ? "s" : "") + " total";
  preview.insertBefore(summary, preview.firstChild);
}

var bulkImportTimer = null;
document.getElementById("bulk-import-input").addEventListener("input", function() {
  clearTimeout(bulkImportTimer);
  var val = this.value;
  bulkImportTimer = setTimeout(function() { renderBulkImportPreview(val); }, 300);
});

const AI_EXTRACTION_PROMPT = `You are a knowledge extraction assistant. Your job is to convert source material into a spaced-repetition flashcard set — not a highlights reel.

## Step 0 — Classify the content type (do this before anything else)

Read the text and decide which type it is:

**Type A — Expository** (textbook, non-fiction, science, business framework, how-to, essay)
Content is declarative: facts, definitions, mechanisms, frameworks, processes.
→ Apply all rules below as written.

**Type B — Narrative / Memoir** (autobiography, memoir, biography, narrative non-fiction, personal essay)
Content is story-driven: events, decisions, turning points, personal lessons, quotes.
→ Apply modified rules:
- **Do card:** lessons/principles a story illustrates; key decisions and the reasoning behind them; quotes that encode a transferable idea; turning points that reveal strategy or character
- **Do not card:** dates, names, places, or plot details that carry no transferable lesson
- Stem format: "What principle does [brief story context] illustrate?" / "What did [author] learn from [event]?" / "When should you [action], according to [author]'s experience?"
- Target roughly 1 card per major story or lesson — not per 50–80 words
- All other rules (generalizability, output format, card writing, final audit) still apply

---

## Generalizability rule (apply to every card)

Every card must test a concept that transfers beyond this specific text. Before writing each card, ask: "Would this be a useful card if the student never saw the source text again?" If the answer is no, reframe or skip it.

**Do not card:**
- Specific examples, illustrations, or analogies used to explain a concept (card the concept itself)
- Names, numbers, or details whose only role in the source is to exemplify something
- One-off sentences that are examples of a rule already being carded
- Trivia that only makes sense in context (e.g., "In the passage, what did the author call X?")

**Do card:**
- Definitions, mechanisms, formulas, and principles that apply generally
- Distinctions and comparisons between concepts
- Conditions under which a concept applies or fails
- Step-by-step processes and their purpose

## Two-pass process (do this internally before writing output)

**Pass 1 — Inventory every concept:**
Read the full text and list every named concept, term, mechanism, formula, condition, step, and comparison. For each item, ask whether it is a general principle or a text-specific example. Mark examples — they may inform the card but should not be the card.

**Pass 2 — Card per concept:**
Write at least one card for every general concept on your list. If a concept needs two angles (definition + application), write two cards. Do not merge distinct concepts into one card. Do not write cards that test text-specific examples.

## Output format

Output ONLY raw import text — no explanation, no markdown fences, no commentary.
Every line is either a lesson header or a card:

- Header: \`# Lesson Title | mcq\`
- Card: \`question | correct | wrong1 [| wrong2 | wrong3 | wrong4] [;; explanation]\`

Additional formatting rules:

- Use \`$...$\` for inline math and \`$$...$$\` for display math (LaTeX).
- Write \`$\\lvert x \\rvert$\` instead of \`$|x|$\` to avoid breaking the delimiter.

## Coverage rules

- Every key term, formula, named concept, mechanism, and numbered/named step in the source must appear in at least one card — as a general principle, not as a text example.
- Every section or subsection heading represents a concept cluster — all concepts within it need cards.
- If a concept cannot support a plausible distractor, reframe the question stem — do not skip it.
- Target density: roughly 1 card per 50–80 words of source text. Dense technical material warrants more.

## Lesson organization

- One lesson per major topic or concept cluster; split when a cluster exceeds ~25 cards.
- Name split lessons to reflect progression: "Topic — Foundations", "Topic — Methods", "Topic — Application".
- No two cards in the same lesson test the exact same fact from the same angle.

## Card order (progressive learning)

Order cards within each lesson basic to advanced:

- Tier 1 (~30%): definitions and vocabulary — "What is X?" / "Which best describes X?"
- Tier 2 (~40%): relationships, comparisons, cause-and-effect — "How does X differ from Y?" / "What happens when X?"
- Tier 3 (~30%): application and edge cases — "Under which condition does X apply?" / "What does X indicate?"

## Card writing rules

- One concept per card, written at recall level.
- Use specific stems; avoid "Which of the following is true about X?"
- Avoid grammatical clues in the stem that hint at the correct answer.
- Avoid negation in the correct answer; test what something is, not what it isn't.
- For formulas, ask "Which formula represents X?" with all options as formulas.
- Distractors must be plausible, grammatically parallel, and drawn from concepts in the source text.
- Keep options comparable in length — avoid options so much shorter or longer that length itself signals the answer. Natural phrasing takes priority over exact word-count matching.
- Each distractor must be wrong for a different reason.
- Include 2–4 distractors (3–5 total options). Use fewer only when fewer plausible ones exist.
- Avoid "all of the above" and "none of the above".
- After all options, add \`;;\` followed by a 1–2 sentence explanation of why the correct answer is right and why key distractors are wrong. Keep explanations concise.

## Final audit (before writing output)

Review your Pass 1 inventory. For each card you've written, confirm it tests a transferable concept rather than a text-specific detail. Replace any example-specific card with a card on the underlying principle. Only then write the output.

---

Now extract a comprehensive flashcard set from the following text:

[PASTE YOUR TEXT HERE]`;

document.getElementById("prompt-guide-text").textContent = AI_EXTRACTION_PROMPT;

document.getElementById("btn-prompt-guide").addEventListener("click", function() {
  document.querySelector("#modal-prompt-guide .modal").classList.remove("hidden");
  document.getElementById("modal-prompt-guide").classList.remove("hidden");
});

document.getElementById("btn-prompt-guide-close").addEventListener("click", function() {
  document.getElementById("modal-prompt-guide").classList.add("hidden");
});

document.getElementById("modal-prompt-guide").addEventListener("click", function(e) {
  if (e.target === this) this.classList.add("hidden");
});

document.getElementById("btn-copy-prompt").addEventListener("click", function() {
  navigator.clipboard.writeText(AI_EXTRACTION_PROMPT).then(function() {
    var btn = document.getElementById("btn-copy-prompt");
    btn.textContent = "✓ Copied!";
    setTimeout(function() { btn.textContent = "📋 Copy Prompt"; }, 2000);
  });
});

document.getElementById("btn-bulk-import").addEventListener("click", function() {
  if (!state.currentClass) return;
  document.getElementById("bulk-import-input").value = "";
  document.getElementById("bulk-import-preview").innerHTML = "";
  openModal("bulk-import");
  document.getElementById("bulk-import-input").focus();
});

document.getElementById("btn-save-bulk-import").addEventListener("click", function() {
  var raw = document.getElementById("bulk-import-input").value;
  var sections = parseBulkImport(raw);
  if (sections.length === 0) { alert("No valid lessons found. Start each lesson with a # heading."); return; }

  var classId = state.currentClass.id;
  // Create lessons sequentially, then their cards
  sections.reduce(function(chain, section) {
    return chain.then(function() {
      return store.createLesson({ classId: classId, title: section.title, format: section.format })
        .then(function(lesson) {
          if (section.cards.length === 0) return;
          var withLesson = section.cards.map(function(c) {
            return { lessonId: lesson.id, format: c.format, data: c.data };
          });
          return store.createCards(withLesson);
        });
    });
  }, Promise.resolve()).then(function() {
    closeModal("bulk-import");
    renderLessons();
  });
});

/* ============================
   UTILITY
   ============================ */

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function relativeTime(unixSec) {
  if (!unixSec) return "never";
  var diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60)           return "just now";
  if (diff < 3600)         return Math.floor(diff / 60) + "m ago";
  if (diff < 86400)        return Math.floor(diff / 3600) + "h ago";
  if (diff < 7 * 86400)   return Math.floor(diff / 86400) + "d ago";
  return Math.floor(diff / (7 * 86400)) + "w ago";
}

function futureRelativeTime(unixSec) {
  if (!unixSec) return "not scheduled";
  var diff = unixSec - Math.floor(Date.now() / 1000);
  if (diff <= 0)           return "now";
  if (diff < 3600)         return "in " + Math.floor(diff / 60) + "m";
  if (diff < 86400)        return "in " + Math.floor(diff / 3600) + "h";
  return "in " + Math.floor(diff / 86400) + "d";
}

/* ============================
   SERVER ADAPTER (Phase 2)
   ============================ */

var SQLiteAdapter = (function() {
  var BASE = "/api";

  function req(method, path, body) {
    var opts = { method: method, credentials: "same-origin", headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(BASE + path, opts).then(function(r) {
      if (r.status === 401) { showAuthScreen(); return Promise.reject(new Error("Unauthorized")); }
      if (r.status === 204) return null;
      return r.json().then(function(data) {
        if (!r.ok) return Promise.reject(new Error(data.error || ("API error " + r.status)));
        return data;
      });
    });
  }

  return {
    getClasses:  function()     { return req("GET",    "/classes"); },
    getClass:    function(id)   { return req("GET",    "/classes/" + id); },
    createClass: function(f)    { return req("POST",   "/classes", f); },
    updateClass: function(id,f) { return req("PUT",    "/classes/" + id, f); },
    deleteClass: function(id)   { return req("DELETE", "/classes/" + id); },

    getLessons:   function(classId) { return req("GET",    "/classes/" + classId + "/lessons"); },
    createLesson: function(f)       { return req("POST",   "/classes/" + f.classId + "/lessons", { title: f.title, format: f.format }); },
    updateLesson: function(id, f)   { return req("PUT",    "/lessons/" + id, f); },
    deleteLesson: function(id)      { return req("DELETE", "/lessons/" + id); },

    getCards:      function(lessonId)   { return req("GET",  "/lessons/" + lessonId + "/cards"); },
    getBulkCards:  function(lessonIds)  { return req("POST", "/cards/by-lessons", { lessonIds: lessonIds }); },
    createCard: function(f)        { return req("POST",   "/lessons/" + f.lessonId + "/cards", { format: f.format, data: f.data }); },
    createCards: function(list) {
      // Group by lessonId, one bulk call per lesson
      var byLesson = {};
      list.forEach(function(f) {
        if (!byLesson[f.lessonId]) byLesson[f.lessonId] = [];
        byLesson[f.lessonId].push({ format: f.format, data: f.data });
      });
      var promises = Object.keys(byLesson).map(function(lessonId) {
        return req("POST", "/lessons/" + lessonId + "/cards/bulk", { cards: byLesson[lessonId] });
      });
      return Promise.all(promises).then(function(results) {
        return results.reduce(function(acc, r) { return acc.concat(r || []); }, []);
      });
    },
    updateCard: function(id, _lessonId, f) { return req("PUT",    "/cards/" + id, f); },
    deleteCard: function(id)               { return req("DELETE", "/cards/" + id); },

    recordAttempt: function(f) {
      var body = { cardId: f.cardId, correct: f.correct, source: f.source };
      if (f.grade) body.grade = f.grade;
      return req("POST", "/attempts", body);
    },
    getCardStats: function() { return Promise.resolve({ total: 0, correct: 0, blended: 0, level: "new" }); },
    getDifficultyMap: function(cardIds) {
      return req("POST", "/stats/difficulty-map", { cardIds: cardIds });
    },
    saveQuizSession: function(lessonIds, score, total) {
      return req("POST", "/review/sessions", { lessonIds: lessonIds, score: score, total: total });
    },
    getDueLessons: function(lessonIds) {
      return req("GET", "/review/due?lessonIds=" + lessonIds.join(","));
    },
    getLessonStats: function(lessonId) { return req("GET", "/stats/lesson/" + lessonId); },
    getHardestCards: function(opts) {
      var scope = opts.scope;
      var qs = "scope=" + scope.type + (scope.id ? "&id=" + scope.id : "") + "&limit=" + (opts.limit || 30);
      return req("GET", "/stats/hardest?" + qs);
    },

    setCardKnown: function(cardId, known) {
      return req("PUT", "/cards/states/" + cardId, { known: known });
    },
    getKnownMap: function(lessonId) {
      return req("GET", "/lessons/" + lessonId + "/states");
    },

    getProgress: function(type, id) { return req("GET", "/stats/progress/" + type + "/" + id); },
    getDashboard: function() { return req("GET", "/stats/dashboard"); },
    getAnalytics: function(days) { return req("GET", "/stats/analytics?days=" + (days || 60)); },
    getSrsDistribution: function() { return req("GET", "/stats/srs-distribution"); },
    getClassAccuracy: function() { return req("GET", "/stats/accuracy/classes"); },
    getLessonAccuracy: function(classId) { return req("GET", "/stats/accuracy/lessons?classId=" + classId); },

    markCardsSeen: function(cardIds) {
      if (!cardIds || !cardIds.length) return Promise.resolve();
      return req("POST", "/cards/seen", { cardIds: cardIds });
    },

    exportAll: function() { return req("GET", "/export"); },
    importAll: function(json) { return req("POST", "/import", json); },
    clearAll:  function() { return Promise.resolve(); },
    search:    function(q) { return req("GET", "/search?q=" + encodeURIComponent(q)); }
  };
})();

/* ============================
   AUTH UI (server mode only)
   ============================ */

var IS_SERVER = typeof window.APP_CONFIG !== "undefined" && window.APP_CONFIG.mode === "server";
var currentUser = IS_SERVER && window.APP_CONFIG.user ? window.APP_CONFIG.user : null;

/* ============================
   DROPDOWN MENUS
   ============================ */

function registerDropdown(btnId, menuId) {
  var btn  = document.getElementById(btnId);
  var menu = document.getElementById(menuId);
  if (!btn || !menu) return;
  btn.addEventListener("click", function(e) {
    e.stopPropagation();
    var open = !menu.classList.contains("hidden");
    closeAllDropdowns();
    if (!open) menu.classList.remove("hidden");
  });
}

function closeAllDropdowns() {
  document.querySelectorAll(".dropdown-menu").forEach(function(m) { m.classList.add("hidden"); });
}

document.addEventListener("click", closeAllDropdowns);

registerDropdown("btn-class-menu",  "class-dropdown-menu");
registerDropdown("btn-lesson-menu", "lesson-dropdown-menu");
registerDropdown("btn-user-menu",   "user-dropdown-menu");
registerDropdown("btn-home-menu",   "home-dropdown-menu");

/* ============================
   AUTH UI
   ============================ */

function showAuthPanel(which) {
  ["form-login","form-register","form-forgot","form-reset"].forEach(function(id) {
    document.getElementById(id).classList.add("hidden");
  });
  document.getElementById("auth-tabs").classList.toggle("hidden", which === "forgot" || which === "reset");
  document.querySelectorAll(".auth-tab").forEach(function(t) {
    t.classList.toggle("active", t.dataset.auth === which);
  });
  if (which === "login" || which === "register") {
    document.getElementById("form-" + which).classList.remove("hidden");
  } else {
    document.getElementById("form-" + which).classList.remove("hidden");
  }
}

function showAuthScreen() {
  currentUser = null;
  showAuthPanel("login");
  document.getElementById("login-email").value = "";
  document.getElementById("login-password").value = "";
  clearAuthError("login");
  clearAuthError("register");
  clearAuthError("forgot");
  showScreen("auth");
}

function applyDarkMode(enabled) {
  state.darkMode = !!enabled;
  document.documentElement.setAttribute("data-theme", state.darkMode ? "dark" : "light");
}

var TTS_RATE_MIN = 0.5, TTS_RATE_MAX = 1.5, TTS_RATE_STEP = 0.1;
var FONT_SCALE_MIN = 0.7, FONT_SCALE_MAX = 1.5, FONT_SCALE_STEP = 0.1;
function applyFontScale(scale) {
  scale = Math.round(Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, scale)) * 10) / 10;
  state.fontScale = scale;
  document.documentElement.style.setProperty("--font-scale", scale);
}

function applyPrefs(prefs) {
  if (typeof prefs.darkMode === "boolean") {
    applyDarkMode(prefs.darkMode);
  }
  if (typeof prefs.fontScale === "number") {
    applyFontScale(prefs.fontScale);
  }
  if (typeof prefs.ttsRate === "number") {
    state.ttsRate = prefs.ttsRate;
  }
}

function loadUserPreferences() {
  if (!IS_SERVER) return;
  // Apply cached prefs immediately so openSetup() sees the right value even before the fetch resolves
  try {
    var cached = localStorage.getItem("fc-preferences");
    if (cached) applyPrefs(JSON.parse(cached));
  } catch (_) {}
  fetch("/api/auth/preferences", { credentials: "same-origin" })
    .then(function(r) { return r.ok ? r.json() : {}; })
    .then(function(prefs) {
      applyPrefs(prefs);
      try { localStorage.setItem("fc-preferences", JSON.stringify(prefs)); } catch (_) {}
    })
    .catch(function() {});
}

function initUserNav() {
  var nav = document.getElementById("user-nav");
  if (!IS_SERVER || !currentUser) { nav.classList.add("hidden"); return; }
  nav.classList.remove("hidden");
  document.getElementById("user-name-display").textContent = currentUser.name;
  document.getElementById("user-dropdown-email").textContent = currentUser.email || "";
  var circle = document.getElementById("user-initial-circle");
  if (circle) circle.textContent = (currentUser.name || "?")[0].toUpperCase();
  document.getElementById("btn-dashboard").classList.remove("hidden");
  // Sidebar items
  document.getElementById("sidebar-dashboard-link").classList.remove("hidden");
  document.getElementById("sidebar-select-link").classList.remove("hidden");
  document.getElementById("sidebar-classes-label").classList.remove("hidden");
  document.getElementById("sidebar-btn-new-class").classList.remove("hidden");
  var linkBtn = document.getElementById("btn-link-google");
  if (linkBtn && window.APP_CONFIG && window.APP_CONFIG.googleEnabled) {
    linkBtn.classList.remove("hidden");
  } else if (linkBtn) {
    linkBtn.classList.add("hidden");
  }
  loadUserPreferences();
}

function renderSidebarClasses(classes) {
  var list = document.getElementById("sidebar-class-list");
  if (!list) return;
  list.innerHTML = "";
  (classes || []).forEach(function(cls) {
    var li = document.createElement("li");
    li.className = "sidebar-class-item";
    li.title = cls.name;
    li.innerHTML =
      '<span class="sidebar-class-icon">' + escHtml(cls.icon || "📚") + '</span>' +
      '<span class="sidebar-class-name">' + escHtml(cls.name) + '</span>';
    if (cls.due_count > 0) {
      li.innerHTML += '<span class="due-badge" style="font-size:0.65rem;padding:1px 5px">' + cls.due_count + '</span>';
    }
    li.addEventListener("click", function() { closeSidebar(); openClass(cls.id); });
    list.appendChild(li);
  });
}

function openSidebar() {
  document.getElementById("sidebar").classList.add("sidebar-open");
  document.getElementById("sidebar-overlay").classList.add("active");
}
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("sidebar-open");
  document.getElementById("sidebar-overlay").classList.remove("active");
}

(function initSidebar() {
  document.getElementById("btn-sidebar-toggle").addEventListener("click", function() {
    var sidebar = document.getElementById("sidebar");
    if (sidebar.classList.contains("sidebar-open")) { closeSidebar(); } else { openSidebar(); }
  });
  document.getElementById("sidebar-overlay").addEventListener("click", closeSidebar);
  document.getElementById("btn-sidebar-close").addEventListener("click", closeSidebar);
  document.getElementById("sidebar-home-link").addEventListener("click", function() {
    closeSidebar();
    renderHome();
    showScreen("home");
  });
  document.getElementById("sidebar-dashboard-link").addEventListener("click", function() {
    closeSidebar();
    document.getElementById("btn-dashboard").click();
  });
  document.getElementById("sidebar-select-link").addEventListener("click", function() {
    closeSidebar();
    document.getElementById("btn-select-classes").click();
  });
  document.getElementById("sidebar-btn-new-class").addEventListener("click", function() {
    closeSidebar();
    document.getElementById("btn-new-class").click();
  });
}());

// Auth tab switching
document.querySelectorAll(".auth-tab").forEach(function(tab) {
  tab.addEventListener("click", function() {
    showAuthPanel(this.dataset.auth);
  });
});

function showAuthError(formId, msg) {
  var el = document.getElementById(formId + "-error");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
}

function clearAuthError(formId) {
  var el = document.getElementById(formId + "-error");
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

document.getElementById("form-login").addEventListener("submit", function(e) {
  e.preventDefault();
  clearAuthError("login");
  var email    = document.getElementById("login-email").value.trim();
  var password = document.getElementById("login-password").value;
  fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email, password: password })
  }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); })
  .then(function(res) {
    if (!res.ok) { showAuthError("login", res.d.error || "Login failed"); return; }
    currentUser = res.d;
    initUserNav();
    renderSharedWithMe();
    restoreLastScreen();
  }).catch(function() { showAuthError("login", "Network error"); });
});

document.getElementById("form-register").addEventListener("submit", function(e) {
  e.preventDefault();
  clearAuthError("register");
  var name     = document.getElementById("register-name").value.trim();
  var email    = document.getElementById("register-email").value.trim();
  var password = document.getElementById("register-password").value;
  fetch("/api/auth/register", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name, email: email, password: password })
  }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); })
  .then(function(res) {
    if (!res.ok) { showAuthError("register", res.d.error || "Registration failed"); return; }
    currentUser = res.d;
    initUserNav();
    try { localStorage.removeItem("fc-last-screen"); } catch (_) {}
    renderSharedWithMe();
    restoreLastScreen();
  }).catch(function() { showAuthError("register", "Network error"); });
});

// Forgot password
document.getElementById("btn-forgot-password").addEventListener("click", function() {
  showAuthPanel("forgot");
  document.getElementById("forgot-email").value = document.getElementById("login-email").value;
});
document.getElementById("btn-back-to-login").addEventListener("click", function() {
  showAuthPanel("login");
});
document.getElementById("btn-send-reset").addEventListener("click", function() {
  clearAuthError("forgot");
  document.getElementById("forgot-success").classList.add("hidden");
  var email = document.getElementById("forgot-email").value.trim();
  if (!email) { showAuthError("forgot", "Please enter your email"); return; }
  fetch("/api/auth/forgot-password", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email })
  }).then(function(r) { return r.json(); })
  .then(function(d) {
    var successEl = document.getElementById("forgot-success");
    successEl.classList.remove("hidden");
    if (d._devResetUrl) {
      successEl.textContent = "Dev mode — reset link: " + d._devResetUrl;
    } else {
      successEl.textContent = "If that email exists, a reset link has been sent. Check your inbox.";
    }
  }).catch(function() { showAuthError("forgot", "Network error"); });
});

// Reset password (shown when page loaded with ?token=)
(function() {
  var resetToken = IS_SERVER && window.APP_CONFIG && window.APP_CONFIG.resetToken;
  if (!resetToken) return;
  showAuthPanel("reset");
  document.getElementById("btn-do-reset").addEventListener("click", function() {
    clearAuthError("reset");
    var pw  = document.getElementById("reset-password").value;
    var pw2 = document.getElementById("reset-password2").value;
    if (pw.length < 6) { showAuthError("reset", "Password must be at least 6 characters"); return; }
    if (pw !== pw2)    { showAuthError("reset", "Passwords do not match"); return; }
    fetch("/api/auth/reset-password", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: resetToken, password: pw })
    }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); })
    .then(function(res) {
      if (!res.ok) { showAuthError("reset", res.d.error || "Reset failed"); return; }
      currentUser = res.d;
      initUserNav();
      try { localStorage.removeItem("fc-last-screen"); } catch (_) {}
      renderSharedWithMe();
      history.replaceState({}, "", "/");
      restoreLastScreen();
    }).catch(function() { showAuthError("reset", "Network error"); });
  });
})();

// Check URL params for Google auth errors/success
(function() {
  var params = new URLSearchParams(window.location.search);
  if (params.get("auth_error")) {
    var msgs = {
      google_cancelled: "Google sign-in was cancelled.",
      google_failed: "Google sign-in failed. Please try again.",
      google_already_linked: "This Google account is already linked to another user."
    };
    var msg = msgs[params.get("auth_error")] || "Authentication error.";
    showAuthError("login", msg);
    showAuthPanel("login");
    history.replaceState({}, "", "/");
  }
  if (params.get("google_linked") === "1") {
    history.replaceState({}, "", "/");
  }
})();

// Google sign-in section visibility
(function() {
  if (IS_SERVER && window.APP_CONFIG && window.APP_CONFIG.googleEnabled) {
    document.getElementById("google-auth-section").classList.remove("hidden");
  }
})();

document.getElementById("btn-logout").addEventListener("click", function() {
  closeAllDropdowns();
  try { localStorage.removeItem("fc-last-screen"); } catch (_) {}
  try { localStorage.removeItem("fc-preferences"); } catch (_) {}
  fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
    .then(function() { showAuthScreen(); });
});

function prefFontLabel() {
  document.getElementById("pref-font-label").textContent = Math.round(state.fontScale * 100) + "%";
}

function prefRateLabel(rate) {
  var el = document.getElementById("pref-rate-label");
  el.textContent = rate.toFixed(1) + "x";
  el.dataset.rate = rate;
}

document.getElementById("btn-open-preferences").addEventListener("click", function() {
  closeAllDropdowns();
  document.getElementById("pref-dark-mode").checked = state.darkMode;
  prefFontLabel();
  prefRateLabel(state.ttsRate);
  var ttsSupported = !!window.speechSynthesis;
  document.getElementById("pref-rate-decrease").disabled = !ttsSupported;
  document.getElementById("pref-rate-increase").disabled = !ttsSupported;
  document.getElementById("pref-tts-test").disabled = !ttsSupported;
  openModal("preferences");
});

document.getElementById("pref-font-decrease").addEventListener("click", function() {
  applyFontScale(state.fontScale - FONT_SCALE_STEP);
  prefFontLabel();
});
document.getElementById("pref-font-increase").addEventListener("click", function() {
  applyFontScale(state.fontScale + FONT_SCALE_STEP);
  prefFontLabel();
});

document.getElementById("pref-rate-decrease").addEventListener("click", function() {
  var cur = parseFloat(document.getElementById("pref-rate-label").dataset.rate) || 0.9;
  prefRateLabel(Math.round(Math.max(TTS_RATE_MIN, cur - TTS_RATE_STEP) * 10) / 10);
});
document.getElementById("pref-rate-increase").addEventListener("click", function() {
  var cur = parseFloat(document.getElementById("pref-rate-label").dataset.rate) || 0.9;
  prefRateLabel(Math.round(Math.min(TTS_RATE_MAX, cur + TTS_RATE_STEP) * 10) / 10);
});

document.getElementById("pref-tts-test").addEventListener("click", function() {
  var rate = parseFloat(document.getElementById("pref-rate-label").dataset.rate) || 0.9;
  speakWith("This is a test of the speed setting.", rate);
});

document.getElementById("btn-save-preferences").addEventListener("click", function() {
  var dark = document.getElementById("pref-dark-mode").checked;
  applyDarkMode(dark);
  var rate = parseFloat(document.getElementById("pref-rate-label").dataset.rate) || 0.9;
  state.ttsRate = rate;
  var prefs = { darkMode: dark, fontScale: state.fontScale, ttsRate: rate };
  try { localStorage.setItem("fc-preferences", JSON.stringify(prefs)); } catch (_) {}
  fetch("/api/auth/preferences", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs)
  }).catch(function() {});
  closeModal("preferences");
});

/* ============================
   INIT
   ============================ */

// Choose adapter
var store = IS_SERVER ? SQLiteAdapter : LocalStorageAdapter;

if (IS_SERVER && !currentUser) {
  showScreen("auth");
} else {
  initUserNav();
  if (IS_SERVER) document.getElementById("btn-dashboard").style.display = "";
  renderSharedWithMe();
  restoreLastScreen();
}

/* ============================
   SHARE FEATURE
   ============================ */

// ── Shared-with-me section on home screen ──

function renderSharedWithMe() {
  if (!IS_SERVER || !currentUser) return;
  fetch("/api/share/shared-with-me", { credentials: "same-origin" })
    .then(function(r) { return r.json(); })
    .then(function(classes) {
      var section = document.getElementById("shared-with-me-section");
      var grid    = document.getElementById("shared-class-list");
      if (!classes.length) { section.classList.add("hidden"); return; }
      section.classList.remove("hidden");
      grid.innerHTML = "";
      classes.forEach(function(cls) {
        var card = document.createElement("div");
        card.className = "class-card shared-class-card";
        card.innerHTML =
          '<div class="class-card-accent" style="background:' + cls.color + '"></div>' +
          '<span class="class-icon">' + cls.icon + '</span>' +
          '<div class="class-name">' + escHtml(cls.name) + '</div>' +
          '<div class="class-meta">by ' + escHtml(cls.owner_name) + '</div>' +
          '<div class="class-card-actions">' +
            '<button class="btn btn-sm btn-outline" data-clone-invite="' + cls.id + '">💾 Save Copy</button>' +
          '</div>';
        card.addEventListener("click", function(e) {
          if (e.target.closest("[data-clone-invite]")) return;
          openSharedClassStudy(cls);
        });
        card.querySelector("[data-clone-invite]").addEventListener("click", function(e) {
          e.stopPropagation();
          cloneInvitedClass(cls.id, cls.name);
        });
        grid.appendChild(card);
      });
    });
}

function cloneInvitedClass(classId, name) {
  fetch("/api/share/clone-invite/" + classId, { method: "POST", credentials: "same-origin" })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.classId) {
        renderHome();
        renderSharedWithMe();
        alert('"' + name + '" saved to your classes!');
      }
    });
}

function openSharedClassStudy(cls) {
  // Open the class detail but in read-only view (just lessons list)
  state.currentClass = cls;
  state.lessonFilter = "all";
  state._lessonAccuracyMap = {};
  state.sharedViewMode = true;
  document.getElementById("class-detail-name").textContent = cls.icon + " " + cls.name;
  renderLessons();
  showScreen("class");
}

// ── Public share token view (on page load) ──

var shareToken = IS_SERVER && window.APP_CONFIG.shareToken;
if (shareToken) {
  fetch("/api/share/view/" + shareToken)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) { showScreen("home"); return; }
      renderShareScreen(data, shareToken);
    });
}

function renderShareScreen(data, token) {
  document.getElementById("share-class-name").textContent = data.cls.icon + " " + data.cls.name;
  document.getElementById("share-owner-label").textContent = "by " + data.ownerName;

  var lessonList = document.getElementById("share-lesson-list");
  lessonList.innerHTML = "";
  data.lessons.forEach(function(lesson) {
    var cards = data.cards.filter(function(c) { return c.lesson_id === lesson.id; });
    var item = document.createElement("div");
    item.className = "lesson-item";
    item.innerHTML =
      '<div class="lesson-item-info">' +
        '<div class="lesson-title">' + escHtml(lesson.title) + '</div>' +
        '<div class="lesson-meta">' + cards.length + " card" + (cards.length !== 1 ? "s" : "") + '</div>' +
      '</div>';
    lessonList.appendChild(item);
  });

  var cloneBtn  = document.getElementById("btn-clone-shared");
  var loginNote = document.getElementById("share-login-notice");

  if (currentUser) {
    cloneBtn.classList.remove("hidden");
    loginNote.classList.add("hidden");
    cloneBtn.addEventListener("click", function() {
      fetch("/api/share/clone/" + token, { method: "POST", credentials: "same-origin" })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.classId) {
            alert('"' + data.cls.name + '" saved to your classes!');
            window.location.href = "/";
          } else {
            alert(d.error || "Failed to save");
          }
        });
    });
  } else {
    cloneBtn.classList.add("hidden");
    loginNote.classList.remove("hidden");
    document.getElementById("btn-share-go-login").addEventListener("click", function() {
      window.location.href = "/";
    });
  }

  showScreen("share");
}

// ── Share modal (owner) ──

var shareModalClassId = null;

document.getElementById("btn-share-class").addEventListener("click", function() {
  if (!state.currentClass) return;
  shareModalClassId = state.currentClass.id;
  openShareModal(shareModalClassId);
});

document.getElementById("btn-share-modal-close").addEventListener("click", closeShareModal);
document.getElementById("modal-share").addEventListener("click", function(e) {
  if (e.target === this) closeShareModal();
});

function openShareModal(classId) {
  document.getElementById("share-invite-input").value = "";
  document.getElementById("share-invite-error").classList.add("hidden");
  document.querySelector("#modal-share .modal").classList.remove("hidden");
  document.getElementById("modal-share").classList.remove("hidden");

  // Load existing share link
  loadShareLink(classId);
  // Load invited users
  loadInviteList(classId);
}

function closeShareModal() {
  document.getElementById("modal-share").classList.add("hidden");
}

function loadShareLink(classId) {
  var linkRow  = document.getElementById("share-link-row");
  var genBtn   = document.getElementById("btn-generate-share-link");
  var input    = document.getElementById("share-link-input");

  // Check if link already exists by trying to fetch invites (we store token on generate)
  // We use a local state cache
  if (window._shareLinkCache && window._shareLinkCache[classId]) {
    showShareLinkRow(window._shareLinkCache[classId]);
  } else {
    linkRow.classList.add("hidden");
    genBtn.classList.remove("hidden");
  }
}

function showShareLinkRow(token) {
  var linkRow = document.getElementById("share-link-row");
  var genBtn  = document.getElementById("btn-generate-share-link");
  var input   = document.getElementById("share-link-input");
  input.value = window.location.origin + "/share/" + token;
  linkRow.classList.remove("hidden");
  genBtn.classList.add("hidden");
}

document.getElementById("btn-generate-share-link").addEventListener("click", function() {
  if (!shareModalClassId) return;
  fetch("/api/share/link/" + shareModalClassId, { method: "POST", credentials: "same-origin" })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d.token) return;
      if (!window._shareLinkCache) window._shareLinkCache = {};
      window._shareLinkCache[shareModalClassId] = d.token;
      showShareLinkRow(d.token);
    });
});

document.getElementById("btn-copy-share-link").addEventListener("click", function() {
  var input = document.getElementById("share-link-input");
  navigator.clipboard.writeText(input.value).then(function() {
    var btn = document.getElementById("btn-copy-share-link");
    btn.textContent = "✓ Copied";
    setTimeout(function() { btn.textContent = "Copy"; }, 2000);
  });
});

document.getElementById("btn-revoke-share-link").addEventListener("click", function() {
  if (!shareModalClassId) return;
  fetch("/api/share/link/" + shareModalClassId, { method: "DELETE", credentials: "same-origin" })
    .then(function() {
      if (window._shareLinkCache) delete window._shareLinkCache[shareModalClassId];
      document.getElementById("share-link-row").classList.add("hidden");
      document.getElementById("btn-generate-share-link").classList.remove("hidden");
    });
});

function loadInviteList(classId) {
  fetch("/api/share/invites/" + classId, { credentials: "same-origin" })
    .then(function(r) { return r.json(); })
    .then(function(users) {
      var list = document.getElementById("share-invite-list");
      if (!users.length) {
        list.innerHTML = '<p class="share-empty-text">No one invited yet.</p>';
        return;
      }
      list.innerHTML = "";
      users.forEach(function(u) {
        var row = document.createElement("div");
        row.className = "share-user-row";
        row.innerHTML =
          '<span class="share-user-name">' + escHtml(u.name) + '</span>' +
          '<span class="share-user-email">' + escHtml(u.email) + '</span>' +
          '<button class="btn btn-danger btn-sm" data-remove-user="' + u.id + '">Remove</button>';
        row.querySelector("[data-remove-user]").addEventListener("click", function() {
          fetch("/api/share/invite/" + classId + "/" + u.id, { method: "DELETE", credentials: "same-origin" })
            .then(function() { loadInviteList(classId); });
        });
        list.appendChild(row);
      });
    });
}

document.getElementById("btn-send-invite").addEventListener("click", function() {
  var query = document.getElementById("share-invite-input").value.trim();
  var errEl = document.getElementById("share-invite-error");
  errEl.classList.add("hidden");
  if (!query || !shareModalClassId) return;

  fetch("/api/share/invite/" + shareModalClassId, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: query })
  }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); })
  .then(function(res) {
    if (!res.ok) {
      errEl.textContent = res.d.error || "Failed to invite";
      errEl.classList.remove("hidden");
      return;
    }
    document.getElementById("share-invite-input").value = "";
    loadInviteList(shareModalClassId);
  });
});

/* ============================
   KEYBOARD SHORTCUTS
   ============================ */

function getActiveScreen() {
  var el = document.querySelector(".screen.active");
  return el ? el.id.replace("screen-", "") : null;
}

function isInputFocused() {
  var tag = document.activeElement && document.activeElement.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/* ============================
   GLOBAL SEARCH
   ============================ */

var _searchDebounceTimer = null;
var _searchActiveIdx     = -1;
var _searchResultItems   = [];

function openSearchModal() {
  var modalEl = document.getElementById("modal-search");
  var inputEl = document.getElementById("search-input");
  modalEl.classList.remove("hidden");
  inputEl.value = "";
  _searchActiveIdx   = -1;
  _searchResultItems = [];
  document.getElementById("search-results").innerHTML = "";
  document.getElementById("search-empty").classList.add("hidden");
  setTimeout(function() { inputEl.focus(); }, 30);
}

function closeSearchModal() {
  document.getElementById("modal-search").classList.add("hidden");
  if (_searchDebounceTimer) { clearTimeout(_searchDebounceTimer); _searchDebounceTimer = null; }
}

function highlightMatch(text, q) {
  if (!text || !q) return escHtml(text || "");
  var ql  = q.toLowerCase();
  var tl  = text.toLowerCase();
  var idx = tl.indexOf(ql);
  if (idx === -1) return escHtml(text);
  return escHtml(text.slice(0, idx)) +
    '<mark class="search-highlight">' + escHtml(text.slice(idx, idx + q.length)) + '</mark>' +
    escHtml(text.slice(idx + q.length));
}

function renderSearchResults(results, q) {
  var container = document.getElementById("search-results");
  var emptyEl   = document.getElementById("search-empty");
  container.innerHTML = "";
  _searchActiveIdx   = -1;
  _searchResultItems = [];

  var total = results.classes.length + results.lessons.length + results.cards.length;
  if (total === 0) { emptyEl.classList.remove("hidden"); return; }
  emptyEl.classList.add("hidden");

  function makeSection(label, items, type, buildRow) {
    if (!items.length) return;
    var section = document.createElement("div");
    section.className = "search-section";
    var heading = document.createElement("div");
    heading.className = "search-section-title";
    heading.textContent = label;
    section.appendChild(heading);
    items.forEach(function(item) {
      var row = buildRow(item);
      row.setAttribute("role", "option");
      row.setAttribute("tabindex", "-1");
      row.dataset.searchIdx = String(_searchResultItems.length);
      var captured = { type: type, data: item };
      _searchResultItems.push(Object.assign(captured, { el: row }));
      row.addEventListener("click", function() { selectSearchResult(type, item); });
      section.appendChild(row);
    });
    container.appendChild(section);
  }

  makeSection("Classes", results.classes, "class", function(cls) {
    var el = document.createElement("div");
    el.className = "search-result-item";
    el.innerHTML =
      '<span class="search-result-icon">' + escHtml(cls.icon || "📚") + '</span>' +
      '<div class="search-result-main">' +
        '<div class="search-result-title">' + highlightMatch(cls.name, q) + '</div>' +
      '</div>' +
      '<span class="search-result-type">Class</span>';
    return el;
  });

  makeSection("Lessons", results.lessons, "lesson", function(lesson) {
    var el = document.createElement("div");
    el.className = "search-result-item";
    el.innerHTML =
      '<span class="search-result-icon">' + escHtml(lesson.class_icon || "📚") + '</span>' +
      '<div class="search-result-main">' +
        '<div class="search-result-title">' + highlightMatch(lesson.title, q) + '</div>' +
        '<div class="search-result-breadcrumb">' + escHtml(lesson.class_name) + '</div>' +
      '</div>' +
      '<span class="search-result-type">Lesson</span>';
    return el;
  });

  makeSection("Cards", results.cards, "card", function(card) {
    var el = document.createElement("div");
    el.className = "search-result-item";
    el.innerHTML =
      '<span class="search-result-icon">' + escHtml(card.class_icon || "📚") + '</span>' +
      '<div class="search-result-main">' +
        '<div class="search-result-title">' + highlightMatch(card.display_text || "", q) + '</div>' +
        '<div class="search-result-breadcrumb">' +
          escHtml(card.class_name) + ' › ' + escHtml(card.lesson_title) +
        '</div>' +
      '</div>' +
      '<span class="search-result-type">Card</span>';
    return el;
  });
}

function setSearchActiveIdx(idx) {
  _searchResultItems.forEach(function(item, i) {
    item.el.classList.toggle("search-result-active", i === idx);
    if (i === idx) item.el.scrollIntoView({ block: "nearest" });
  });
  _searchActiveIdx = idx;
}

function selectSearchResult(type, data) {
  closeSearchModal();
  if (type === "class") {
    openClass(data.id);
    return;
  }
  var targetClassId  = data.class_id;
  var targetLessonId = type === "lesson" ? data.id : data.lesson_id;
  store.getClass(targetClassId).then(function(cls) {
    if (!cls) return;
    state.currentClass = cls;
    state.lessonFilter = "all";
    state._lessonAccuracyMap = {};
    store.getLessons(targetClassId).then(function(lessons) {
      state.currentClassLessons = lessons;
      openLesson(targetLessonId);
    });
  });
}

(function initSearch() {
  var modalEl = document.getElementById("modal-search");
  var inputEl = document.getElementById("search-input");

  var navBar = document.getElementById("btn-search");
  navBar.addEventListener("click", openSearchModal);
  navBar.addEventListener("keydown", function(e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSearchModal(); }
  });

  modalEl.addEventListener("click", function(e) {
    if (e.target === modalEl) closeSearchModal();
  });

  inputEl.addEventListener("input", function() {
    var q = this.value.trim();
    if (_searchDebounceTimer) { clearTimeout(_searchDebounceTimer); _searchDebounceTimer = null; }
    if (q.length < 2) {
      document.getElementById("search-results").innerHTML = "";
      document.getElementById("search-empty").classList.add("hidden");
      _searchResultItems = [];
      _searchActiveIdx   = -1;
      return;
    }
    _searchDebounceTimer = setTimeout(function() {
      store.search(q).then(function(results) { renderSearchResults(results, q); }).catch(function() {});
    }, 200);
  });

  inputEl.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeSearchModal();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSearchActiveIdx(Math.min(_searchActiveIdx + 1, _searchResultItems.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSearchActiveIdx(Math.max(_searchActiveIdx - 1, -1));
      return;
    }
    if (e.key === "Enter" && _searchActiveIdx >= 0 && _searchActiveIdx < _searchResultItems.length) {
      e.preventDefault();
      var hit = _searchResultItems[_searchActiveIdx];
      selectSearchResult(hit.type, hit.data);
    }
  });
}());

function toggleKeymapModal() {
  var km = document.getElementById("modal-keymap");
  km.classList.toggle("hidden");
}

document.getElementById("btn-keymap-close").addEventListener("click", function() {
  document.getElementById("modal-keymap").classList.add("hidden");
});
document.getElementById("modal-keymap").addEventListener("click", function(e) {
  if (e.target === this) this.classList.add("hidden");
});
document.getElementById("btn-show-keymap").addEventListener("click", toggleKeymapModal);

function moveFocus(selector, dir) {
  var items = Array.from(document.querySelectorAll(selector));
  if (!items.length) return;
  var focused = document.activeElement;
  var idx = items.indexOf(focused);
  if (idx === -1) idx = dir > 0 ? -1 : items.length;
  var next = items[Math.max(0, Math.min(items.length - 1, idx + dir))];
  next.focus();
}

document.addEventListener("keydown", function(e) {
  var screen = getActiveScreen();
  if (!screen) return;

  // Ctrl/Cmd+K → open search
  if ((e.ctrlKey || e.metaKey) && e.key === "k") {
    e.preventDefault();
    openSearchModal();
    return;
  }

  // Escape closes any open modal (search first, then keymap, then overlay, then share/prompt-guide)
  if (e.key === "Escape") {
    if (!document.getElementById("modal-search").classList.contains("hidden")) {
      closeSearchModal();
      return;
    }
    if (!document.getElementById("modal-keymap").classList.contains("hidden")) {
      document.getElementById("modal-keymap").classList.add("hidden");
      return;
    }
    if (!document.getElementById("modal-overlay").classList.contains("hidden")) {
      closeAllModals();
      return;
    }
    if (!document.getElementById("modal-share").classList.contains("hidden")) {
      closeShareModal();
      return;
    }
    if (!document.getElementById("modal-prompt-guide").classList.contains("hidden")) {
      document.getElementById("modal-prompt-guide").classList.add("hidden");
      return;
    }
  }

  // Block all other shortcuts when any overlay modal is open or focus is in a text field
  var anyModalOpen = !document.getElementById("modal-overlay").classList.contains("hidden") ||
    !document.getElementById("modal-share").classList.contains("hidden") ||
    !document.getElementById("modal-prompt-guide").classList.contains("hidden") ||
    !document.getElementById("modal-search").classList.contains("hidden");
  if (anyModalOpen) return;
  if (isInputFocused()) return;

  // ? toggles keymap modal (only when not typing in a field)
  if (e.key === "?") {
    e.preventDefault();
    toggleKeymapModal();
    return;
  }

  // Global: H = home (any screen)
  if (e.key === "h" || e.key === "H") {
    renderHome();
    showScreen("home");
    saveScreenState("home");
    return;
  }

  if (screen === "home") {
    if (e.key === "Escape" && state.homeSelectMode) { setHomeSelectMode(false); return; }
    else if (e.key === "x" || e.key === "X") setHomeSelectMode(!state.homeSelectMode);
    else if (e.key === " " && state.homeSelectMode) {
      e.preventDefault();
      var f = document.activeElement;
      if (f && f.dataset.classId) toggleClassSelection(f.dataset.classId);
    }
    else if ((e.key === "a" || e.key === "A") && state.homeSelectMode) {
      var allCheck = document.getElementById("select-all-classes");
      allCheck.checked = !allCheck.checked;
      allCheck.dispatchEvent(new Event("change"));
    }
    else if ((e.key === "s" || e.key === "S") && state.homeSelectMode) document.getElementById("btn-study-classes").click();
    else if (e.key === "n" || e.key === "N") openNewClass();
    else if ((e.key === "a" || e.key === "A") && IS_SERVER) { renderDashboard(); showScreen("dashboard"); }
    else if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); moveFocus("#class-list [data-class-id]", 1); }
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); moveFocus("#class-list [data-class-id]", -1); }
    else if (e.key === "Enter") {
      var f = document.activeElement;
      if (f && f.dataset.classId) {
        if (state.homeSelectMode) toggleClassSelection(f.dataset.classId);
        else openClass(f.dataset.classId);
      } else if (state.homeSelectMode && state.selectedClassIds.length > 0) {
        document.getElementById("btn-study-classes").click();
      }
    }
  }

  else if (screen === "class") {
    if (e.key === "ArrowDown") { e.preventDefault(); moveFocus("#lesson-list .lesson-item", 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveFocus("#lesson-list .lesson-item", -1); }
    else if (e.key === "Enter") {
      var f = document.activeElement;
      if (f && f.dataset.lessonId) {
        if (state.selectMode) toggleLessonSelection(f.dataset.lessonId);
        else openLesson(f.dataset.lessonId);
      } else if (state.selectMode && state.selectedLessonIds.length > 0) {
        document.getElementById("btn-study-selected").click();
      }
    }
    else if (e.key === " " && state.selectMode) {
      e.preventDefault();
      var f = document.activeElement;
      if (f && f.dataset.lessonId) toggleLessonSelection(f.dataset.lessonId);
    }
    else if (e.key === "x" || e.key === "X") setSelectMode(!state.selectMode);
    else if ((e.key === "a" || e.key === "A") && state.selectMode) {
      var allCheck = document.getElementById("select-all-lessons");
      allCheck.checked = !allCheck.checked;
      allCheck.dispatchEvent(new Event("change"));
    }
    else if ((e.key === "s" || e.key === "S") && state.selectMode) document.getElementById("btn-study-selected").click();
    else if (e.key === "Escape" && state.selectMode) setSelectMode(false);
    else if (e.key === "n" || e.key === "N") openNewLesson();
    else if (e.key === "e" || e.key === "E") { if (state.currentClass) openEditClass(state.currentClass.id); }
    else if (e.key === "Backspace") { e.preventDefault(); document.getElementById("btn-class-back").click(); }
  }

  else if (screen === "lesson") {
    if (e.key === "n" || e.key === "N") openAddCard();
    else if (e.key === "b" || e.key === "B") openBulkAdd();
    else if (e.key === "s" || e.key === "S") { if (state.currentLesson) openSetup(); }
    else if (e.key === "Backspace") { e.preventDefault(); document.getElementById("btn-lesson-back").click(); }
  }

  else if (screen === "flashcard") {
    if (e.key === "ArrowLeft")  document.getElementById("btn-fc-prev").click();
    else if (e.key === "ArrowRight") document.getElementById("btn-fc-next").click();
    else if (e.key === " " || e.key === "Enter") { e.preventDefault(); document.getElementById("fc-scene").click(); }
    else if (e.key === "1") document.getElementById("btn-fc-learning").click();
    else if (e.key === "2") document.getElementById("btn-fc-known").click();
    else if (e.key === "s" || e.key === "S") document.getElementById("btn-fc-shuffle").click();
    else if (e.key === "r" || e.key === "R") document.getElementById("btn-fc-reset").click();
    else if (e.key === "f" || e.key === "F") document.getElementById("btn-fc-study-hard").click();
    else if (e.key === "p" || e.key === "P") speakText(state.studyFlipped ? state.studyBackText : state.studyFrontText);
  }

  else if (screen === "quiz") {
    var num = parseInt(e.key, 10);
    if (num >= 1 && num <= 5 && num <= state.quizOptions.length) answerQuiz(num - 1);
    else if (e.key === "Escape") returnFromStudy();
  }

  else if (screen === "results") {
    if (e.key === "r" || e.key === "R") document.getElementById("btn-results-retry").click();
    else if (e.key === "Escape") returnFromStudy();
  }

  else if (screen === "stats") {
    if (e.key === "Escape") document.getElementById("btn-stats-back").click();
  }

  else if (screen === "dashboard") {
    if (e.key === "Escape") document.getElementById("btn-dashboard-back").click();
  }

});

function injectKeyHints() {
  var hints = [
    ["btn-select-classes", "[X]"],
    ["btn-study-classes",  "[S]"],
    ["btn-new-class",      "[N]"],
    ["btn-new-lesson",     "[N]"],
    ["btn-edit-class",     "[E]"],
    ["btn-class-back",     "[⌫]"],
    ["btn-lesson-back",    "[⌫]"],
    ["btn-add-card",       "[N]"],
    ["btn-bulk-add",       "[B]"],
    ["btn-study-lesson",   "[S]"],
    ["btn-fc-shuffle",     "[S]"],
    ["btn-fc-reset",       "[R]"],
    ["btn-fc-study-hard",  "[F]"],
    ["btn-results-retry",  "[R]"],
    ["btn-results-back",   "[Esc]"],
    ["btn-stats-back",     "[Esc]"],
    ["btn-dashboard-back", "[Esc]"],
    ["btn-quiz-back",      "[Esc]"],
    ["btn-fc-learning",    "[1]"],
    ["btn-fc-known",       "[2]"],
    ["btn-fc-audio-front", "[P]"],
    ["btn-fc-audio-back",  "[P]"]
  ];
  var iconOnlyBtns = { "btn-new-class": true, "btn-select-classes": true };
  hints.forEach(function(pair) {
    var btn = document.getElementById(pair[0]);
    if (!btn) return;
    if (iconOnlyBtns[pair[0]]) return; // circle icon buttons — hint would clutter
    var span = document.createElement("span");
    span.className = "btn-key-hint";
    span.textContent = " " + pair[1];
    btn.appendChild(span);
  });
}

injectKeyHints();

/* ============================
   PULL-TO-REFRESH (mobile)
   ============================ */
(function() {
  var ind    = document.getElementById("ptr-indicator");
  var circle = ind.querySelector(".ptr-circle");
  var label  = ind.querySelector(".ptr-label");
  var THRESHOLD = 72;
  var startY = 0, lastDy = 0, pulling = false, busy = false;

  function setHeight(px) { ind.style.height = px + "px"; }

  document.addEventListener("touchstart", function(e) {
    if (busy || getActiveScreen() !== "home" || window.scrollY > 4) return;
    startY = e.touches[0].clientY;
    lastDy = 0;
    pulling = false;
    ind.style.transition = "none";
  }, { passive: true });

  document.addEventListener("touchmove", function(e) {
    if (busy || getActiveScreen() !== "home") return;
    if (window.scrollY > 4) { if (pulling) { setHeight(0); pulling = false; } return; }
    var dy = e.touches[0].clientY - startY;
    if (dy <= 0) { if (pulling) { setHeight(0); pulling = false; } return; }
    lastDy = dy;
    pulling = true;
    // Rubber-band: full speed until threshold, slow beyond
    var h = dy < THRESHOLD ? dy * 0.6 : THRESHOLD * 0.6 + (dy - THRESHOLD) * 0.15;
    setHeight(Math.min(Math.round(h), 64));
    var ready = dy >= THRESHOLD;
    circle.style.transform = "rotate(" + Math.min(dy / THRESHOLD, 1) * 320 + "deg)";
    label.textContent = ready ? "Release to refresh" : "Pull to refresh";
  }, { passive: true });

  document.addEventListener("touchend", function() {
    if (!pulling || busy) { pulling = false; return; }
    pulling = false;
    ind.style.transition = "";
    if (lastDy >= THRESHOLD) {
      busy = true;
      setHeight(56);
      circle.style.transform = "";
      ind.classList.add("ptr-spinning");
      label.textContent = "Refreshing…";
      renderHome();
      setTimeout(function() {
        setHeight(0);
        ind.classList.remove("ptr-spinning");
        busy = false;
      }, 1200);
    } else {
      setHeight(0);
    }
  }, { passive: true });
}());

// Swipe gestures: flashcard left/right, edge back, search modal dismiss
(function initSwipeGestures() {
  var SWIPE_THRESHOLD = 75;
  var MAX_ROT = 18;

  // ─── 1. Flashcard: right = known, left = learning ─────────────────────
  var scene = document.getElementById("fc-scene");
  var fcStartX, fcStartY, fcDragging = false, fcDx = 0;

  var knownHint = document.createElement("div");
  knownHint.className = "fc-swipe-hint fc-swipe-known";
  knownHint.textContent = "✓ Biết rồi";

  var learnHint = document.createElement("div");
  learnHint.className = "fc-swipe-hint fc-swipe-learning";
  learnHint.textContent = "✗ Học lại";

  scene.appendChild(knownHint);
  scene.appendChild(learnHint);

  scene.addEventListener("touchstart", function(e) {
    fcStartX = e.touches[0].clientX;
    fcStartY = e.touches[0].clientY;
    fcDragging = false;
    fcDx = 0;
  }, { passive: true });

  scene.addEventListener("touchmove", function(e) {
    var dx = e.touches[0].clientX - fcStartX;
    var dy = e.touches[0].clientY - fcStartY;
    if (!fcDragging) {
      if (Math.abs(dx) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) return;
      fcDragging = true;
    }
    fcDx = dx;
    var rot = (dx / (window.innerWidth * 0.5)) * MAX_ROT;
    scene.style.transition = "none";
    scene.style.transform = "translateX(" + dx + "px) rotate(" + rot + "deg)";
    var pct = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);
    if (dx > 0) {
      knownHint.style.opacity = pct;
      learnHint.style.opacity = 0;
    } else {
      learnHint.style.opacity = pct;
      knownHint.style.opacity = 0;
    }
  }, { passive: true });

  scene.addEventListener("touchend", function() {
    if (!fcDragging) return;
    fcDragging = false;
    knownHint.style.opacity = 0;
    learnHint.style.opacity = 0;
    var dx = fcDx;
    fcDx = 0;
    if (dx > SWIPE_THRESHOLD) {
      scene.style.transition = "transform 0.25s ease-out";
      scene.style.transform = "translateX(" + (window.innerWidth + 100) + "px) rotate(" + MAX_ROT + "deg)";
      setTimeout(function() {
        scene.style.transition = "none";
        scene.style.transform = "";
        document.getElementById("btn-fc-known").click();
      }, 250);
    } else if (dx < -SWIPE_THRESHOLD) {
      scene.style.transition = "transform 0.25s ease-out";
      scene.style.transform = "translateX(-" + (window.innerWidth + 100) + "px) rotate(-" + MAX_ROT + "deg)";
      setTimeout(function() {
        scene.style.transition = "none";
        scene.style.transform = "";
        document.getElementById("btn-fc-learning").click();
      }, 250);
    } else {
      scene.style.transition = "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)";
      scene.style.transform = "";
    }
  });

  // ─── 2. Edge back swipe (left edge → swipe right → go back) ───────────
  var EDGE_ZONE = 30;
  var EDGE_THRESHOLD = 90;
  var edgeStartX, edgeStartY, edgeActive = false;

  document.addEventListener("touchstart", function(e) {
    edgeStartX = e.touches[0].clientX;
    edgeStartY = e.touches[0].clientY;
    edgeActive = edgeStartX < EDGE_ZONE;
  }, { passive: true });

  document.addEventListener("touchend", function(e) {
    if (!edgeActive) return;
    edgeActive = false;
    if (getActiveScreen() === "flashcard") return;
    var dx = e.changedTouches[0].clientX - edgeStartX;
    var dy = e.changedTouches[0].clientY - edgeStartY;
    if (dx > EDGE_THRESHOLD && Math.abs(dy) < dx * 0.6) {
      var screen = getActiveScreen();
      if (screen === "home") {
        openSidebar();
        return;
      }
      var backMap = {
        "class": "btn-class-back",
        "lesson": "btn-lesson-back",
        "quiz": "btn-quiz-back",
        "stats": "btn-stats-back",
        "dashboard": "btn-dashboard-back"
      };
      var btn = backMap[screen];
      if (btn) {
        var el = document.getElementById(btn);
        if (el) el.click();
      }
    }
  }, { passive: true });

  // ─── 3. Search modal: swipe down to close ─────────────────────────────
  var modal = document.getElementById("search-modal");
  var modalStartY;
  if (modal) {
    modal.addEventListener("touchstart", function(e) {
      modalStartY = e.touches[0].clientY;
    }, { passive: true });
    modal.addEventListener("touchend", function(e) {
      if (e.changedTouches[0].clientY - modalStartY > 80) closeSearchModal();
    }, { passive: true });
  }
}());
