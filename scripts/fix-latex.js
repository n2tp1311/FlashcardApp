/**
 * fix-latex.js  —  paste vào browser console khi đang đăng nhập http://localhost:3000
 *
 * Chiến lược an toàn:
 *  - Text KHÔNG có $  → apply full conversion rules
 *  - Text ĐÃ có $     → CHỈ fix \command nằm ngoài $...$ (không đụng subscript/superscript)
 *
 * Luôn chạy DRY_RUN=true trước để xem preview.
 */

(async function fixLatex() {

  // ─────────────────────────────────────────────────────────────────────────
  // CORE: split text thành segments math / non-math (safe parser)
  // ─────────────────────────────────────────────────────────────────────────
  function splitSegments(text) {
    const parts = [];
    let i = 0;
    while (i < text.length) {
      if (text[i] !== '$') {
        const next = text.indexOf('$', i);
        parts.push({ math: false, s: next === -1 ? text.slice(i) : text.slice(i, next) });
        i = next === -1 ? text.length : next;
      } else {
        const isDisplay = text[i + 1] === '$';
        const delim = isDisplay ? '$$' : '$';
        const start = i + delim.length;
        const end = text.indexOf(delim, start);
        if (end === -1) {
          // Unmatched $ — treat rest as plain text (don't break)
          parts.push({ math: false, s: text.slice(i) });
          break;
        }
        parts.push({ math: true, s: text.slice(i, end + delim.length) });
        i = end + delim.length;
      }
    }
    return parts;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FIX cho text ĐÃ có $ (conservative)
  // Chỉ wrap \command hoặc \command{...} nằm ngoài $...$
  // ─────────────────────────────────────────────────────────────────────────
  function fixExistingLatex(text) {
    const parts = splitSegments(text);
    const fixed = parts.map(p => {
      if (p.math) return p.s;
      let s = p.s;
      // \command{args}  →  $\command{args}$
      s = s.replace(/\\([a-zA-Z]+)\{([^}]*)\}/g, '$\\$1{$2}$');
      // \command  (standalone, no braces)  →  $\command$
      s = s.replace(/\\([a-zA-Z]+)\b/g, '$\\$1$');
      return s;
    }).join('');
    return fixed;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FIX cho text CHƯA có $  (full rules)
  // ─────────────────────────────────────────────────────────────────────────
  function fixPlainText(text) {
    let t = text;

    // Greek letters + math context
    const greek = {
      sigma: '\\sigma', alpha: '\\alpha', beta: '\\beta', gamma: '\\gamma',
      delta: '\\delta', epsilon: '\\epsilon', eta: '\\eta', theta: '\\theta',
      lambda: '\\lambda', mu: '\\mu', nu: '\\nu', rho: '\\rho', tau: '\\tau',
      phi: '\\phi', psi: '\\psi', omega: '\\omega', pi: '\\pi',
      Sigma: '\\Sigma', Delta: '\\Delta', Gamma: '\\Gamma', Lambda: '\\Lambda',
      Omega: '\\Omega', Pi: '\\Pi', Phi: '\\Phi',
    };
    for (const [name, cmd] of Object.entries(greek)) {
      // greek^{...} hoặc greek_{...}
      t = t.replace(new RegExp(`\\b${name}(\\^|_)(\\{[^}]+\\}|\\w+)`, 'g'), `$${cmd}$1$2$`);
      // greek đứng sau toán tử
      t = t.replace(new RegExp(`([=(+\\-*/, ])${name}([^a-zA-Z])`, 'g'),
          (_, pre, post) => `${pre}$${cmd}$${post}`);
      t = t.replace(new RegExp(`([=(+\\-*/, ])${name}$`, 'g'),
          (_, pre) => `${pre}$${cmd}$`);
    }

    // word^{...}  word_{...}
    t = t.replace(/([A-Za-z]\w*)\^(\{[^}$]+\})/g, '$$$1^$2$$');
    t = t.replace(/([A-Za-z]\w*)_(\{[^}$]+\})/g,  '$$$1_$2$$');

    // x^2, h^2, B^m, X^T
    t = t.replace(/\b([A-Za-z])\^(\d+)\b/g, '$$$1^$2$$');
    t = t.replace(/\b([A-Za-z])\^([A-Za-z])\b/g, '$$$1^$2$$');

    // sqrt(expr)
    t = t.replace(/\bsqrt\(([^)]+)\)/g, '$\\sqrt{$1}$');

    // Var(...) Cov(...) E[...] E(...)
    t = t.replace(/\bVar\(([^)]+)\)/g,  '$\\text{Var}($1)$');
    t = t.replace(/\bCov\(([^)]+)\)/g,  '$\\text{Cov}($1)$');
    t = t.replace(/\bCorr\(([^)]+)\)/g, '$\\text{Corr}($1)$');
    t = t.replace(/\bE\[([^\]]+)\]/g,   '$E[$1]$');
    t = t.replace(/\bE\(([^)]+)\)/g,    '$E($1)$');

    // \hat{x} \tilde{x} \bar{x} (backslash without $)
    t = t.replace(/\\hat\{([^}]+)\}/g,   '$\\hat{$1}$');
    t = t.replace(/\\tilde\{([^}]+)\}/g, '$\\tilde{$1}$');
    t = t.replace(/\\bar\{([^}]+)\}/g,   '$\\bar{$1}$');

    // Merge adjacent $A$$B$ → $A B$
    t = t.replace(/\$([^$]+)\$\s*\$([^$]+)\$/g, '$$$1 $2$$');

    return t;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Entry point
  // ─────────────────────────────────────────────────────────────────────────
  function latexify(text) {
    if (!text) return text;
    if (text.includes('$')) return fixExistingLatex(text);
    return fixPlainText(text);
  }

  // ─────────────────────────────────────────────────────────────────────────
  const DRY_RUN = true;  // ← đổi thành false khi đã review xong
  // ─────────────────────────────────────────────────────────────────────────

  console.log(`%c[fix-latex] Starting... (${DRY_RUN ? 'DRY RUN' : 'LIVE'})`, 'color:#2563eb;font-weight:bold');

  let totalCards = 0, changedCards = 0, errors = 0;
  const changes = [];

  const classes = await fetch('/api/classes').then(r => r.json());
  if (!Array.isArray(classes)) { console.error('Not logged in'); return; }

  for (const cls of classes) {
    const lessons = await fetch(`/api/classes/${cls.id}/lessons`).then(r => r.json());
    for (const lesson of lessons) {
      const cards = await fetch(`/api/lessons/${lesson.id}/cards`).then(r => r.json());
      for (const card of cards) {
        totalCards++;
        const oldData = card.data;
        let newData;

        if (card.format === 'term-def') {
          newData = { term: latexify(card.data.term), def: latexify(card.data.def) };
        } else {
          newData = {
            question:    latexify(card.data.question),
            correct:     latexify(card.data.correct),
            distractors: card.data.distractors.map(latexify),
          };
        }

        if (JSON.stringify(newData) === JSON.stringify(oldData)) continue;

        changedCards++;
        changes.push({ lesson: lesson.title, id: card.id, before: oldData, after: newData });

        if (!DRY_RUN) {
          const res = await fetch(`/api/cards/${card.id}`, {
            method: 'PUT', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: newData }),
          });
          if (!res.ok) { errors++; console.warn('Failed:', card.id); }
        }
      }
    }
  }

  console.log(
    `%c[fix-latex] Done — ${changedCards} changes / ${totalCards} cards${errors ? ' | Errors: ' + errors : ''}`,
    'color:#16a34a;font-weight:bold'
  );

  if (changes.length) {
    console.groupCollapsed(`%cPreview (${changes.length} cards)`, 'color:#d97706');
    changes.forEach((c, i) => {
      console.group(`${i+1}. [${c.lesson}]`);
      console.log('Before:', c.before);
      console.log('After: ', c.after);
      console.groupEnd();
    });
    console.groupEnd();
    if (DRY_RUN) console.log('%c→ Set DRY_RUN=false và paste lại để apply.', 'color:#d97706');
    else console.log('%c→ Refresh trang để thấy thay đổi.', 'color:#2563eb');
  }

  return { totalCards, changedCards, errors, changes };
})();
