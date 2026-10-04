/* ============================================================
   FLASHCARD APP — Phase 1+2 (localStorage / SQLite server)
   ============================================================ */

"use strict";

/* ============================
   ICONS (minimalist SVG, feather-style)
   Used inside dynamically-generated template strings; static HTML
   inlines the same paths directly.
   ============================ */

function svgIcon(pathInner, size) {
  size = size || 14;
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + pathInner + '</svg>';
}

// Reused by every "bar fills in to show a percentage" widget (study/quiz progress, class/
// lesson mini progress, dashboard/stats/analytics fill bars — ~15 call sites) instead of each
// hand-building its own "scaleX(" + ... + ")" string. Takes a raw 0-1 scale factor, not a
// 0-100 percentage — callers with a percentage pass pct/100, since some (e.g. the flashcard/
// quiz progress bars) already have the 0-1 fraction on hand and dividing a percentage back
// down would be a pointless round-trip.
function scaleXStyle(scale) {
  return "scaleX(" + scale + ")";
}

var ICON_EDIT     = svgIcon('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>');
var ICON_DELETE   = svgIcon('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>');
var ICON_ARCHIVE  = svgIcon('<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>');
var ICON_UNARCHIVE = svgIcon('<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="12" y1="17" x2="12" y2="11"/><polyline points="9 14 12 11 15 14"/>');
var ICON_CHECK    = svgIcon('<polyline points="20 6 9 17 4 12"/>');
var ICON_LAYOUT_LIST = svgIcon('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>', 16);
var ICON_LAYOUT_GRID = svgIcon('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>', 16);
var ICON_X        = svgIcon('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>');
var ICON_FLAME     = svgIcon('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>');
var ICON_CLOCK     = svgIcon('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>');
var ICON_PLUS_CIRCLE = svgIcon('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>');
var ICON_SETTINGS  = svgIcon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>', 15);
var ICON_COPY     = svgIcon('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>');
var ICON_SAVE     = svgIcon('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>');
var ICON_CHEVRON_UP   = svgIcon('<polyline points="18 15 12 9 6 15"/>');
var ICON_CHEVRON_DOWN = svgIcon('<polyline points="6 9 12 15 18 9"/>');
var ICON_ARROW_LEFT   = svgIcon('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>');
var ICON_ARROW_RIGHT  = svgIcon('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>');
var ICON_LIGHTBULB    = svgIcon('<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2Z"/>');

/* ============================
   CLASS ICONS (minimalist line-art, one fixed accent color per icon —
   keeps classes visually distinguishable on Home without going back to
   full-color emoji; see docs/decisions.md)
   ============================ */
// stroke is a real hex color per icon, not currentColor — svgIcon() hardcodes
// currentColor for chrome icons, so class icons get their own tiny builder.
function classSvgIcon(pathInner, color, size) {
  size = size || 20;
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + pathInner + '</svg>';
}

var CLASS_ICON_DEFS = [
  { key: "book",           color: "#2563eb", path: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>' },
  { key: "hash",            color: "#d97706", path: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>' },
  { key: "microscope",      color: "#7c3aed", path: '<path d="M6 18h8"/><path d="M3 22h18"/><path d="M14 22a7 7 0 1 0 0-14h-1"/><path d="M9 14h2"/><path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z"/><path d="M12 6V3a1 1 0 0 0-1-1H9.5"/>' },
  { key: "flask",           color: "#0891b2", path: '<path d="M10 2v7.31"/><path d="M14 9.31V2"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/><path d="M5.5 16h13"/>' },
  { key: "dna",             color: "#db2777", path: '<path d="M7 3c0 6 10 6 10 12"/><path d="M17 21c0-6-10-6-10-12"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="8" y1="17" x2="16" y2="17"/>' },
  { key: "target",          color: "#dc2626", path: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>' },
  { key: "lightbulb",       color: "#eab308", path: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2Z"/>' },
  { key: "monitor",         color: "#64748b", path: '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>' },
  { key: "bar-chart",       color: "#16a34a", path: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' },
  { key: "globe",           color: "#0ea5e9", path: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>' },
  { key: "zap",             color: "#f97316", path: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>' },
  { key: "graduation-cap",  color: "#4f46e5", path: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/>' },
  { key: "landmark",        color: "#78716c", path: '<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 21 8 3 8"/>' },
  { key: "test-tube",       color: "#059669", path: '<path d="M9 2v17a3 3 0 0 0 6 0V2"/><line x1="7" y1="2" x2="17" y2="2"/><line x1="9" y1="14" x2="15" y2="14"/>' },
  { key: "triangle-ruler",  color: "#c026d3", path: '<path d="M4 20 13 4h2l5 16z"/><line x1="8" y1="20" x2="8" y2="17"/><line x1="11" y1="20" x2="11" y2="16"/><line x1="14" y1="20" x2="14" y2="15"/>' },
  { key: "telescope",       color: "#1e3a8a", path: '<path d="M6 19 16 4"/><path d="M6 19 20 8"/><path d="M16 4 20 8"/><path d="M6 19 3 22"/><path d="M6 19 9 22"/><line x1="6" y1="19" x2="6" y2="23"/>' }
];
var CLASS_ICON_BY_KEY = Object.create(null);
CLASS_ICON_DEFS.forEach(function(d) { CLASS_ICON_BY_KEY[d.key] = d; });
var CLASS_ICON_DEFAULT_KEY = "book";
// Old classes have icon = a raw emoji from the previous picker; render-time fallback
// (not a DB migration) resolves those to the matching new key, positionally by the old
// CLASS_ICONS order, so nobody's existing choice silently reverts to the default.
var LEGACY_CLASS_ICON_EMOJI_TO_KEY = Object.assign(Object.create(null), {
  "📚": "book", "🧮": "hash", "🔬": "microscope", "⚗️": "flask",
  "🧬": "dna", "🎯": "target", "💡": "lightbulb", "🖥️": "monitor",
  "📊": "bar-chart", "🌍": "globe", "⚡": "zap", "🎓": "graduation-cap",
  "🏛️": "landmark", "🧪": "test-tube", "📐": "triangle-ruler", "🔭": "telescope"
});
function classIconKey(icon) {
  if (typeof icon === "string" && CLASS_ICON_BY_KEY[icon]) return icon;
  if (typeof icon === "string" && LEGACY_CLASS_ICON_EMOJI_TO_KEY[icon]) return LEGACY_CLASS_ICON_EMOJI_TO_KEY[icon];
  return CLASS_ICON_DEFAULT_KEY;
}
function classIconHtml(icon, size) {
  var def = CLASS_ICON_BY_KEY[classIconKey(icon)];
  return classSvgIcon(def.path, def.color, size);
}

/* ============================
   I18N (English / Vietnamese)
   TRANSLATIONS is populated screen-by-screen below; t() falls back
   EN -> raw key so a missing entry degrades instead of crashing.
   ============================ */

var TRANSLATIONS = { en: {}, vi: {} };

Object.assign(TRANSLATIONS.en, {
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.saving": "Saving…",
  "toast.saveFailed": "Couldn't save: {message}",
  "toast.offlineQueued": "You're offline. Your answers are kept on this device and will sync when you reconnect.",
  "toast.synced": "{n} saved answers synced.",
  "toast.synced_one": "{n} saved answer synced.",
  "pref.title": "Preferences",
  "tutorial.title": "Quick tour",
  "tutorial.preferenceLabel": "Getting started",
  "tutorial.replay": "Show tutorial",
  "tutorial.skip": "Skip",
  "tutorial.back": "Back",
  "tutorial.next": "Next",
  "tutorial.finish": "Finish",
  "tutorial.stepCount": "Step {step} of {total}",
  "tutorial.step1Title": "Organize your subjects",
  "tutorial.step1Body": "Create a class for a subject, then open it to add lessons. You can also start with a shared class.",
  "tutorial.step2Title": "Add what you want to learn",
  "tutorial.step2Body": "Inside a lesson, add cards one by one or paste many at once. Choose the format that fits your material.",
  "tutorial.step3Title": "Study your cards",
  "tutorial.step3Body": "Open a lesson and choose Study. Flip cards to recall answers, or use Quiz to practice recognition.",
  "tutorial.step4Title": "Keep your progress",
  "tutorial.step4Body": "Mark how well you remembered each card. Spaced repetition schedules reviews, and Stats shows your progress. By default only flashcard answers count as progress — turn on Quiz answers count as Know It in Preferences to let quiz answers count too.",
  "tutorial.step5Title": "Save new English words",
  "tutorial.step5Body": "While studying in server mode, select a word or phrase on either side of a card, or in a quiz question, explanation or answer option once you have answered, and choose Save as English word. Open Vocabulary in FlashcardApp to add or remove pending words. In KnowledgeApp, choose Fetch words to create definitions and examples.",
  "pref.textSize": "Text size",
  "pref.theme": "Theme",
  "pref.themeLight": "Light",
  "pref.themeDark": "Dark",
  "pref.themeSystem": "Match device",
  "pref.palette": "Colour theme",
  "pref.highContrast": "High contrast",
  "pref.highContrastHint": "Dark mode only: brighter text and vivid colours on the page and both sides of the card.",
  "pref.palette.parchment": "Parchment",
  "pref.palette.sage": "Sage",
  "pref.palette.slate": "Slate",
  "pref.palette.sepia": "Sepia",
  "pref.palette.plum": "Plum",
  "pref.palette.harbour": "Harbour",
  "pref.palette.serika": "Serika",
  "pref.palette.nord": "Nord",
  "pref.palette.gruvbox": "Gruvbox",
  "pref.palette.solarized": "Solarized",
  "pref.palette.catppuccin": "Catppuccin",
  "pref.palette.rosepine": "Rosé Pine",
  "pref.palette.everforest": "Everforest",
  "pref.palette.tokyonight": "Tokyo Night",
  "pref.palette.dracula": "Dracula",
  "pref.haptics": "Vibration feedback",
  "pref.sounds": "Sound effects",
  "pref.soundsHint": "A marimba note when a quiz answer or a retyped answer is right, a low knock when it is wrong.",
  "pref.hapticsUnsupported": "This browser can't vibrate — iPhone and iPad never can. The setting still syncs to your Android devices.",
  "pref.quizCountsAsKnown": "Quiz answers count as Know It",
  "pref.quizCountsAsKnownHint": "A correct quiz answer counts as Know It (marks the card known and schedules it like a flashcard); a wrong answer counts as Still Learning. Off: cards only make progress through flashcards.",
  "pref.language": "Language",
  "pref.speed": "Speed",
  "pref.testSpeed": "Test speed",
  "pref.maxReviewsPerDay": "Max reviews per day",
  "pref.noLimit": "No limit",
  "pref.maxReviewsInvalid": "Enter a whole number (0 or more), or leave it empty for no limit.",
  "pref.apiTokens": "API tokens",
  "pref.apiTokensHint": "Lets KnowledgeApp send card updates to your account.",
  "pref.tokenName": "Token name",
  "pref.createToken": "Create token",
  "pref.tokenCopyOnce": "Copy this token now — it won't be shown again.",
  "pref.copy": "Copy",
  "pref.copied": "Copied",
  "pref.revoke": "Revoke",
  "pref.lastUsed": "Last used {date}",
  "pref.neverUsed": "Never used",
  "pref.noTokens": "No tokens",
  "upstream.updated": "Updated — needs review",
  "upstream.deleted": "Removed from source",
  "upstream.showPrevious": "Show previous",
  "upstream.hidePrevious": "Hide previous",
  "upstream.previous": "Previous",
  "upstream.markReviewed": "Mark reviewed",
  "upstream.navTitle": "Updates",
  "upstream.screenTitle": "Changes from KnowledgeApp",
  "upstream.bannerText": "{n} cards changed by KnowledgeApp",
  "upstream.bannerText_one": "{n} card changed by KnowledgeApp",
  "upstream.review": "Review",
  "upstream.summary": "{n} cards need review · {updated} updated · {deleted} removed",
  "upstream.summary_one": "{n} card needs review · {updated} updated · {deleted} removed",
  "upstream.empty": "No cards changed by KnowledgeApp.",
  "upstream.noneInFilter": "No cards in this filter.",
  "upstream.filterAll": "All",
  "upstream.filterUpdated": "Updated",
  "upstream.filterDeleted": "Removed",
  "upstream.current": "Current",
  "upstream.openInLesson": "Open in lesson",
  "upstream.markAllShown": "Mark all shown as reviewed",
  "upstream.confirmAckAll": "Mark {n} cards as reviewed?",
  "upstream.confirmAckAll_one": "Mark {n} card as reviewed?",
  "upstream.studyUpdated": "Study updated cards",
  "upstream.markedOne": "“{name}” marked as reviewed.",
  "upstream.markedMany": "{n} cards marked as reviewed: {names}",
  "vocabulary.nav": "Vocabulary",
  "vocabulary.screenTitle": "Vocabulary inbox",
  "vocabulary.subtitle": "Review saved words before fetching them in KnowledgeApp.",
  "vocabulary.loading": "Loading vocabulary queue…",
  "vocabulary.noPending": "No words waiting for KnowledgeApp.",
  "vocabulary.pendingCount": "{n} words waiting for KnowledgeApp",
  "vocabulary.pendingCount_one": "{n} word waiting for KnowledgeApp",
  "vocabulary.add": "Add word",
  "vocabulary.addTitle": "Add a word to the queue",
  "vocabulary.wordLabel": "Word or phrase",
  "vocabulary.wordPlaceholder": "e.g. resilient",
  "vocabulary.contextLabel": "Context (optional)",
  "vocabulary.contextPlaceholder": "Sentence or note to clarify the meaning",
  "vocabulary.source": "From {class} › {lesson}",
  "vocabulary.deleteConfirm": "Remove ‘{word}’ from the pending vocabulary queue?",
  "vocabulary.enterWord": "Enter a word or phrase.",
  "vocabulary.addError": "Couldn't add the word: {message}",
  "vocabulary.deleteError": "Couldn't remove the word: {message}",
  "vocabulary.alreadyFetched": "This word has already been fetched by KnowledgeApp.",
  "vocabulary.duplicatePending": "‘{word}’ is already in the queue with the same context. Add a different context to save another meaning.",
  "vocabulary.duplicateFetched": "‘{word}’ is already in your vocabulary deck with the same context. Add a different context to save another meaning.",
  "setup.updated": "Updated",
  "setup.hintUpdated": "Cards KnowledgeApp changed since you last reviewed them",

  "nav.home": "Home",
  "nav.dashboard": "Dashboard",
  "dashboard.tabOverview": "Overview",
  "dashboard.tabCharts": "Charts",
  "dashboard.tabLessons": "Lessons",
  "dashboard.needsAttention": "Needs attention",
  "dashboard.allLessons": "All lessons →",
  "dashboard.filterAll": "All",
  "dashboard.colLesson": "Lesson",
  "dashboard.colAccuracy": "Accuracy",
  "dashboard.colAnswers": "Answers",
  "dashboard.colMastered": "Mastered",
  "dashboard.colDue": "Due",
  "dashboard.struggling": "Struggling",
  "dashboard.strugglingHint": "{pct}% of answered cards are hard, last {n} days",
  "dashboard.lessonsNote": "Accuracy and answers: all time. Mastered and due: now. Struggling: last {n} days.",
  "dashboard.nothingNeedsAttention": "Nothing needs attention: no cards due and no struggling lessons.",
  "dashboard.noLessons": "No lessons yet.",
  "dashboard.dueNow": "Due now",
  "dashboard.cardsDue": "cards due",
  "dashboard.moreLessonsDue": "+{n} more lessons",
  "dashboard.moreLessonsDue_one": "+1 more lesson",
  "dashboard.dueLater": "{n} more due in the next {days} days",
  "dashboard.achAll": "All →",
  "ach.nav": "Achievements",
  "ach.filterAll": "All",
  "ach.earnedCount": "{n} of {total} earned",
  "ach.earnedOn": "Earned {date}",
  "ach.wasEarned": "was earned",
  "ach.waiting": "{n} waiting",
  "ach.notYet": "Not yet",
  "ach.goalOff": "Daily goal is off",
  "ach.next": "Next: {name} · {tier}",
  "ach.allLink": "All achievements →",
  "ach.allEarned": "Every achievement earned.",
  "ach.keepGoing": "Keep studying to start the next one.",
  "ach.tier1": "bronze",
  "ach.tier2": "silver",
  "ach.tier3": "gold",
  "ach.earnedLine": "{name} earned",
  "ach.earnedTierLine": "{name} · {tier}, {threshold}",
  "ach.newCount": "{n} new",
  "ach.loadFailed": "Couldn't load achievements.",
  "ach.progress": "{cur} / {target} {unit}",
  "ach.progressPct": "{cur}% of {target}%",
  "ach.count": "{n} {unit}",
  "ach.unit.days": "days",
  "ach.unit.lessons": "lessons",
  "ach.unit.cards": "cards",
  "ach.unit.words": "words",
  "ach.unit.typed": "typed",
  "ach.unit.hours": "hours",
  "ach.unit.fixes": "fixes",
  "ach.unit.weeks": "weeks",
  "ach.unit.reviews": "reviews",
  "ach.unit.min": "min",
  "ach.unit.classes": "classes",
  "ach.group.showingUp": "Showing up",
  "ach.group.mastery": "Mastery",
  "ach.group.effort": "Effort",
  "ach.group.method": "How you study",
  "ach.group.curiosity": "Curiosity",
  "ach.dayStreak.name": "Day streak",
  "ach.dayStreak.desc": "Study on consecutive days. Your best streak counts.",
  "ach.daysStudied.name": "Days studied",
  "ach.daysStudied.desc": "Every day you studied, in total.",
  "ach.goalKeeper.name": "Goal keeper",
  "ach.goalKeeper.desc": "Reach your daily goal on consecutive days.",
  "ach.aboveAverage.name": "Above your average",
  "ach.aboveAverage.desc": "Study longer than your 30-day average, day after day.",
  "ach.comeback.name": "Comeback",
  "ach.comeback.desc": "Come back after a week or more away, then study three days running.",
  "ach.steadyRhythm.name": "Steady rhythm",
  "ach.steadyRhythm.desc": "Study five days a week, four weeks in a row.",
  "ach.dueZero.name": "Due zero",
  "ach.dueZero.desc": "Clear every due card, on consecutive days.",
  "ach.classMastered.name": "Class mastered",
  "ach.classMastered.desc": "Every card in a class mastered: due 21 days or more out.",
  "ach.lessonMastered.name": "Lesson mastered",
  "ach.lessonMastered.desc": "Lessons with every card mastered.",
  "ach.longTermCards.name": "Cards in long-term memory",
  "ach.longTermCards.desc": "Cards mastered: due 21 days or more out.",
  "ach.longMemory.name": "Long memory",
  "ach.longMemory.desc": "90% right over your last 50 reviews of cards unseen for a month.",
  "ach.vocabInUse.name": "Vocabulary in use",
  "ach.vocabInUse.desc": "Words you saved, now mastered.",
  "ach.toughOne.name": "Tough one tamed",
  "ach.toughOne.desc": "Cards marked Learning three times, later answered Confident.",
  "ach.leechCleared.name": "Leech cleared",
  "ach.leechCleared.desc": "A card forgotten eight times, back in review.",
  "ach.recallCleared.name": "Recall cleared",
  "ach.recallCleared.desc": "Needs Recall emptied: no card known only from quizzes is due.",
  "ach.writer.name": "Writer",
  "ach.writer.desc": "Answers typed in Write mode.",
  "ach.deepSession.name": "Deep session",
  "ach.deepSession.desc": "One session of 25 minutes or more, with no break over 10 minutes.",
  "ach.hoursStudied.name": "Hours studied",
  "ach.hoursStudied.desc": "Time spent answering cards.",
  "ach.recallFirst.name": "Recall over recognition",
  "ach.recallFirst.desc": "A week of 30+ answers, 70% of them flashcards rather than quizzes.",
  "ach.mixedPractice.name": "Mixed practice",
  "ach.mixedPractice.desc": "One session that mixes three or more classes.",
  "ach.secondLook.name": "Second look",
  "ach.secondLook.desc": "Go back to a quiz question you got wrong.",
  "ach.cardFixer.name": "Card fixer",
  "ach.cardFixer.desc": "Edit a card while studying it.",
  "ach.wordCollector.name": "Word collector",
  "ach.wordCollector.desc": "Words saved to your vocabulary inbox.",
  "ach.explorer.name": "Explorer",
  "ach.explorer.desc": "Study three or more classes in one week.",
  "ach.builder.name": "Builder",
  "ach.builder.desc": "Cards you made yourself.",
  "ach.fromTheBook.name": "From the book",
  "ach.fromTheBook.desc": "Study a card made from a book in KnowledgeApp.",
  "ach.freshStart.name": "Fresh start",
  "ach.freshStart.desc": "Cards you made that graduated to review.",
  "nav.selectClasses": "Select Classes",
  "sidebar.yourClasses": "Your Classes",
  "sidebar.newClass": "New Class",
  "sidebar.toggle": "Toggle sidebar",
  "common.pullToRefresh": "Pull to refresh",
  "common.select": "Select",
  "common.selectAll": "Select all",
  "common.study": "Study",
  "search.titleHint": "Search (Ctrl+K)",
  "search.label": "Search",
  "search.placeholder": "Search flashcards",
  "user.account": "Account",
  "user.linkGoogle": "Link Google Account",
  "user.signOut": "Sign Out",
  "home.selectClasses": "Select Classes",
  "home.classesSelectedCount": "{n} classes selected",
  "home.classesSelectedCount_one": "{n} class selected",
  "home.emptyDefault": "No classes yet. Create your first class to get started.",
  "sort.sortBy": "Sort by",
  "sort.level": "Level",
  "sort.nameAZ": "Name (A–Z)",
  "sort.dueCount": "Due count",
  "sort.dateAdded": "Date added",
  "sort.lastActivity": "Last activity",
  "sort.toggleDirection": "Toggle sort direction",
  "home.tagFilterToggle": "Filter by tag",
  "archive.showArchived": "Show archived classes",
  "archive.archived": "Archived",
  "view.grid": "Grid view",
  "view.list": "List view",
  "share.sharedWithMe": "Shared with me",

  "common.loading": "Loading...",
  "common.archive": "Archive",
  "common.unarchive": "Unarchive",
  "common.edit": "Edit",
  "common.delete": "Delete",
  "home.emptyArchived": "No archived classes.",
  "count.due": "{n} due",
  "count.lessons": "{n} lessons",
  "count.lessons_one": "{n} lesson",
  "count.knownProgress": "{known} / {total} known ({pct}%)",
  "mastery.text": "{pct}% mastered",
  "mastery.tooltip": "Mastered {mastered} · Known {remembered} · Learning {learning} · New {fresh}. Mastered: the next review is 21 or more days away. Marked Know It: {flagged} / {total}.",
  "class.levelMeta": "Lv {level} · {lessons}",
  "class.knownTooltip": "Cards you've manually marked \"Know It\" in Flashcard mode",
  "class.complete": "Complete",
  "class.completeTooltip": "Every card in this class is marked Know It",
  "class.accuracyTooltip": "Accuracy across all recorded attempts (Flashcard + Quiz)",
  "confirm.deleteClass": "Delete class \"{name}\" and all its lessons and cards? Your study history and stats are kept.",
  "confirm.archiveClasses": "Archive {n} selected classes?",
  "confirm.archiveClasses_one": "Archive {n} selected class?",
  "alert.archiveClassesFailed": "Some classes could not be archived. Your selection is still active.",

  "stat.dayStreak": "Day Streak",
  "stat.streakResetsIn": "Resets in {time}",
  "stat.restDayAvailable": "Rest day available today",
  "stat.restDayHint": "One missed day a week keeps your streak. Study today to save it for later.",
  "goal.progress": "{done} of {goal} cards today",
  "goal.left": "{n} more to reach your daily goal",
  "goal.left_one": "1 more to reach your daily goal",
  "goal.met": "Daily goal met. Anything more is a bonus.",
  "week.label": "This week",
  "week.done": "Studied",
  "week.rest": "Rest day: the streak carried over",
  "week.missed": "Missed",
  "week.today": "Today",
  "week.future": "Coming up",
  "week.restHint": "❄ One missed day a week keeps your streak alive.",
  "pref.dailyGoal": "Daily goal",
  "pref.dailyGoalOff": "Off",
  "pref.dailyGoalHint": "Cards to answer each day, shown as a ring on Home. Counts flashcards and quiz answers.",
  "stat.streakResetsAtHint": "Your streak day resets at UTC midnight (00:00 UTC), not your local midnight.",
  "stat.classes": "Classes",
  "stat.lessons": "Lessons",
  "stat.cards": "Cards",
  "stat.sessions": "Sessions",
  "stat.sessionsHint": "Completed Quiz sessions only — Flashcard study is tracked under Attempts.",
  "stat.attempts": "Attempts",
  "stat.avgDailyLabel": "Avg/day",
  "stat.minDailyLabel": "Min",
  "stat.maxDailyLabel": "Max",
  "stat.studyTimeTrackedHint": "Based on the {n} days with tracked study time — days studied before time tracking shipped aren't counted here",
  "stat.studyTimeTrackedHint_one": "Based on the {n} day with tracked study time — days studied before time tracking shipped aren't counted here",
  "stat.studyTimeWindowHint": "last {n} days",
  "stat.allTime": "All time",
  "dashboard.heatmapTitle": "{n}-Day Study Heatmap",

  "auth.signIn": "Sign In",
  "auth.createAccount": "Create Account",
  "auth.continueWithGoogle": "Continue with Google",
  "common.or": "or",
  "auth.email": "Email",
  "auth.emailPlaceholder": "you@example.com",
  "auth.password": "Password",
  "auth.forgotPassword": "Forgot password?",
  "auth.name": "Name",
  "auth.namePlaceholder": "Your name",
  "auth.minChars": "Min. 6 characters",
  "auth.forgotHint": "Enter your email and we'll send a reset link.",
  "auth.sendResetLink": "Send Reset Link",
  "auth.resetHint": "Choose a new password for your account.",
  "auth.newPassword": "New Password",
  "auth.confirmPassword": "Confirm Password",
  "auth.repeatPassword": "Repeat password",
  "auth.setNewPassword": "Set New Password",
  "auth.backToSignIn": "Back to sign in",
  "auth.loginFailed": "Login failed",
  "common.networkError": "Network error",
  "common.refreshing": "Refreshing…",
  "auth.registrationFailed": "Registration failed",
  "auth.enterEmail": "Please enter your email",
  "auth.devResetLink": "Dev mode — reset link: {url}",
  "auth.resetLinkSent": "If that email exists, a reset link has been sent. Check your inbox.",
  "auth.minCharsError": "Password must be at least 6 characters",
  "auth.passwordsNoMatch": "Passwords do not match",
  "auth.resetFailed": "Reset failed",
  "auth.googleCancelled": "Google sign-in was cancelled.",
  "auth.googleFailed": "Google sign-in failed. Please try again.",
  "auth.googleAlreadyLinked": "This Google account is already linked to another user.",
  "auth.genericError": "Authentication error.",

  "common.back": "Back",
  "common.moreOptions": "More options",
  "common.stats": "Stats",
  "common.share": "Share",
  "common.export": "Export",
  "import.invalidJson": "That file isn't valid JSON.",
  "import.success": "Imported {classes}, {lessons}, {cards}.",
  "count.classes": "{n} classes",
  "count.classes_one": "{n} class",
  "common.zeroSelected": "0 selected",
  "common.nSelected": "{n} selected",
  "common.deleteSelected": "Delete selected",
  "common.shuffle": "Shuffle",
  "class.editClass": "Edit Class",
  "class.archiveClass": "Archive Class",
  "class.aiPromptGuide": "AI Prompt Guide",
  "class.bulkImport": "Bulk Import",
  "class.newLesson": "+ Lesson",
  "class.emptyLessons": "No lessons yet. Add a lesson to this class.",
  "lesson.studySelected": "Study selected",
  "lesson.editLesson": "Edit Lesson",
  "lesson.addCard": "+ Add Card",
  "lesson.bulkAdd": "+ Bulk Add",
  "lesson.reviewDueZero": "Quick quiz · 0 due",
  "lesson.emptyCards": "No cards yet. Add cards to start studying.",
  "sort.lastStudied": "Last studied",
  "sort.lastCardAdded": "Last card added",
  "setup.title": "Study Setup",
  "setup.cardCount": "Card Count",
  "setup.all": "All",
  "setup.filter": "Filter",
  "setup.allCards": "All Cards",
  "setup.dueOnly": "Due Only",
  "setup.needsRecall": "Needs Recall",
  "setup.stillLearning": "Still Learning",
  "setup.mode": "Mode",
  "setup.flashcards": "Flashcards",
  "setup.flashcardWrite": "Flashcard & Write",
  "setup.quiz": "Quiz",
  "setup.cardOrder": "Card Order",
  "setup.inOrder": "In Order",
  "setup.startStudying": "Start Studying",
  "setup.studyCount": "Study {n} cards",
  "setup.studyCount_one": "Study {n} card",
  "setup.studyCountOf": "Study {n} of {total} matching cards",
  "setup.loadFailed": "Couldn't load cards — try again.",
  "setup.studyingTogether": "Studying {n} lessons together",
  "setup.hintAll": "Study all cards",
  "setup.hintDue": "Only cards due for review (SRS)",
  "setup.hintNeedsRecall": "Cards you've only confirmed by recognizing them in a quiz, not by recalling them — answer in Flashcard mode to confirm you really know them",
  "setup.hintLearning": "Cards not yet known / still learning",
  "setup.hintFlashcardMode": "Recall it yourself first — the strongest signal for spaced repetition.",
  "setup.hintFlashcardWriteMode": "Type your answer before flipping, then flip to compare — an extra production step on top of recall.",
  "setup.hintQuizMode": "Faster, but recognizing an answer isn't the same as recalling it — cards need one correct Flashcard answer to reach longer review intervals.",
  "setup.hintQuizModeKnown": "Faster — with your preference on, a correct answer counts as Know It and a wrong one as Still Learning.",
  "setup.newCardEstimateLabel": "New cards recommended today",
  "dashboard.newCardsShortLabel": "Suggested new cards",
  "dashboard.futureDueTodayHint": "Includes cards already due or overdue",
  "setup.newCardEstimateDefaultNote": "Default estimate — not personalized yet. Keep studying and this will adapt to your pace.",
  "setup.newCardEstimateZeroNote": "Your accuracy dipped over the last week — focus on reviewing what you've already started before adding new cards.",
  "setup.newCardEstimatePersonalizedNote": "Based on your study history and recent accuracy.",
  "setup.newCardEstimateNoneLeft": "No new cards left — you've introduced everything!",
  "setup.presets": "Presets",
  "setup.presetNamePlaceholder": "Preset name",
  "setup.savePreset": "+ Save current as preset",
  "setup.deletePresetConfirm": "Delete preset \"{name}\"?",
  "setup.managePresets": "Manage presets",
  "setup.managePresetsTitle": "Manage Presets",
  "setup.noPresetsYet": "No presets saved yet.",
  "setup.moveUp": "Move up",
  "setup.moveDown": "Move down",
  "setup.renamePreset": "Rename",
  "setup.updatePresetHint": "Update to current setup",
  "setup.presetUpdated": "Updated!",
  "setup.interleaved": "Interleaved",

  "count.cardsDueForReview": "{n} cards due for review",

  "count.cardsDueForReview_one": "{n} card due for review",
  "lesson.nextReviewIn": "Next review in {time}",
  "format.termDef": "Term↔Def",
  "format.mcq": "MCQ",
  "format.trueFalse": "True/False",
  "format.imageDef": "Image↔Def",
  "count.cards": "{n} cards",
  "count.cards_one": "{n} card",
  "confirm.deleteLesson": "Delete lesson \"{title}\" and all its cards? Your study history and stats are kept.",
  "alert.noCardsDue": "No cards are due for review right now.",
  "alert.dailyReviewCapReached": "You've hit your daily review cap — come back tomorrow!",
  "bulk.andMore": "... and {n} more",
  "bulk.summary": "{lessons}, {cards} total",
  "class.unarchiveClass": "Unarchive Class",

  "time.never": "never",
  "time.justNow": "just now",
  "time.minutesAgo": "{n} min ago",
  "time.hoursAgo": "{n}h ago",
  "time.daysAgo": "{n}d ago",
  "time.weeksAgo": "{n}w ago",
  "time.notScheduled": "not scheduled",
  "time.now": "now",
  "time.today": "Today",
  "time.inMinutes": "in {n} min",
  "unit.s": "{n}s",
  "unit.min": "{n} min",
  "unit.lessThanMin": "<1 min",
  "unit.h": "{n}h",
  "unit.hMin": "{h}h {m}m",
  "unit.d": "{n}d",
  "unit.mo": "{n} mo",
  "unit.y": "{n} yr",
  "time.inHours": "in {n}h",
  "time.inDays": "in {n}d",
  "card.lastSeen": "Last seen",
  "card.lastStudied": "Last studied",
  "card.nextReview": "Next review",

  "study.exitSession": "Exit study session",
  "study.exit": "Exit",
  "study.editCard": "Edit card",
  "study.deleteCard": "Delete card",
  "study.clickToFlip": "Tap or click to flip",
  "study.showAnswer": "Show answer",
  "study.typeYourGuessPlaceholder": "Type your answer...",
  "study.yourGuess": "Your answer: {text}",
  "hero.streak": "Streak",
  "hero.days": "days",
  "hero.today": "Today",
  "hero.cardsToday": "{n} cards today",
  "hero.studied": "Studied",
  "hero.studiedHint": "Bar fills at your average day ({time})",
  "hero.newCards": "New cards",
  "hero.reviews": "Reviews",
  "hero.reviewsHint": "Against Max reviews per day (Preferences)",
  "hero.lastDays": "Last {n} days",
  "hero.perDay": "a day",
  "hero.total": "total",
  "hero.shortest": "shortest",
  "hero.longest": "longest",
  "hero.sparkLabel": "Daily study time, last {n} days",
  "hero.aboveAvgRun": "{n} days above average",
  "hero.aboveAvgRun1": "1 day above average",
  "hero.aboveAvgBest": "best {n}",
  "hero.aboveAvgKeep": "{time} more today keeps it going.",
  "hero.aboveAvgStart": "{time} more today starts a run.",
  "hero.aboveAvgHint": "A day counts when you study longer than the average of the 30 days before it. Days you didn't study count as 0 min. The dashed line on the study-time chart is that average.",
  "stat.aboveAvgLabel": "Above-average run",
  "undo.button": "Undo",
  "undo.graded": "Marked {grade}",
  "undo.failed": "That grade can no longer be undone",
  "hint.button": "Show first word",
  "hint.more": "Show next word",
  "hint.cap": "Hint used · best grade is Hard",
  "hint.moreWords": "+{n} words",
  "hint.moreWords_one": "+{n} word",
  "hint.usedTitle": "You used a hint, so this card counts as Hard at best",
  "study.retypeLabel": "Type the answer to continue",
  "study.retypeRequiredHint": "Type (or confirm) the answer above to continue",
  "study.retypePlaceholder": "Type the answer...",
  "study.retypeMismatch": "Not quite — try again.",
  "enc.right1": "Nice!",
  "enc.right2": "Spot on!",
  "enc.right3": "Great recall!",
  "enc.right4": "Correct!",
  "enc.right5": "You've got it!",
  "enc.right6": "Well done!",
  "enc.rightSub1": "That one's sticking.",
  "enc.rightSub2": "Your memory is doing the work.",
  "enc.rightSub3": "Keep this pace.",
  "enc.wrong1": "Not quite",
  "enc.wrong2": "Almost",
  "enc.wrong3": "Good try",
  "enc.wrongSub": "The right answer is marked. Mistakes now make it stick later.",
  "enc.combo3": "3 in a row!",
  "enc.combo5": "5 in a row! On fire",
  "enc.combo10": "{n} in a row! Unstoppable",
  "enc.comboSub": "Your streak of right answers is growing.",
  "enc.half": "Halfway there.",
  "enc.oneLeft": "One more to go.",
  "study.retypeCorrect": "Correct!",
  "study.retypeCloseEnough": "Close enough!",
  "study.latexConfirmLabel": "Review the answer above, then continue when you've got it",
  "study.latexContinue": "I recalled it — Continue",
  "study.speakP": "Speak (P)",
  "study.speakFront": "Speak front",
  "study.speakBack": "Speak back",
  "study.speakTerm": "Speak term",
  "study.translate": "Translate visible side (Alt+T)",
  "study.translating": "Translating…",
  "study.translationUnavailable": "Translation is available in server mode only.",
  "study.translationFailed": "Couldn't translate this side. Try again.",
  "study.translationEmpty": "There is no text on this side to translate.",
  "study.translationResult": "Translation",
  "keymap.translate": "Translate visible side into your preferred language",
  "study.saveWord": "Save as English word",
  "study.savingWord": "Saving word…",
  "study.wordQueued": "Saved — fetch in KnowledgeApp",
  "study.wordSaveFailed": "Couldn't save the word. Try again.",
  "study.wordAlreadyQueued": "Already saved with this context",
  "study.wordAlreadyFetched": "Already in your vocabulary deck",
  "study.prev": "Prev",
  "study.stillLearningHint": "Still Learning (1)",
  "study.learning": "Learning",
  "study.hardHint": "Hard (2) — recalled it, but it took some effort",
  "study.hard": "Hard",
  "study.knowItHint": "Know It (3)",
  "study.knowIt": "Know It",
  "study.confidentHint": "Confident (4)",
  "study.confident": "Confident",
  "study.next": "Next",
  "results.title": "Results",
  "results.retry": "Retry",
  "results.changeSetup": "Change Setup",
  "results.backToLesson": "Back to Lesson",
  "results.backToHome": "Back to Home",
  "results.backToClass": "Back to Class",
  "results.backToUpdates": "Back to Updates",
  "results.backToDashboard": "Back to Dashboard",
  "summary.title": "Session Complete",
  "summary.cardsStudied": "cards studied",
  "done.perfect": "Perfect session!",
  "done.great": "Great session!",
  "done.complete": "Session complete",
  "done.cards": "Cards",
  "done.questions": "Questions",
  "done.known": "Known",
  "done.bestRun": "Best run",
  "done.time": "Time",
  "done.streak": "Day streak {from} → {to}",
  "done.streakMilestone": "{n}-day streak!",
  "done.goalMet": "Daily goal reached: {n} cards today",
  "eta.minutes": "~{n} min left",
  "eta.underMinute": "<1 min left",
  "summary.new": "New",
  "summary.review": "Review",
  "summary.skippedNote": "{n} cards skipped (not graded)",
  "summary.skippedNote_one": "{n} card skipped (not graded)",
  "summary.reviewAction": "Go through cards again",

  "confirm.deleteCard": "Delete this card? Your study history and stats are kept.",
  "common.true": "True",
  "common.false": "False",
  "study.finish": "Finish",
  "results.correctOutOf": "{score} correct out of {total} questions",
  "results.hintGreat": "Great job! Cards scheduled for spaced repetition.",
  "results.hintOk": "Cards scheduled — focus on the ones you missed.",
  "results.hintKeepPracticing": "Keep practicing — missed cards are due again soon.",
  "results.cappedNote": "{n} cards need a Flashcard-mode recall to move to a longer review interval.",
  "results.cappedNote_one": "{n} card needs a Flashcard-mode recall to move to a longer review interval.",

  "difficulty.new": "New",
  "difficulty.easy": "Easy",
  "difficulty.medium": "Medium",
  "difficulty.hard": "Hard",

  "stats.titlePrefix": "Stats: {title}",
  "stats.overview": "Overview",
  "stats.hardestCards": "Hardest Cards",
  "stats.allAttempted": "All Attempted",
  "stats.totalCards": "Total Cards",
  "stats.attempted": "Attempted",
  "stats.accuracy": "Accuracy",
  "stats.noDataYet": "No data yet",
  "stats.totalAttempts": "Total Attempts",
  "stats.difficultyBreakdown": "Difficulty Breakdown",
  "stats.accuracyTrend": "Accuracy Trend",
  "stats.noAttemptedCards": "No attempted cards yet.",
  "stats.reviewHistory": "Review history",
  "stats.historyOlderOmitted": "Showing the latest {n} attempts; older history is omitted.",
  "stats.notApplicable": "Not applicable",
  "stats.noReviewHistory": "No review history yet.",
  "stats.correct": "Correct",
  "stats.incorrect": "Incorrect",
  "stats.mode.quiz": "Quiz",
  "stats.mode.flashcard": "Flashcard",
  "stats.mode.recall": "Recall",
  "card.imagePlaceholder": "[image]",
  "stats.correctOutOfPct": "{correct} / {total} correct ({pct}%)",

  "dashboard.exportCsv": "Export CSV",
  "common.loadingEllipsis": "Loading…",
  "dashboard.loadFailed": "Failed to load dashboard.",
  "dashboard.studyCharts": "Study Charts",
  "dashboard.days7": "7 days",
  "dashboard.days30": "30 days",
  "dashboard.days60": "60 days",
  "dashboard.days90": "90 days",
  "dashboard.weeklyTrend": "Answers",
  "dashboard.retentionTrend": "Accuracy",
  "dashboard.gradeDistribution": "How you answered",
  "dashboard.reviewTimeTrend": "Answer time",
  "dashboard.newCardsTrend": "New cards",
  "dashboard.srsDistribution": "Memory intervals",
  "dashboard.studyTime": "Study Time",
  "dashboard.configureMetrics": "Customize metrics",
  "dashboard.configureMetricsHint": "Choose what to show on your summary board. Hiding every study-time number hides that tile.",
  "dashboard.studyTimeWindowLabel": "Study Time window",
  "dashboard.allMetricsHidden": "All metrics are hidden — customize to show some again.",
  "dashboard.metricHidden": "Hidden",
  "dashboard.metricShow": "Show",
  "dashboard.metricHighlight": "Highlight",
  "dashboard.allCaughtUp": "All caught up — no cards due.",
  "common.due": "Due",
  "dashboard.thisWeek": "This week",
  "dashboard.lastWeek": "Last week",
  "dashboard.noCardsInSrs": "No cards in SRS yet.",
  "dashboard.cardsInSrs": "{n} cards in SRS",
  "dashboard.cardsInSrs_one": "{n} card in SRS",
  "srsBucket.learning": "Learning",
  "dashboard.futureDue": "Upcoming Reviews (Next {n} Days)",
  "chart.perWeek": "per week",
  "chart.thisWeekShort": "This",
  "chart.lastWeekShort": "Last",
  "chart.weeksAgoShort": "{n}w",
  "chart.dayShort": "{n}d",
  "chart.howYouAnswered": "How you answered",
  "chart.answersTitle": "{n} answers ({pct}% correct)",
  "chart.kpiAnswers": "Answers this week",
  "chart.kpiAccuracy": "Accuracy this week",
  "chart.kpiNewCards": "New cards this week",
  "chart.kpiAnswerTime": "Answer time",
  "chart.kpiDue": "Due in {n} days",
  "chart.vsLastWeek": "vs last week",
  "chart.noLastWeek": "nothing last week to compare",
  "chart.same": "same",
  "chart.points": "{n} pts",
  "chart.point": "1 pt",
  "chart.busiest": "{n} on the busiest day ({when})",
  "dashboard.noCardsDueSoon": "No cards due in the next {n} days.",
  "dashboard.noStudyData": "No study data yet.",
  "dashboard.noReviewGrades": "No graded review data yet.",
  "dashboard.noReviewTime": "No tracked review times yet.",
  "dashboard.gradeAgain": "Again / incorrect",
  "dashboard.gradeHard": "Hard",
  "dashboard.gradeMedium": "Good",
  "dashboard.gradeEasy": "Easy",
  "dashboard.gradeQuiz": "Quiz",
  "dashboard.gradeUngraded": "Ungraded",
  "dashboard.avgReviewDuration": "{duration} avg · {n} reviews",
  "dashboard.heatmapCellTooltip": "{date}: {duration} studied ({n} attempts)",
  "dashboard.heatmapCellTooltip_one": "{date}: {duration} studied ({n} attempt)",
  "dashboard.monthAbbrevs": "Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec",
  "dashboard.dayAbbrevs": "Sun,Mon,Tue,Wed,Thu,Fri,Sat",

  "form.name": "Name",
  "class.namePlaceholder": "e.g. Machine Learning",
  "class.level": "Level",
  "class.levelHint": "(optional — for sorting)",
  "class.levelPlaceholder": "Sort order (e.g. 1, 2, 3)",
  "form.color": "Color",
  "form.icon": "Icon",
  "form.title": "Title",
  "lesson.titlePlaceholder": "e.g. Week 1: Linear Regression",
  "lesson.format": "Format",
  "format.mcqPickerLabel": "Multiple Choice",
  "lesson.trueFalseSlash": "True / False",
  "card.term": "Term",
  "card.termPlaceholder": "e.g. Ridge regression",
  "form.previewColon": "Preview:",
  "card.definition": "Definition",
  "card.defPlaceholder": "e.g. $\\hat{\\beta} = (X^TX + \\lambda I)^{-1}X^Ty$",
  "mcq.question": "Question",
  "mcq.questionPlaceholder": "e.g. What loss does AdaBoost minimize?",
  "mcq.correctAnswer": "Correct Answer",
  "mcq.correctAnswerPlaceholder": "e.g. Exponential loss",
  "mcq.wrongAnswers": "Wrong Answers",
  "mcq.addChoice": "+ Add choice",
  "card.explanationOptional": "Explanation (optional)",
  "mcq.explanationPlaceholder": "Why is this answer correct? Why are the distractors wrong?",
  "tf.statement": "Statement",
  "tf.statementPlaceholder": "e.g. The Earth revolves around the Sun.",
  "tf.answer": "Answer",
  "tf.explanationPlaceholder": "Why is this true or false?",
  "imagedef.imageFront": "Image (front)",
  "imagedef.dropLabel": "Click or drag image here (JPEG, PNG, GIF, WebP · max 5 MB)",
  "imagedef.chooseImage": "Choose Image",
  "imagedef.definitionBack": "Definition (back)",
  "imagedef.defPlaceholder": "e.g. The Eiffel Tower, built 1889, Paris.",
  "bulk.pasteHere": "Paste cards here...",
  "bulk.addCards": "Add Cards",
  "bulkImport.title": "Bulk Import Lessons & Cards",
  "common.import": "Import",
  "delete.confirmTitle": "Confirm Delete",
  "confirm.archiveTitle": "Confirm Archive",
  "delete.areYouSure": "Are you sure?",
  "share.signInHint": "Sign in or create an account to save this class to your library.",
  "share.signInRegister": "Sign In / Register",
  "share.shareClass": "Share Class",
  "share.shareLink": "Share Link",
  "share.shareLinkDesc": "Anyone with this link can study and save a copy of this class.",
  "share.generateLink": "Generate Link",
  "share.inviteByNameEmail": "Invite by Name or Email",
  "share.inviteHint": "They'll see this class in their \"Shared with me\" section.",
  "common.copy": "Copy",
  "share.disableLink": "Disable link",
  "share.saveToMyClasses": "Save to My Classes",
  "share.usernameOrEmail": "Username or email...",
  "share.invite": "Invite",
  "share.peopleWithAccess": "People with Access",
  "share.noOneInvited": "No one invited yet.",
  "promptGuide.title": "AI Extraction Prompt",
  "promptGuide.desc": "Paste this prompt into any AI (ChatGPT, Claude, Gemini…) followed by your text to generate flashcards.",
  "keymap.title": "Keyboard Shortcuts",
  "keymap.sectionGlobal": "Global",
  "keymap.search": "Search",
  "keymap.saveCardModal": "Save (Add/Edit Card)",
  "keymap.toggleHelp": "Toggle this help",
  "keymap.goHome": "Go to Home (not while studying)",
  "keymap.closeGoBack": "Close / Go back",
  "keymap.navigateClasses": "Navigate classes",
  "keymap.openClassToggle": "Open class / toggle selection",
  "keymap.newClass": "New class",
  "keymap.dashboardOutsideSelect": "Dashboard (outside select mode)",
  "keymap.sectionClass": "Class",
  "keymap.navigateLessons": "Navigate lessons",
  "keymap.openLessonToggle": "Open lesson / toggle selection",
  "keymap.newLesson": "New lesson",
  "keymap.sectionLesson": "Lesson",
  "keymap.newCard": "New card",
  "keymap.bulkPaste": "Bulk paste",
  "keymap.startStudy": "Start study",
  "keymap.sectionSetup": "Study Setup",
  "keymap.selectPreset": "Select preset",
  "keymap.sectionFlashcards": "Flashcards",
  "keymap.prevNext": "Prev / Next",
  "keymap.flipCard": "Flip card",
  "keymap.pronounce": "Pronounce",
  "keymap.pronounceTerm": "Pronounce the term",
  "keymap.undoGrade": "Undo the last grade",
  "keymap.selectOption": "Select option",
  "keymap.sectionResultsEtc": "Results / Stats / Dashboard / Analytics",
  "keymap.retryResultsOnly": "Retry (Results only)",
  "keymap.toggleSelectMode": "Toggle select mode",
  "keymap.toggleSelectionSelectMode": "Toggle selection (select mode)",
  "keymap.selectAllSelectMode": "Select all (select mode)",
  "keymap.studySelectedSelectMode": "Study selected (select mode)",
  "keymap.deleteSelectedSelectMode": "Delete selected (select mode)",
  "search.noResults": "No results",
  "search.failed": "Search failed. Check your connection.",

  "bulkImport.hint": "Use <strong>#</strong> to start a lesson. Optionally add <code>| mcq</code> after the title for MCQ format (default is term→def).<br>Then list cards below it, one per line.<br><br><strong>Term→Def:</strong> <code>term | definition</code><br><strong>MCQ:</strong> <code>question | correct | wrong1 | wrong2 | wrong3</code><br><strong>MCQ + explanation:</strong> <code>question | correct | wrong1 ;; Why the correct answer is right.</code>",

  "class.newClass": "New Class",
  "lesson.newLesson": "New Lesson",
  "bulk.addCardsTitle": "Bulk Add Cards",
  "card.addCard": "Add Card",
  "card.editCard": "Edit Card",
  "lesson.hintTermDef": "Best for vocabulary, concepts, formulas. Bulk: term | definition",
  "lesson.hintMcq": "Best for exam prep. Bulk: question | correct | wrong1 [| wrong2…] [;; explanation]",
  "lesson.hintTrueFalse": "Best for T/F statements. Bulk: statement | true  or  statement | false [;; explanation]",
  "class.tags": "Tags",
  "class.tagsPlaceholder": "e.g. linear-algebra, exam-prep",
  "class.tagsHint": "Comma-separated",
  "class.suggestTags": "Suggest tags",
  "class.suggestingTags": "Suggesting…",
  "lesson.hintImageDef": "Image on front, text definition on back. Cards added one at a time (no bulk import).",
  "validate.enterClassName": "Please enter a class name.",
  "validate.enterLessonTitle": "Please enter a lesson title.",
  "validate.fillTermDef": "Please fill in both term and definition.",
  "validate.fillMcq": "Please fill in the question, correct answer, and 1–4 wrong answers.",
  "validate.enterStatement": "Please enter a statement.",
  "validate.selectTrueFalse": "Please select True or False.",
  "validate.unsupportedFileType": "Unsupported file type. Please use JPEG, PNG, GIF, or WebP.",
  "validate.chooseImageFirst": "Please choose an image first.",
  "validate.enterDefinition": "Please enter a definition.",
  "validate.levelMustBeNumber": "Level must be a number.",
  "share.savedToClasses": "\"{name}\" saved to your classes!",
  "common.failedToSave": "Failed to save",
  "lesson.pickerTermDef": "Term → Definition",
  "lesson.pickerImageDef": "Image → Definition",
  "bulk.hintTermDef": "One card per line: term | definition (or paste two spreadsheet columns)\nSupports LaTeX: $\\hat{\\beta}$ or $$\\sum_{i=1}^n x_i$$",
  "bulk.hintTrueFalse": "One card per line: statement | true  or  statement | false [;; explanation]",
  "bulk.hintMcq": "One card per line: question | correct | wrong1 [| wrong2 | wrong3 | wrong4]",

  "common.remove": "Remove",
  "share.failedToInvite": "Failed to invite",
  "common.classSingular": "Class",
  "common.lessonSingular": "Lesson",
  "common.cardSingular": "Card",
  "share.byOwner": "by {name}",
  "confirm.deleteSelectedCards": "Delete {n} cards? Your study history and stats are kept.",
  "confirm.deleteSelectedCards_one": "Delete {n} card? Your study history and stats are kept.",
  "confirm.deleteSelectedLessons": "Delete {n} lessons and all their cards? Your study history and stats are kept.",
  "confirm.deleteSelectedLessons_one": "Delete {n} lesson and all its cards? Your study history and stats are kept.",
  "card.imageAlt": "Card image",
  "study.reviewDue": "Quick quiz · {n} due",
  "study.reviewDueTitle": "Multiple-choice quiz on the cards due now (respects Max reviews per day)",
  "confirm.leaveTitle": "Leave this session?",
  "confirm.discardTitle": "Discard changes?",
  "confirm.discardChanges": "Your changes haven't been saved.",
  "confirm.discard": "Discard",
  "confirm.reviewTitle": "Mark as reviewed?",
  "validate.noLessonsFound": "No valid lessons found. Start each lesson with a # heading.",
  "bulk.noValidCards": "No valid cards found. Check the format.",
  "bulk.cardsDetected": "{n} cards detected",
  "bulk.cardsDetected_one": "{n} card detected",
  "bulk.linesSkipped": "{n} lines will be skipped:",
  "bulk.linesSkipped_one": "{n} line will be skipped:",
  "bulk.lineReason": "Line {n}: {reason}",
  "bulk.errNoSeparator": "no | or tab between the parts",
  "bulk.errEmptyPart": "one side is empty",
  "bulk.errMcqParts": "needs question | correct answer | at least one wrong answer",
  "bulk.errTfAnswer": "the answer must be true or false",
  "bulk.errNoLesson": "comes before any # lesson heading",
  "toast.archived": "Archived \"{name}\".",
  "toast.unarchived": "Unarchived \"{name}\".",
  "toast.archivedMany": "Archived {n} classes.",
  "toast.archivedMany_one": "Archived {n} class.",
  "toast.cardsAdded": "{n} cards added.",
  "toast.cardsAdded_one": "{n} card added.",
  "toast.lessonsImported": "Added {lessons} and {cards}.",
  "toast.signingOut": "Signing out…",
  "pref.backup": "Backup",
  "import.isFullBackup": "That's a full account backup, not a class export. Import here takes class exports (Export on a class or lesson).",
  "pref.backupHint": "Everything in your account, including study progress. To share one class, use Export on the class instead.",
  "pref.downloadBackup": "Download full backup",
  "share.disableLinkTitle": "Disable share link?",
  "share.disableLinkConfirm": "Anyone with the current link loses access. You can generate a new link later, but it will be a different one.",
  "search.inputPlaceholder": "Search classes, lessons, cards…",
  "search.queryLabel": "Search query",
  "search.resultsLabel": "Search results",
  "error.requestFailed": "Something went wrong ({status}). Try again.",
  "error.rateLimited": "Too many requests. Try again later.",
  "error.missingFields": "Please fill in all fields.",
  "error.passwordTooShort": "Password must be at least 6 characters.",
  "error.emailTaken": "That email is already registered.",
  "error.invalidCredentials": "Invalid email or password.",
  "error.googleAccount": "This account uses Google sign-in. Use \"Sign in with Google\" instead.",
  "error.resetInvalid": "This reset link is invalid or has expired.",
  "error.linkInvalid": "This link is invalid or has expired.",
  "error.alreadyOwned": "You already own this class.",
  "error.userNotFound": "No user with that name or email.",
  "error.cannotInviteSelf": "You can't invite yourself.",
  "error.alreadyShared": "That user already has access.",
  "error.tokenLimit": "Token limit reached. Revoke one first.",
  "error.alreadyFetched": "This word has already been fetched.",
  "error.noCardsToAnalyze": "This class has no cards to analyze yet.",
  "error.aiNotConfigured": "AI tag suggestions aren't set up on this server.",
  "error.aiFailed": "AI tag suggestion failed. Try again.",
  "confirm.leaveSession": "You've answered {n} so far, and those are saved. Leave now?",
  "keymap.quizNext": "Next question (after answering)",
  "keymap.exitStudy": "Exit (asks first mid-session)",
  "mcq.wrongAnswerPlaceholder": "Wrong answer",
  "mcq.removeWrongAnswer": "Remove wrong answer",
  "validate.imageUploadRequiresServer": "Image upload requires server mode.",
  "validate.fileTooLarge": "File exceeds 5 MB limit.",
  "error.uploadFailed": "Upload failed",
  "error.uploadFailedWithMessage": "Upload failed: {message}",
  "error.aiSuggestFailedWithMessage": "Couldn't suggest tags: {message}",
  "study.noCardsMatchFilter": "No cards match the selected filter.",
  "setup.reviewCapReached": "{due} cards are due, but today's review limit is used up ({done}/{cap}). Raise Max reviews per day in Preferences to keep going.",
  "common.copied": "Copied!",
  "promptGuide.copyPrompt": "Copy Prompt",
  "tts.testPhrase": "This is a test of the speed setting.",
  "common.releaseToRefresh": "Release to refresh",
  "alert.noLessonsInSelectedClasses": "The selected classes have no lessons.",
  "quiz.exit": "Exit quiz",
  "quiz.scoreTitle": "{n} correct of {total} answered",
  "quiz.layoutGrid": "Show answers side by side",
  "quiz.layoutList": "Show answers in a list",
  "quiz.cappedHint": "Correct — but this card needs a Flashcard-mode recall to move to a longer review interval.",
  "study.notDueHint": "This card isn't due yet, so your answer didn't change its schedule.",
  "study.explanation": "Explanation",
  "keymap.reviewPrevNext": "Review prev / next answered question"
});
Object.assign(TRANSLATIONS.vi, {
  "common.close": "Đóng",
  "common.cancel": "Hủy",
  "common.save": "Lưu",
  "common.saving": "Đang lưu…",
  "toast.saveFailed": "Không lưu được: {message}",
  "toast.offlineQueued": "Bạn đang ngoại tuyến. Câu trả lời được giữ trên thiết bị này và sẽ đồng bộ khi có kết nối lại.",
  "toast.synced": "Đã đồng bộ {n} câu trả lời đã lưu.",
  "pref.title": "Tùy chọn",
  "tutorial.title": "Hướng dẫn nhanh",
  "tutorial.preferenceLabel": "Bắt đầu sử dụng",
  "tutorial.replay": "Xem hướng dẫn",
  "tutorial.skip": "Bỏ qua",
  "tutorial.back": "Trước",
  "tutorial.next": "Tiếp",
  "tutorial.finish": "Hoàn tất",
  "tutorial.stepCount": "Bước {step}/{total}",
  "tutorial.step1Title": "Sắp xếp các môn học",
  "tutorial.step1Body": "Tạo một lớp cho môn học, sau đó mở lớp để thêm bài học. Bạn cũng có thể bắt đầu từ một lớp được chia sẻ.",
  "tutorial.step2Title": "Thêm nội dung cần học",
  "tutorial.step2Body": "Trong bài học, thêm từng thẻ hoặc dán nhiều thẻ cùng lúc. Chọn định dạng phù hợp với tài liệu của bạn.",
  "tutorial.step3Title": "Học với thẻ ghi nhớ",
  "tutorial.step3Body": "Mở bài học và chọn Học. Lật thẻ để tự nhớ đáp án hoặc dùng Trắc nghiệm để luyện nhận diện.",
  "tutorial.step4Title": "Theo dõi tiến độ",
  "tutorial.step4Body": "Đánh giá mức độ nhớ của bạn. Hệ thống sẽ lên lịch ôn tập, còn mục Thống kê giúp bạn xem tiến độ. Mặc định chỉ câu trả lời ở chế độ Thẻ ghi nhớ mới được tính vào tiến độ — bật Trả lời Trắc nghiệm được tính là Đã thuộc trong Tùy chọn để tính cả câu trả lời Trắc nghiệm.",
  "tutorial.step5Title": "Lưu từ tiếng Anh mới",
  "tutorial.step5Body": "Khi học ở chế độ máy chủ, chọn một từ hoặc cụm từ ở một trong hai mặt thẻ, hoặc trong câu hỏi, phần giải thích hay đáp án Trắc nghiệm sau khi đã trả lời, rồi chọn Lưu làm từ vựng tiếng Anh. Mở mục Từ vựng trong FlashcardApp để thêm hoặc xoá từ đang chờ. Trong KnowledgeApp, chọn Fetch words để tạo định nghĩa và câu ví dụ.",
  "pref.textSize": "Cỡ chữ",
  "pref.theme": "Giao diện",
  "pref.themeLight": "Sáng",
  "pref.themeDark": "Tối",
  "pref.themeSystem": "Theo thiết bị",
  "pref.palette": "Màu giao diện",
  "pref.highContrast": "Độ tương phản cao",
  "pref.highContrastHint": "Chỉ ở chế độ tối: chữ sáng hơn và màu rực hơn trên trang và cả hai mặt thẻ.",
  "pref.palette.parchment": "Giấy ngà",
  "pref.palette.sage": "Xanh xô thơm",
  "pref.palette.slate": "Xám đá",
  "pref.palette.sepia": "Nâu sepia",
  "pref.palette.plum": "Tím mận",
  "pref.palette.harbour": "Xanh cảng biển",
  "pref.palette.serika": "Serika",
  "pref.palette.nord": "Nord",
  "pref.palette.gruvbox": "Gruvbox",
  "pref.palette.solarized": "Solarized",
  "pref.palette.catppuccin": "Catppuccin",
  "pref.palette.rosepine": "Rosé Pine",
  "pref.palette.everforest": "Everforest",
  "pref.palette.tokyonight": "Tokyo Night",
  "pref.palette.dracula": "Dracula",
  "pref.haptics": "Phản hồi rung",
  "pref.sounds": "Hiệu ứng âm thanh",
  "pref.soundsHint": "Tiếng marimba khi câu trả lời trắc nghiệm hoặc câu gõ lại đúng, tiếng gõ trầm khi sai.",
  "pref.hapticsUnsupported": "Trình duyệt này không rung được — iPhone và iPad thì không bao giờ rung. Tùy chọn vẫn được đồng bộ sang các thiết bị Android của bạn.",
  "pref.quizCountsAsKnown": "Trả lời Trắc nghiệm được tính là Đã thuộc",
  "pref.quizCountsAsKnownHint": "Trả lời đúng khi làm Trắc nghiệm được tính là Đã thuộc (đánh dấu thẻ đã thuộc và xếp lịch ôn như Thẻ ghi nhớ); trả lời sai được tính là Đang học. Tắt: thẻ chỉ tiến bộ qua chế độ Thẻ ghi nhớ.",
  "pref.language": "Ngôn ngữ",
  "pref.speed": "Tốc độ",
  "pref.testSpeed": "Nghe thử tốc độ",
  "pref.maxReviewsPerDay": "Số lượt ôn tối đa mỗi ngày",
  "pref.noLimit": "Không giới hạn",
  "pref.maxReviewsInvalid": "Nhập số nguyên từ 0 trở lên, hoặc để trống nếu không giới hạn.",
  "pref.apiTokens": "Mã API",
  "pref.apiTokensHint": "Cho phép KnowledgeApp gửi cập nhật thẻ vào tài khoản của bạn.",
  "pref.tokenName": "Tên mã",
  "pref.createToken": "Tạo mã",
  "pref.tokenCopyOnce": "Hãy sao chép mã này ngay — mã sẽ không hiển thị lại.",
  "pref.copy": "Sao chép",
  "pref.copied": "Đã sao chép",
  "pref.revoke": "Thu hồi",
  "pref.lastUsed": "Dùng lần cuối {date}",
  "pref.neverUsed": "Chưa dùng",
  "pref.noTokens": "Chưa có mã",
  "upstream.updated": "Đã cập nhật — cần xem lại",
  "upstream.deleted": "Đã bị xoá ở nguồn",
  "upstream.showPrevious": "Xem bản trước",
  "upstream.hidePrevious": "Ẩn bản trước",
  "upstream.previous": "Bản trước",
  "upstream.markReviewed": "Đánh dấu đã xem",
  "upstream.navTitle": "Cập nhật",
  "upstream.screenTitle": "Thay đổi từ KnowledgeApp",
  "upstream.bannerText": "{n} thẻ đã bị KnowledgeApp thay đổi",
  "upstream.review": "Xem lại",
  "upstream.summary": "{n} thẻ cần xem lại · {updated} đã cập nhật · {deleted} đã xoá ở nguồn",
  "upstream.empty": "Không có thẻ nào bị KnowledgeApp thay đổi.",
  "upstream.noneInFilter": "Không có thẻ nào trong bộ lọc này.",
  "upstream.filterAll": "Tất cả",
  "upstream.filterUpdated": "Đã cập nhật",
  "upstream.filterDeleted": "Đã xoá ở nguồn",
  "upstream.current": "Hiện tại",
  "upstream.openInLesson": "Mở trong bài học",
  "upstream.markAllShown": "Đánh dấu tất cả đang hiện là đã xem",
  "upstream.confirmAckAll": "Đánh dấu {n} thẻ là đã xem?",
  "upstream.studyUpdated": "Học các thẻ đã cập nhật",
  "upstream.markedOne": "Đã đánh dấu “{name}” là đã xem.",
  "upstream.markedMany": "Đã đánh dấu {n} thẻ là đã xem: {names}",
  "vocabulary.nav": "Từ vựng",
  "vocabulary.screenTitle": "Hàng chờ từ vựng",
  "vocabulary.subtitle": "Xem lại các từ đã lưu trước khi KnowledgeApp tải chúng.",
  "vocabulary.loading": "Đang tải hàng chờ từ vựng…",
  "vocabulary.noPending": "Không có từ nào đang chờ KnowledgeApp.",
  "vocabulary.pendingCount": "{n} từ đang chờ KnowledgeApp",
  "vocabulary.add": "Thêm từ",
  "vocabulary.addTitle": "Thêm từ vào hàng chờ",
  "vocabulary.wordLabel": "Từ hoặc cụm từ",
  "vocabulary.wordPlaceholder": "vd: resilient",
  "vocabulary.contextLabel": "Ngữ cảnh (không bắt buộc)",
  "vocabulary.contextPlaceholder": "Câu hoặc ghi chú giúp làm rõ nghĩa",
  "vocabulary.source": "Từ {class} › {lesson}",
  "vocabulary.deleteConfirm": "Xóa ‘{word}’ khỏi hàng chờ từ vựng?",
  "vocabulary.enterWord": "Hãy nhập một từ hoặc cụm từ.",
  "vocabulary.addError": "Không thể thêm từ: {message}",
  "vocabulary.deleteError": "Không thể xóa từ: {message}",
  "vocabulary.alreadyFetched": "Từ này đã được KnowledgeApp tải.",
  "vocabulary.duplicatePending": "‘{word}’ đã có trong hàng chờ với cùng ngữ cảnh. Thêm ngữ cảnh khác để lưu nghĩa khác.",
  "vocabulary.duplicateFetched": "‘{word}’ đã có trong bộ từ vựng với cùng ngữ cảnh. Thêm ngữ cảnh khác để lưu nghĩa khác.",
  "setup.updated": "Đã cập nhật",
  "setup.hintUpdated": "Thẻ KnowledgeApp đã thay đổi kể từ lần bạn xem lại gần nhất",

  "nav.home": "Trang chủ",
  "nav.dashboard": "Bảng điều khiển",
  "dashboard.tabOverview": "Tổng quan",
  "dashboard.tabCharts": "Biểu đồ",
  "dashboard.tabLessons": "Bài học",
  "dashboard.needsAttention": "Cần chú ý",
  "dashboard.allLessons": "Tất cả bài học →",
  "dashboard.filterAll": "Tất cả",
  "dashboard.colLesson": "Bài học",
  "dashboard.colAccuracy": "Độ chính xác",
  "dashboard.colAnswers": "Câu trả lời",
  "dashboard.colMastered": "Thành thạo",
  "dashboard.colDue": "Đến hạn",
  "dashboard.struggling": "Đang gặp khó",
  "dashboard.strugglingHint": "{pct}% thẻ đã trả lời là thẻ khó, {n} ngày qua",
  "dashboard.lessonsNote": "Độ chính xác và câu trả lời: toàn bộ. Thành thạo và đến hạn: hiện tại. Đang gặp khó: {n} ngày qua.",
  "dashboard.nothingNeedsAttention": "Không có gì cần chú ý: không có thẻ đến hạn và không có bài đang gặp khó.",
  "dashboard.noLessons": "Chưa có bài học nào.",
  "dashboard.dueNow": "Đến hạn",
  "dashboard.cardsDue": "thẻ đến hạn",
  "dashboard.moreLessonsDue": "+{n} bài khác",
  "dashboard.dueLater": "{n} thẻ nữa đến hạn trong {days} ngày tới",
  "dashboard.achAll": "Tất cả →",
  "ach.nav": "Thành tích",
  "ach.filterAll": "Tất cả",
  "ach.earnedCount": "Đã đạt {n} / {total}",
  "ach.earnedOn": "Đạt ngày {date}",
  "ach.wasEarned": "từng đạt",
  "ach.waiting": "{n} thẻ đang chờ",
  "ach.notYet": "Chưa có",
  "ach.goalOff": "Mục tiêu ngày đang tắt",
  "ach.next": "Tiếp theo: {name} · {tier}",
  "ach.allLink": "Tất cả thành tích →",
  "ach.allEarned": "Bạn đã đạt mọi thành tích.",
  "ach.keepGoing": "Tiếp tục học để bắt đầu thành tích kế tiếp.",
  "ach.tier1": "đồng",
  "ach.tier2": "bạc",
  "ach.tier3": "vàng",
  "ach.earnedLine": "Đạt {name}",
  "ach.earnedTierLine": "{name} · {tier}, {threshold}",
  "ach.newCount": "{n} mới",
  "ach.loadFailed": "Không tải được thành tích.",
  "ach.progress": "{cur} / {target} {unit}",
  "ach.progressPct": "{cur}% / {target}%",
  "ach.count": "{n} {unit}",
  "ach.unit.days": "ngày",
  "ach.unit.lessons": "bài",
  "ach.unit.cards": "thẻ",
  "ach.unit.words": "từ",
  "ach.unit.typed": "lần gõ",
  "ach.unit.hours": "giờ",
  "ach.unit.fixes": "lần sửa",
  "ach.unit.weeks": "tuần",
  "ach.unit.reviews": "lượt ôn",
  "ach.unit.min": "phút",
  "ach.unit.classes": "lớp",
  "ach.group.showingUp": "Chuyên cần",
  "ach.group.mastery": "Thành thạo",
  "ach.group.effort": "Nỗ lực",
  "ach.group.method": "Cách học",
  "ach.group.curiosity": "Khám phá",
  "ach.dayStreak.name": "Chuỗi ngày",
  "ach.dayStreak.desc": "Học liên tục nhiều ngày. Tính chuỗi dài nhất của bạn.",
  "ach.daysStudied.name": "Số ngày học",
  "ach.daysStudied.desc": "Tổng số ngày bạn đã học.",
  "ach.goalKeeper.name": "Giữ mục tiêu",
  "ach.goalKeeper.desc": "Đạt mục tiêu ngày nhiều ngày liên tiếp.",
  "ach.aboveAverage.name": "Vượt mức trung bình",
  "ach.aboveAverage.desc": "Học lâu hơn mức trung bình 30 ngày, ngày này qua ngày khác.",
  "ach.comeback.name": "Trở lại",
  "ach.comeback.desc": "Quay lại sau một tuần trở lên, rồi học ba ngày liền.",
  "ach.steadyRhythm.name": "Nhịp đều đặn",
  "ach.steadyRhythm.desc": "Học năm ngày mỗi tuần, bốn tuần liền.",
  "ach.dueZero.name": "Không còn thẻ đến hạn",
  "ach.dueZero.desc": "Ôn hết thẻ đến hạn, nhiều ngày liên tiếp.",
  "ach.classMastered.name": "Thành thạo một lớp",
  "ach.classMastered.desc": "Mọi thẻ trong một lớp đều thành thạo: hạn ôn từ 21 ngày trở lên.",
  "ach.lessonMastered.name": "Thành thạo bài học",
  "ach.lessonMastered.desc": "Số bài có mọi thẻ đều thành thạo.",
  "ach.longTermCards.name": "Thẻ trong trí nhớ dài hạn",
  "ach.longTermCards.desc": "Số thẻ thành thạo: hạn ôn từ 21 ngày trở lên.",
  "ach.longMemory.name": "Trí nhớ bền",
  "ach.longMemory.desc": "Đúng 90% trong 50 lượt ôn gần nhất của thẻ đã một tháng không gặp.",
  "ach.vocabInUse.name": "Từ vựng đã thuộc",
  "ach.vocabInUse.desc": "Số từ bạn đã lưu và nay đã thành thạo.",
  "ach.toughOne.name": "Chinh phục thẻ khó",
  "ach.toughOne.desc": "Thẻ bị đánh dấu Đang học ba lần, sau đó trả lời Rất chắc chắn.",
  "ach.leechCleared.name": "Vượt qua thẻ dai dẳng",
  "ach.leechCleared.desc": "Một thẻ đã quên tám lần, nay trở lại ôn tập.",
  "ach.recallCleared.name": "Hết thẻ cần nhớ lại",
  "ach.recallCleared.desc": "Mục Cần nhớ lại trống: không còn thẻ chỉ đúng qua trắc nghiệm đến hạn.",
  "ach.writer.name": "Người viết",
  "ach.writer.desc": "Số câu trả lời gõ trong chế độ Viết.",
  "ach.deepSession.name": "Phiên học sâu",
  "ach.deepSession.desc": "Một phiên từ 25 phút trở lên, không nghỉ quá 10 phút.",
  "ach.hoursStudied.name": "Số giờ học",
  "ach.hoursStudied.desc": "Thời gian bạn đã trả lời thẻ.",
  "ach.recallFirst.name": "Nhớ lại hơn nhận diện",
  "ach.recallFirst.desc": "Một tuần từ 30 câu trả lời, 70% là thẻ ghi nhớ thay vì trắc nghiệm.",
  "ach.mixedPractice.name": "Luyện tập xen kẽ",
  "ach.mixedPractice.desc": "Một phiên trộn từ ba lớp trở lên.",
  "ach.secondLook.name": "Xem lại",
  "ach.secondLook.desc": "Quay lại một câu trắc nghiệm bạn đã trả lời sai.",
  "ach.cardFixer.name": "Sửa thẻ",
  "ach.cardFixer.desc": "Sửa một thẻ ngay khi đang học.",
  "ach.wordCollector.name": "Sưu tầm từ",
  "ach.wordCollector.desc": "Số từ đã lưu vào hộp từ vựng.",
  "ach.explorer.name": "Nhà khám phá",
  "ach.explorer.desc": "Học từ ba lớp trở lên trong một tuần.",
  "ach.builder.name": "Người tạo thẻ",
  "ach.builder.desc": "Số thẻ bạn tự tạo.",
  "ach.fromTheBook.name": "Từ trong sách",
  "ach.fromTheBook.desc": "Học một thẻ tạo từ sách trong KnowledgeApp.",
  "ach.freshStart.name": "Khởi đầu mới",
  "ach.freshStart.desc": "Số thẻ bạn tạo đã chuyển sang ôn tập.",
  "nav.selectClasses": "Chọn lớp",
  "sidebar.yourClasses": "Lớp của bạn",
  "sidebar.newClass": "Lớp mới",
  "sidebar.toggle": "Đóng/mở thanh bên",
  "common.pullToRefresh": "Kéo để làm mới",
  "common.select": "Chọn",
  "common.selectAll": "Chọn tất cả",
  "common.study": "Học",
  "search.titleHint": "Tìm kiếm (Ctrl+K)",
  "search.label": "Tìm kiếm",
  "search.placeholder": "Tìm thẻ ghi nhớ",
  "user.account": "Tài khoản",
  "user.linkGoogle": "Liên kết tài khoản Google",
  "user.signOut": "Đăng xuất",
  "home.selectClasses": "Chọn lớp",
  "home.classesSelectedCount": "Đã chọn {n} lớp",
  "home.emptyDefault": "Chưa có lớp nào. Tạo lớp đầu tiên để bắt đầu.",
  "sort.sortBy": "Sắp xếp theo",
  "sort.level": "Cấp độ",
  "sort.nameAZ": "Tên (A–Z)",
  "sort.dueCount": "Số thẻ cần ôn",
  "sort.dateAdded": "Ngày thêm",
  "sort.lastActivity": "Hoạt động gần nhất",
  "sort.toggleDirection": "Đổi chiều sắp xếp",
  "home.tagFilterToggle": "Lọc theo nhãn",
  "archive.showArchived": "Hiện lớp đã lưu trữ",
  "archive.archived": "Đã lưu trữ",
  "view.grid": "Xem dạng lưới",
  "view.list": "Xem dạng danh sách",
  "share.sharedWithMe": "Được chia sẻ với tôi",

  "common.loading": "Đang tải...",
  "common.archive": "Lưu trữ",
  "common.unarchive": "Bỏ lưu trữ",
  "common.edit": "Sửa",
  "common.delete": "Xóa",
  "home.emptyArchived": "Không có lớp nào đã lưu trữ.",
  "count.due": "{n} thẻ cần ôn",
  "count.lessons": "{n} bài học",
  "count.knownProgress": "{known} / {total} đã thuộc ({pct}%)",
  "mastery.text": "Thành thạo {pct}%",
  "mastery.tooltip": "Thành thạo {mastered} · Đã nhớ {remembered} · Đang học {learning} · Mới {fresh}. Thành thạo: lần ôn tới cách 21 ngày trở lên. Đã đánh dấu thuộc: {flagged} / {total}.",
  "class.levelMeta": "Bậc {level} · {lessons}",
  "class.knownTooltip": "Số thẻ bạn đã tự đánh dấu \"Đã thuộc\" trong chế độ Thẻ ghi nhớ",
  "class.complete": "Hoàn thành",
  "class.completeTooltip": "Mọi thẻ trong lớp này đều đã thuộc",
  "class.accuracyTooltip": "Độ chính xác trên toàn bộ lượt trả lời đã ghi nhận (Thẻ ghi nhớ + Trắc nghiệm)",
  "confirm.deleteClass": "Xóa lớp \"{name}\" cùng toàn bộ bài học và thẻ ghi nhớ? Lịch sử và thống kê học tập vẫn được giữ lại.",
  "confirm.archiveClasses": "Lưu trữ {n} lớp đã chọn?",
  "alert.archiveClassesFailed": "Không thể lưu trữ một số lớp. Các lựa chọn của bạn vẫn được giữ lại.",

  "stat.dayStreak": "Ngày liên tục",
  "stat.streakResetsIn": "Đặt lại sau {time}",
  "stat.restDayAvailable": "Hôm nay có thể nghỉ",
  "stat.restDayHint": "Mỗi tuần được nghỉ một ngày mà vẫn giữ chuỗi. Học hôm nay để để dành ngày nghỉ.",
  "goal.progress": "{done} / {goal} thẻ hôm nay",
  "goal.left": "Còn {n} thẻ để đạt mục tiêu ngày",
  "goal.met": "Đã đạt mục tiêu hôm nay. Học thêm là điểm cộng.",
  "week.label": "Tuần này",
  "week.done": "Đã học",
  "week.rest": "Ngày nghỉ: chuỗi vẫn được giữ",
  "week.missed": "Bỏ lỡ",
  "week.today": "Hôm nay",
  "week.future": "Sắp tới",
  "week.restHint": "❄ Mỗi tuần được nghỉ một ngày mà chuỗi vẫn giữ.",
  "pref.dailyGoal": "Mục tiêu mỗi ngày",
  "pref.dailyGoalOff": "Tắt",
  "pref.dailyGoalHint": "Số thẻ cần trả lời mỗi ngày, hiện thành vòng tròn ở Trang chủ. Tính cả thẻ ghi nhớ và câu trắc nghiệm.",
  "stat.streakResetsAtHint": "Ngày tính chuỗi học của bạn được đặt lại vào lúc 00:00 UTC, không phải nửa đêm giờ địa phương.",
  "stat.classes": "Lớp học",
  "stat.lessons": "Bài học",
  "stat.cards": "Thẻ ghi nhớ",
  "stat.sessions": "Phiên học",
  "stat.sessionsHint": "Chỉ tính các phiên Trắc nghiệm đã hoàn thành — học Thẻ ghi nhớ được tính trong Lượt làm.",
  "stat.attempts": "Lượt làm",
  "stat.avgDailyLabel": "TB/ngày",
  "stat.minDailyLabel": "Thấp nhất",
  "stat.maxDailyLabel": "Cao nhất",
  "stat.studyTimeTrackedHint": "Dựa trên {n} ngày có ghi nhận thời gian học — các ngày học trước khi tính năng này ra mắt không được tính",
  "stat.studyTimeWindowHint": "{n} ngày gần nhất",
  "stat.allTime": "Toàn thời gian",
  "dashboard.heatmapTitle": "Biểu đồ học {n} ngày qua",

  "auth.signIn": "Đăng nhập",
  "auth.createAccount": "Tạo tài khoản",
  "auth.continueWithGoogle": "Tiếp tục với Google",
  "common.or": "hoặc",
  "auth.email": "Email",
  "auth.emailPlaceholder": "you@example.com",
  "auth.password": "Mật khẩu",
  "auth.forgotPassword": "Quên mật khẩu?",
  "auth.name": "Tên",
  "auth.namePlaceholder": "Tên của bạn",
  "auth.minChars": "Tối thiểu 6 ký tự",
  "auth.forgotHint": "Nhập email của bạn, chúng tôi sẽ gửi liên kết đặt lại mật khẩu.",
  "auth.sendResetLink": "Gửi liên kết đặt lại",
  "auth.resetHint": "Chọn mật khẩu mới cho tài khoản của bạn.",
  "auth.newPassword": "Mật khẩu mới",
  "auth.confirmPassword": "Xác nhận mật khẩu",
  "auth.repeatPassword": "Nhập lại mật khẩu",
  "auth.setNewPassword": "Đặt mật khẩu mới",
  "auth.backToSignIn": "Quay lại đăng nhập",
  "auth.loginFailed": "Đăng nhập thất bại",
  "common.networkError": "Lỗi kết nối mạng",
  "common.refreshing": "Đang làm mới…",
  "auth.registrationFailed": "Đăng ký thất bại",
  "auth.enterEmail": "Vui lòng nhập email của bạn",
  "auth.devResetLink": "Chế độ dev — liên kết đặt lại: {url}",
  "auth.resetLinkSent": "Nếu email này tồn tại, liên kết đặt lại mật khẩu đã được gửi. Hãy kiểm tra hộp thư của bạn.",
  "auth.minCharsError": "Mật khẩu phải có ít nhất 6 ký tự",
  "auth.passwordsNoMatch": "Mật khẩu không khớp",
  "auth.resetFailed": "Đặt lại mật khẩu thất bại",
  "auth.googleCancelled": "Đăng nhập Google đã bị hủy.",
  "auth.googleFailed": "Đăng nhập Google thất bại. Vui lòng thử lại.",
  "auth.googleAlreadyLinked": "Tài khoản Google này đã được liên kết với người dùng khác.",
  "auth.genericError": "Lỗi xác thực.",

  "common.back": "Quay lại",
  "common.moreOptions": "Thêm tùy chọn",
  "common.stats": "Thống kê",
  "common.share": "Chia sẻ",
  "common.export": "Xuất dữ liệu",
  "import.invalidJson": "Tệp này không phải JSON hợp lệ.",
  "import.success": "Đã nhập {classes}, {lessons}, {cards}.",
  "count.classes": "{n} lớp",
  "common.zeroSelected": "Đã chọn 0",
  "common.nSelected": "Đã chọn {n}",
  "common.deleteSelected": "Xóa mục đã chọn",
  "common.shuffle": "Xáo trộn",
  "class.editClass": "Sửa lớp",
  "class.archiveClass": "Lưu trữ lớp",
  "class.aiPromptGuide": "Hướng dẫn Prompt AI",
  "class.bulkImport": "Nhập hàng loạt",
  "class.newLesson": "+ Bài học",
  "class.emptyLessons": "Chưa có bài học nào. Thêm bài học vào lớp này.",
  "lesson.studySelected": "Học mục đã chọn",
  "lesson.editLesson": "Sửa bài học",
  "lesson.addCard": "+ Thêm thẻ",
  "lesson.bulkAdd": "+ Thêm hàng loạt",
  "lesson.reviewDueZero": "Trắc nghiệm nhanh · 0 thẻ đến hạn",
  "lesson.emptyCards": "Chưa có thẻ nào. Thêm thẻ để bắt đầu học.",
  "sort.lastStudied": "Học gần nhất",
  "sort.lastCardAdded": "Thẻ thêm gần nhất",
  "setup.title": "Thiết lập học",
  "setup.cardCount": "Số lượng thẻ",
  "setup.all": "Tất cả",
  "setup.filter": "Bộ lọc",
  "setup.allCards": "Tất cả thẻ",
  "setup.dueOnly": "Chỉ thẻ đến hạn",
  "setup.needsRecall": "Cần nhớ lại",
  "setup.stillLearning": "Đang học",
  "setup.mode": "Chế độ",
  "setup.flashcards": "Thẻ ghi nhớ",
  "setup.flashcardWrite": "Thẻ & Viết",
  "setup.quiz": "Trắc nghiệm",
  "setup.cardOrder": "Thứ tự thẻ",
  "setup.inOrder": "Theo thứ tự",
  "setup.startStudying": "Bắt đầu học",
  "setup.studyCount": "Học {n} thẻ",
  "setup.studyCountOf": "Học {n}/{total} thẻ khớp bộ lọc",
  "setup.loadFailed": "Không tải được thẻ — thử lại nhé.",
  "setup.studyingTogether": "Đang học {n} bài học cùng lúc",
  "setup.hintAll": "Học tất cả thẻ",
  "setup.hintDue": "Chỉ thẻ đến hạn ôn tập (SRS)",
  "setup.hintNeedsRecall": "Thẻ bạn mới chỉ nhận diện đúng trong bài Trắc nghiệm, chưa từng tự nhớ lại — trả lời ở chế độ Thẻ ghi nhớ để xác nhận bạn thực sự thuộc",
  "setup.hintLearning": "Thẻ chưa thuộc / đang học",
  "setup.hintFlashcardMode": "Tự nhớ lại trước khi lật thẻ — tín hiệu ghi nhớ mạnh nhất cho lặp lại ngắt quãng.",
  "setup.hintFlashcardWriteMode": "Gõ đáp án trước khi lật thẻ, rồi lật để so sánh — thêm một bước viết ra bên cạnh việc nhớ lại.",
  "setup.hintQuizMode": "Nhanh hơn, nhưng nhận ra đáp án khác với tự nhớ lại — thẻ cần một lần trả lời đúng ở chế độ Thẻ ghi nhớ để chuyển sang khoảng ôn dài hơn.",
  "setup.hintQuizModeKnown": "Nhanh hơn — với tùy chọn đang bật, trả lời đúng được tính là Đã thuộc, trả lời sai được tính là Đang học.",
  "setup.newCardEstimateLabel": "Số thẻ mới nên học hôm nay",
  "dashboard.newCardsShortLabel": "Thẻ mới gợi ý",
  "dashboard.futureDueTodayHint": "Bao gồm cả thẻ đã đến hạn hoặc quá hạn",
  "setup.newCardEstimateDefaultNote": "Ước tính mặc định — chưa được cá nhân hóa. Học thêm để hệ thống điều chỉnh theo nhịp độ của bạn.",
  "setup.newCardEstimateZeroNote": "Độ chính xác của bạn giảm trong tuần qua — hãy tập trung ôn lại các thẻ đã học trước khi thêm thẻ mới.",
  "setup.newCardEstimatePersonalizedNote": "Dựa trên lịch sử học tập và độ chính xác gần đây của bạn.",
  "setup.newCardEstimateNoneLeft": "Không còn thẻ mới nào — bạn đã học hết rồi!",
  "setup.presets": "Bộ lọc đã lưu",
  "setup.presetNamePlaceholder": "Tên bộ lọc",
  "setup.savePreset": "+ Lưu lựa chọn hiện tại",
  "setup.deletePresetConfirm": "Xóa bộ lọc \"{name}\"?",
  "setup.managePresets": "Quản lý bộ lọc",
  "setup.managePresetsTitle": "Quản lý bộ lọc đã lưu",
  "setup.noPresetsYet": "Chưa có bộ lọc nào được lưu.",
  "setup.moveUp": "Di chuyển lên",
  "setup.moveDown": "Di chuyển xuống",
  "setup.renamePreset": "Đổi tên",
  "setup.updatePresetHint": "Cập nhật theo lựa chọn hiện tại",
  "setup.presetUpdated": "Đã cập nhật!",
  "setup.interleaved": "Xen kẽ",

  "count.cardsDueForReview": "{n} thẻ đến hạn ôn tập",
  "lesson.nextReviewIn": "Ôn tập tiếp theo sau {time}",
  "format.termDef": "Thuật ngữ↔Định nghĩa",
  "format.mcq": "Trắc nghiệm",
  "format.trueFalse": "Đúng/Sai",
  "format.imageDef": "Hình↔Định nghĩa",
  "count.cards": "{n} thẻ",
  "confirm.deleteLesson": "Xóa bài học \"{title}\" cùng toàn bộ thẻ ghi nhớ? Lịch sử và thống kê học tập vẫn được giữ lại.",
  "alert.noCardsDue": "Hiện chưa có thẻ nào đến hạn ôn tập.",
  "alert.dailyReviewCapReached": "Bạn đã đạt giới hạn ôn tập hôm nay — quay lại vào ngày mai nhé!",
  "bulk.andMore": "... và {n} mục nữa",
  "bulk.summary": "{lessons}, tổng {cards}",
  "class.unarchiveClass": "Bỏ lưu trữ lớp",

  "time.never": "chưa bao giờ",
  "time.justNow": "vừa xong",
  "time.minutesAgo": "{n} phút trước",
  "time.hoursAgo": "{n} giờ trước",
  "time.daysAgo": "{n} ngày trước",
  "time.weeksAgo": "{n} tuần trước",
  "time.notScheduled": "chưa lên lịch",
  "time.now": "ngay bây giờ",
  "time.today": "Hôm nay",
  "time.inMinutes": "còn {n} phút",
  "unit.s": "{n} giây",
  "unit.min": "{n} phút",
  "unit.lessThanMin": "<1 phút",
  "unit.h": "{n} giờ",
  "unit.hMin": "{h} giờ {m} phút",
  "unit.d": "{n} ngày",
  "unit.mo": "{n} tháng",
  "unit.y": "{n} năm",
  "time.inHours": "còn {n} giờ",
  "time.inDays": "còn {n} ngày",
  "card.lastSeen": "Lần xem gần nhất",
  "card.lastStudied": "Học gần nhất",
  "card.nextReview": "Lần ôn tiếp theo",

  "study.exitSession": "Thoát phiên học",
  "study.exit": "Thoát",
  "study.editCard": "Sửa thẻ",
  "study.deleteCard": "Xóa thẻ",
  "study.clickToFlip": "Nhấn để lật thẻ",
  "study.showAnswer": "Xem đáp án",
  "study.typeYourGuessPlaceholder": "Nhập câu trả lời...",
  "study.yourGuess": "Bạn đã trả lời: {text}",
  "hero.streak": "Chuỗi ngày",
  "hero.days": "ngày",
  "hero.today": "Hôm nay",
  "hero.cardsToday": "{n} thẻ hôm nay",
  "hero.studied": "Đã học",
  "hero.studiedHint": "Thanh đầy khi bằng ngày trung bình của bạn ({time})",
  "hero.newCards": "Thẻ mới",
  "hero.reviews": "Lượt ôn",
  "hero.reviewsHint": "So với Số lượt ôn tối đa mỗi ngày (Tùy chọn)",
  "hero.lastDays": "{n} ngày qua",
  "hero.perDay": "mỗi ngày",
  "hero.total": "tổng",
  "hero.shortest": "ít nhất",
  "hero.longest": "nhiều nhất",
  "hero.sparkLabel": "Thời gian học mỗi ngày, {n} ngày qua",
  "hero.aboveAvgRun": "{n} ngày trên mức trung bình",
  "hero.aboveAvgRun1": "1 ngày trên mức trung bình",
  "hero.aboveAvgBest": "kỷ lục {n}",
  "hero.aboveAvgKeep": "Học thêm {time} hôm nay để giữ chuỗi.",
  "hero.aboveAvgStart": "Học thêm {time} hôm nay để bắt đầu chuỗi.",
  "hero.aboveAvgHint": "Một ngày được tính khi bạn học lâu hơn mức trung bình của 30 ngày trước đó. Ngày không học tính là 0 phút. Đường nét đứt trên biểu đồ thời gian học là mức trung bình đó.",
  "stat.aboveAvgLabel": "Chuỗi trên trung bình",
  "undo.button": "Hoàn tác",
  "undo.graded": "Đã đánh dấu {grade}",
  "undo.failed": "Không thể hoàn tác lần đánh dấu này nữa",
  "hint.button": "Hiện từ đầu tiên",
  "hint.more": "Hiện từ tiếp theo",
  "hint.cap": "Đã dùng gợi ý · tối đa là Khó",
  "hint.moreWords": "+{n} từ",
  "hint.usedTitle": "Bạn đã dùng gợi ý, nên thẻ này tính tối đa là Khó",
  "study.retypeLabel": "Nhập lại đáp án để tiếp tục",
  "study.retypeRequiredHint": "Nhập (hoặc xác nhận) đáp án ở trên để tiếp tục",
  "study.retypePlaceholder": "Nhập đáp án...",
  "study.retypeMismatch": "Chưa đúng — thử lại nhé.",
  "enc.right1": "Tốt lắm!",
  "enc.right2": "Chính xác!",
  "enc.right3": "Nhớ giỏi quá!",
  "enc.right4": "Đúng rồi!",
  "enc.right5": "Bạn nắm được rồi!",
  "enc.right6": "Làm tốt lắm!",
  "enc.rightSub1": "Kiến thức này đang vào đầu rồi.",
  "enc.rightSub2": "Trí nhớ của bạn đang làm việc.",
  "enc.rightSub3": "Giữ nhịp này nhé.",
  "enc.wrong1": "Chưa đúng",
  "enc.wrong2": "Suýt nữa",
  "enc.wrong3": "Cố gắng tốt",
  "enc.wrongSub": "Đáp án đúng đã được đánh dấu. Sai bây giờ giúp nhớ lâu hơn.",
  "enc.combo3": "3 câu liên tiếp!",
  "enc.combo5": "5 câu liên tiếp! Đang bùng cháy",
  "enc.combo10": "{n} câu liên tiếp! Không thể cản",
  "enc.comboSub": "Chuỗi câu đúng của bạn đang dài thêm.",
  "enc.half": "Được nửa đường rồi.",
  "enc.oneLeft": "Còn một câu nữa.",
  "study.retypeCorrect": "Chính xác!",
  "study.retypeCloseEnough": "Gần đúng, chấp nhận!",
  "study.latexConfirmLabel": "Xem lại đáp án ở trên, rồi tiếp tục khi bạn đã nhớ",
  "study.latexContinue": "Tôi đã nhớ — Tiếp tục",
  "study.speakP": "Đọc (P)",
  "study.speakFront": "Đọc mặt trước",
  "study.speakBack": "Đọc mặt sau",
  "study.speakTerm": "Đọc thuật ngữ",
  "study.translate": "Dịch mặt đang xem (Alt+T)",
  "study.translating": "Đang dịch…",
  "study.translationUnavailable": "Chỉ có thể dịch khi dùng chế độ máy chủ.",
  "study.translationFailed": "Không thể dịch mặt này. Vui lòng thử lại.",
  "study.translationEmpty": "Mặt này không có văn bản để dịch.",
  "study.translationResult": "Bản dịch",
  "keymap.translate": "Dịch mặt đang xem sang ngôn ngữ ưu tiên",
  "study.saveWord": "Lưu làm từ vựng tiếng Anh",
  "study.savingWord": "Đang lưu từ…",
  "study.wordQueued": "Đã lưu — hãy Fetch trong KnowledgeApp",
  "study.wordSaveFailed": "Không thể lưu từ. Vui lòng thử lại.",
  "study.wordAlreadyQueued": "Đã lưu với ngữ cảnh này",
  "study.wordAlreadyFetched": "Đã có trong bộ từ vựng",
  "study.prev": "Trước",
  "study.stillLearningHint": "Đang học (1)",
  "study.learning": "Đang học",
  "study.hardHint": "Khó (2) — nhớ được, nhưng phải cố gắng",
  "study.hard": "Khó",
  "study.knowItHint": "Đã thuộc (3)",
  "study.knowIt": "Đã thuộc",
  "study.confidentHint": "Rất chắc chắn (4)",
  "study.confident": "Rất chắc chắn",
  "study.next": "Tiếp",
  "results.title": "Kết quả",
  "results.retry": "Làm lại",
  "results.changeSetup": "Đổi thiết lập",
  "results.backToLesson": "Về bài học",
  "results.backToHome": "Về trang chủ",
  "results.backToClass": "Về lớp học",
  "results.backToUpdates": "Về Cập nhật",
  "results.backToDashboard": "Về bảng điều khiển",
  "summary.title": "Hoàn thành phiên học",
  "summary.cardsStudied": "thẻ đã học",
  "done.perfect": "Phiên học hoàn hảo!",
  "done.great": "Phiên học tuyệt vời!",
  "done.complete": "Hoàn thành phiên học",
  "done.cards": "Thẻ",
  "done.questions": "Câu hỏi",
  "done.known": "Đã nhớ",
  "done.bestRun": "Chuỗi đúng",
  "done.time": "Thời gian",
  "done.streak": "Chuỗi ngày học {from} → {to}",
  "done.streakMilestone": "Chuỗi {n} ngày!",
  "done.goalMet": "Đã đạt mục tiêu ngày: {n} thẻ hôm nay",
  "eta.minutes": "còn ~{n} phút",
  "eta.underMinute": "còn <1 phút",
  "summary.new": "Mới",
  "summary.review": "Ôn tập",
  "summary.skippedNote": "{n} thẻ đã bỏ qua (chưa chấm điểm)",
  "summary.reviewAction": "Xem lại các thẻ",

  "confirm.deleteCard": "Xóa thẻ này? Lịch sử và thống kê học tập vẫn được giữ lại.",
  "common.true": "Đúng",
  "common.false": "Sai",
  "study.finish": "Hoàn thành",
  "results.correctOutOf": "{score} câu đúng trên tổng {total} câu",
  "results.hintGreat": "Làm tốt lắm! Các thẻ đã được lên lịch ôn tập ngắt quãng.",
  "results.hintOk": "Đã lên lịch ôn tập — tập trung vào những thẻ bạn làm sai.",
  "results.hintKeepPracticing": "Tiếp tục luyện tập — các thẻ sai sẽ sớm đến hạn ôn lại.",
  "results.cappedNote": "{n} thẻ cần trả lời đúng ở chế độ Thẻ ghi nhớ để chuyển sang khoảng ôn dài hơn.",

  "difficulty.new": "Mới",
  "difficulty.easy": "Dễ",
  "difficulty.medium": "Trung bình",
  "difficulty.hard": "Khó",

  "stats.titlePrefix": "Thống kê: {title}",
  "stats.overview": "Tổng quan",
  "stats.hardestCards": "Thẻ khó nhất",
  "stats.allAttempted": "Tất cả đã làm",
  "stats.totalCards": "Tổng số thẻ",
  "stats.attempted": "Đã làm",
  "stats.accuracy": "Độ chính xác",
  "stats.noDataYet": "Chưa có dữ liệu",
  "stats.totalAttempts": "Tổng lượt làm",
  "stats.difficultyBreakdown": "Phân bố độ khó",
  "stats.accuracyTrend": "Xu hướng độ chính xác",
  "stats.noAttemptedCards": "Chưa có thẻ nào được làm.",
  "stats.reviewHistory": "Lịch sử ôn tập",
  "stats.historyOlderOmitted": "Đang hiển thị {n} lượt gần nhất; lịch sử cũ hơn đã được ẩn.",
  "stats.notApplicable": "Không áp dụng",
  "stats.noReviewHistory": "Chưa có lịch sử ôn tập.",
  "stats.correct": "Đúng",
  "stats.incorrect": "Sai",
  "stats.mode.quiz": "Trắc nghiệm",
  "stats.mode.flashcard": "Thẻ ghi nhớ",
  "stats.mode.recall": "Gợi nhớ",
  "card.imagePlaceholder": "[hình ảnh]",
  "stats.correctOutOfPct": "{correct} / {total} đúng ({pct}%)",

  "dashboard.exportCsv": "Xuất CSV",
  "common.loadingEllipsis": "Đang tải…",
  "dashboard.loadFailed": "Tải bảng điều khiển thất bại.",
  "dashboard.studyCharts": "Biểu đồ học tập",
  "dashboard.days7": "7 ngày",
  "dashboard.days30": "30 ngày",
  "dashboard.days60": "60 ngày",
  "dashboard.days90": "90 ngày",
  "dashboard.weeklyTrend": "Lượt trả lời",
  "dashboard.retentionTrend": "Độ chính xác",
  "dashboard.gradeDistribution": "Cách bạn trả lời",
  "dashboard.reviewTimeTrend": "Thời gian trả lời",
  "dashboard.newCardsTrend": "Thẻ mới",
  "dashboard.srsDistribution": "Khoảng ghi nhớ",
  "dashboard.studyTime": "Thời gian học",
  "dashboard.configureMetrics": "Tùy chỉnh chỉ số",
  "dashboard.configureMetricsHint": "Chọn những gì hiển thị trên bảng tổng quan. Ẩn mọi số liệu thời gian học sẽ ẩn ô đó.",
  "dashboard.studyTimeWindowLabel": "Khoảng thời gian học",
  "dashboard.allMetricsHidden": "Tất cả chỉ số đang ẩn — tùy chỉnh để hiện lại.",
  "dashboard.metricHidden": "Ẩn",
  "dashboard.metricShow": "Hiện",
  "dashboard.metricHighlight": "Nổi bật",
  "dashboard.allCaughtUp": "Đã hoàn thành hết — không có thẻ nào đến hạn.",
  "common.due": "Đến hạn",
  "dashboard.thisWeek": "Tuần này",
  "dashboard.lastWeek": "Tuần trước",
  "dashboard.noCardsInSrs": "Chưa có thẻ nào trong SRS.",
  "dashboard.cardsInSrs": "{n} thẻ trong SRS",
  "srsBucket.learning": "Đang học",
  "dashboard.futureDue": "Sắp đến hạn ôn ({n} ngày tới)",
  "chart.perWeek": "mỗi tuần",
  "chart.thisWeekShort": "Nay",
  "chart.lastWeekShort": "Trước",
  "chart.weeksAgoShort": "{n}t",
  "chart.dayShort": "{n}n",
  "chart.howYouAnswered": "Cách bạn trả lời",
  "chart.answersTitle": "{n} lượt trả lời ({pct}% đúng)",
  "chart.kpiAnswers": "Lượt trả lời tuần này",
  "chart.kpiAccuracy": "Độ chính xác tuần này",
  "chart.kpiNewCards": "Thẻ mới tuần này",
  "chart.kpiAnswerTime": "Thời gian trả lời",
  "chart.kpiDue": "Đến hạn trong {n} ngày",
  "chart.vsLastWeek": "so với tuần trước",
  "chart.noLastWeek": "tuần trước không có dữ liệu để so sánh",
  "chart.same": "như cũ",
  "chart.points": "{n} điểm",
  "chart.point": "1 điểm",
  "chart.busiest": "{n} vào ngày bận nhất ({when})",
  "dashboard.noCardsDueSoon": "Không có thẻ nào đến hạn trong {n} ngày tới.",
  "dashboard.noStudyData": "Chưa có dữ liệu học tập.",
  "dashboard.noReviewGrades": "Chưa có dữ liệu đánh giá ôn tập.",
  "dashboard.noReviewTime": "Chưa có dữ liệu thời gian ôn tập.",
  "dashboard.gradeAgain": "Làm lại / sai",
  "dashboard.gradeHard": "Khó",
  "dashboard.gradeMedium": "Tốt",
  "dashboard.gradeEasy": "Dễ",
  "dashboard.gradeQuiz": "Trắc nghiệm",
  "dashboard.gradeUngraded": "Chưa đánh giá",
  "dashboard.avgReviewDuration": "TB {duration} · {n} lượt ôn",
  "dashboard.heatmapCellTooltip": "{date}: học {duration} ({n} lượt làm)",
  "dashboard.monthAbbrevs": "Th1,Th2,Th3,Th4,Th5,Th6,Th7,Th8,Th9,Th10,Th11,Th12",
  "dashboard.dayAbbrevs": "CN,T2,T3,T4,T5,T6,T7",

  "form.name": "Tên",
  "class.namePlaceholder": "vd: Machine Learning",
  "class.level": "Cấp độ",
  "class.levelHint": "(tùy chọn — để sắp xếp)",
  "class.levelPlaceholder": "Số thứ tự sắp xếp (vd: 1, 2, 3)",
  "form.color": "Màu sắc",
  "form.icon": "Biểu tượng",
  "form.title": "Tiêu đề",
  "lesson.titlePlaceholder": "vd: Tuần 1: Hồi quy tuyến tính",
  "lesson.format": "Định dạng",
  "format.mcqPickerLabel": "Trắc nghiệm",
  "lesson.trueFalseSlash": "Đúng / Sai",
  "card.term": "Thuật ngữ",
  "card.termPlaceholder": "vd: Hồi quy Ridge",
  "form.previewColon": "Xem trước:",
  "card.definition": "Định nghĩa",
  "card.defPlaceholder": "vd: $\\hat{\\beta} = (X^TX + \\lambda I)^{-1}X^Ty$",
  "mcq.question": "Câu hỏi",
  "mcq.questionPlaceholder": "vd: AdaBoost tối thiểu hóa hàm mất mát nào?",
  "mcq.correctAnswer": "Đáp án đúng",
  "mcq.correctAnswerPlaceholder": "vd: Exponential loss",
  "mcq.wrongAnswers": "Đáp án sai",
  "mcq.addChoice": "+ Thêm lựa chọn",
  "card.explanationOptional": "Giải thích (tùy chọn)",
  "mcq.explanationPlaceholder": "Vì sao đáp án này đúng? Vì sao các đáp án khác sai?",
  "tf.statement": "Câu phát biểu",
  "tf.statementPlaceholder": "vd: Trái Đất quay quanh Mặt Trời.",
  "tf.answer": "Đáp án",
  "tf.explanationPlaceholder": "Vì sao câu này đúng hay sai?",
  "imagedef.imageFront": "Hình ảnh (mặt trước)",
  "imagedef.dropLabel": "Nhấn hoặc kéo hình vào đây (JPEG, PNG, GIF, WebP · tối đa 5 MB)",
  "imagedef.chooseImage": "Chọn hình ảnh",
  "imagedef.definitionBack": "Định nghĩa (mặt sau)",
  "imagedef.defPlaceholder": "vd: Tháp Eiffel, xây năm 1889, Paris.",
  "bulk.pasteHere": "Dán các thẻ vào đây...",
  "bulk.addCards": "Thêm thẻ",
  "bulkImport.title": "Nhập hàng loạt bài học & thẻ",
  "common.import": "Nhập",
  "delete.confirmTitle": "Xác nhận xóa",
  "confirm.archiveTitle": "Xác nhận lưu trữ",
  "delete.areYouSure": "Bạn có chắc chắn không?",
  "share.signInHint": "Đăng nhập hoặc tạo tài khoản để lưu lớp này vào thư viện của bạn.",
  "share.signInRegister": "Đăng nhập / Đăng ký",
  "share.shareClass": "Chia sẻ lớp",
  "share.shareLink": "Liên kết chia sẻ",
  "share.shareLinkDesc": "Bất kỳ ai có liên kết này đều có thể học và lưu bản sao của lớp này.",
  "share.generateLink": "Tạo liên kết",
  "share.inviteByNameEmail": "Mời bằng Tên hoặc Email",
  "share.inviteHint": "Họ sẽ thấy lớp này trong mục \"Được chia sẻ với tôi\".",
  "common.copy": "Sao chép",
  "share.disableLink": "Vô hiệu hóa liên kết",
  "share.saveToMyClasses": "Lưu vào lớp của tôi",
  "share.usernameOrEmail": "Tên đăng nhập hoặc email...",
  "share.invite": "Mời",
  "share.peopleWithAccess": "Người có quyền truy cập",
  "share.noOneInvited": "Chưa mời ai.",
  "promptGuide.title": "Prompt trích xuất AI",
  "promptGuide.desc": "Dán prompt này vào bất kỳ AI nào (ChatGPT, Claude, Gemini…) kèm theo nội dung của bạn để tạo thẻ ghi nhớ.",
  "keymap.title": "Phím tắt",
  "keymap.sectionGlobal": "Toàn cục",
  "keymap.search": "Tìm kiếm",
  "keymap.saveCardModal": "Lưu (Thêm/Sửa thẻ)",
  "keymap.toggleHelp": "Bật/tắt trợ giúp này",
  "keymap.goHome": "Về trang chủ (trừ khi đang học)",
  "keymap.closeGoBack": "Đóng / Quay lại",
  "keymap.navigateClasses": "Di chuyển giữa các lớp",
  "keymap.openClassToggle": "Mở lớp / chọn",
  "keymap.newClass": "Lớp mới",
  "keymap.dashboardOutsideSelect": "Bảng điều khiển (ngoài chế độ chọn)",
  "keymap.sectionClass": "Lớp học",
  "keymap.navigateLessons": "Di chuyển giữa các bài học",
  "keymap.openLessonToggle": "Mở bài học / chọn",
  "keymap.newLesson": "Bài học mới",
  "keymap.sectionLesson": "Bài học",
  "keymap.newCard": "Thẻ mới",
  "keymap.bulkPaste": "Dán hàng loạt",
  "keymap.startStudy": "Bắt đầu học",
  "keymap.sectionSetup": "Thiết lập học",
  "keymap.selectPreset": "Chọn bộ lọc đã lưu",
  "keymap.sectionFlashcards": "Thẻ ghi nhớ",
  "keymap.prevNext": "Trước / Tiếp",
  "keymap.flipCard": "Lật thẻ",
  "keymap.pronounce": "Phát âm",
  "keymap.pronounceTerm": "Đọc thuật ngữ",
  "keymap.undoGrade": "Hoàn tác lần đánh dấu vừa rồi",
  "keymap.selectOption": "Chọn đáp án",
  "keymap.sectionResultsEtc": "Kết quả / Thống kê / Bảng điều khiển / Phân tích",
  "keymap.retryResultsOnly": "Làm lại (chỉ ở Kết quả)",
  "keymap.toggleSelectMode": "Bật/tắt chế độ chọn",
  "keymap.toggleSelectionSelectMode": "Chọn/bỏ chọn (chế độ chọn)",
  "keymap.selectAllSelectMode": "Chọn tất cả (chế độ chọn)",
  "keymap.studySelectedSelectMode": "Học mục đã chọn (chế độ chọn)",
  "keymap.deleteSelectedSelectMode": "Xóa mục đã chọn (chế độ chọn)",
  "search.noResults": "Không có kết quả",
  "search.failed": "Không tìm được. Hãy kiểm tra kết nối mạng.",

  "bulkImport.hint": "Dùng <strong>#</strong> để bắt đầu một bài học. Có thể thêm <code>| mcq</code> sau tiêu đề để dùng định dạng trắc nghiệm (mặc định là thuật ngữ→định nghĩa).<br>Sau đó liệt kê các thẻ bên dưới, mỗi thẻ một dòng.<br><br><strong>Thuật ngữ→Định nghĩa:</strong> <code>thuật ngữ | định nghĩa</code><br><strong>Trắc nghiệm:</strong> <code>câu hỏi | đáp án đúng | sai1 | sai2 | sai3</code><br><strong>Trắc nghiệm + giải thích:</strong> <code>câu hỏi | đáp án đúng | sai1 ;; Vì sao đáp án đúng là đúng.</code>",

  "class.newClass": "Lớp mới",
  "lesson.newLesson": "Bài học mới",
  "bulk.addCardsTitle": "Thêm thẻ hàng loạt",
  "card.addCard": "Thêm thẻ",
  "card.editCard": "Sửa thẻ",
  "lesson.hintTermDef": "Phù hợp cho từ vựng, khái niệm, công thức. Hàng loạt: thuật ngữ | định nghĩa",
  "lesson.hintMcq": "Phù hợp để ôn thi. Hàng loạt: câu hỏi | đáp án đúng | sai1 [| sai2…] [;; giải thích]",
  "lesson.hintTrueFalse": "Phù hợp cho câu Đúng/Sai. Hàng loạt: câu | true  hoặc  câu | false [;; giải thích]",
  "lesson.hintImageDef": "Hình ảnh ở mặt trước, định nghĩa văn bản ở mặt sau. Thêm từng thẻ một (không nhập hàng loạt).",
  "class.tags": "Nhãn",
  "class.tagsPlaceholder": "vd: đại-số-tuyến-tính, ôn-thi",
  "class.tagsHint": "Cách nhau bằng dấu phẩy",
  "class.suggestTags": "Gợi ý thẻ",
  "class.suggestingTags": "Đang gợi ý…",
  "validate.enterClassName": "Vui lòng nhập tên lớp.",
  "validate.enterLessonTitle": "Vui lòng nhập tiêu đề bài học.",
  "validate.fillTermDef": "Vui lòng nhập cả thuật ngữ và định nghĩa.",
  "validate.fillMcq": "Vui lòng nhập câu hỏi, đáp án đúng và 1–4 đáp án sai.",
  "validate.enterStatement": "Vui lòng nhập câu phát biểu.",
  "validate.selectTrueFalse": "Vui lòng chọn Đúng hoặc Sai.",
  "validate.unsupportedFileType": "Định dạng tệp không hỗ trợ. Vui lòng dùng JPEG, PNG, GIF hoặc WebP.",
  "validate.chooseImageFirst": "Vui lòng chọn hình ảnh trước.",
  "validate.enterDefinition": "Vui lòng nhập định nghĩa.",
  "validate.levelMustBeNumber": "Cấp độ phải là một số.",
  "share.savedToClasses": "Đã lưu \"{name}\" vào lớp của bạn!",
  "common.failedToSave": "Lưu thất bại",
  "lesson.pickerTermDef": "Thuật ngữ → Định nghĩa",
  "lesson.pickerImageDef": "Hình ảnh → Định nghĩa",
  "bulk.hintTermDef": "Mỗi dòng một thẻ: thuật ngữ | định nghĩa (hoặc dán hai cột từ bảng tính)\nHỗ trợ LaTeX: $\\hat{\\beta}$ hoặc $$\\sum_{i=1}^n x_i$$",
  "bulk.hintTrueFalse": "Mỗi dòng một thẻ: câu | true  hoặc  câu | false [;; giải thích]",
  "bulk.hintMcq": "Mỗi dòng một thẻ: câu hỏi | đáp án đúng | sai1 [| sai2 | sai3 | sai4]",

  "common.remove": "Xóa",
  "share.failedToInvite": "Mời thất bại",
  "common.classSingular": "Lớp",
  "common.lessonSingular": "Bài học",
  "common.cardSingular": "Thẻ",
  "share.byOwner": "bởi {name}",
  "confirm.deleteSelectedCards": "Xóa {n} thẻ? Lịch sử và thống kê học tập vẫn được giữ lại.",
  "confirm.deleteSelectedLessons": "Xóa {n} bài học cùng toàn bộ thẻ ghi nhớ? Lịch sử và thống kê học tập vẫn được giữ lại.",
  "card.imageAlt": "Hình ảnh thẻ",
  "study.reviewDue": "Trắc nghiệm nhanh · {n} thẻ đến hạn",
  "study.reviewDueTitle": "Trắc nghiệm các thẻ đang đến hạn (theo giới hạn ôn mỗi ngày)",
  "confirm.leaveTitle": "Rời phiên học?",
  "confirm.discardTitle": "Bỏ thay đổi?",
  "confirm.discardChanges": "Các thay đổi của bạn chưa được lưu.",
  "confirm.discard": "Bỏ thay đổi",
  "confirm.reviewTitle": "Đánh dấu đã xem?",
  "validate.noLessonsFound": "Không tìm thấy bài học hợp lệ. Hãy bắt đầu mỗi bài học bằng một dòng tiêu đề #.",
  "bulk.noValidCards": "Không tìm thấy thẻ hợp lệ. Hãy kiểm tra định dạng.",
  "bulk.cardsDetected": "Nhận diện được {n} thẻ",
  "bulk.linesSkipped": "Sẽ bỏ qua {n} dòng:",
  "bulk.lineReason": "Dòng {n}: {reason}",
  "bulk.errNoSeparator": "thiếu dấu | hoặc tab giữa các phần",
  "bulk.errEmptyPart": "thiếu một vế",
  "bulk.errMcqParts": "cần câu hỏi | đáp án đúng | ít nhất một đáp án sai",
  "bulk.errTfAnswer": "đáp án phải là true hoặc false",
  "bulk.errNoLesson": "nằm trước mọi tiêu đề # bài học",
  "toast.archived": "Đã lưu trữ \"{name}\".",
  "toast.unarchived": "Đã bỏ lưu trữ \"{name}\".",
  "toast.archivedMany": "Đã lưu trữ {n} lớp.",
  "toast.cardsAdded": "Đã thêm {n} thẻ.",
  "toast.lessonsImported": "Đã thêm {lessons} và {cards}.",
  "toast.signingOut": "Đang đăng xuất…",
  "pref.backup": "Sao lưu",
  "import.isFullBackup": "Đây là bản sao lưu toàn bộ tài khoản, không phải tệp xuất lớp. Nhập ở đây chỉ nhận tệp xuất lớp (Xuất trong lớp hoặc bài học).",
  "pref.backupHint": "Toàn bộ tài khoản, gồm cả tiến độ học. Muốn chia sẻ một lớp, hãy dùng Xuất trong lớp đó.",
  "pref.downloadBackup": "Tải bản sao lưu đầy đủ",
  "share.disableLinkTitle": "Vô hiệu hóa liên kết chia sẻ?",
  "share.disableLinkConfirm": "Ai có liên kết hiện tại sẽ mất quyền truy cập. Bạn có thể tạo liên kết mới sau, nhưng đó sẽ là liên kết khác.",
  "search.inputPlaceholder": "Tìm lớp, bài học, thẻ…",
  "search.queryLabel": "Nội dung tìm kiếm",
  "search.resultsLabel": "Kết quả tìm kiếm",
  "error.requestFailed": "Đã xảy ra lỗi ({status}). Hãy thử lại.",
  "error.rateLimited": "Quá nhiều yêu cầu. Vui lòng thử lại sau.",
  "error.missingFields": "Vui lòng điền đầy đủ thông tin.",
  "error.passwordTooShort": "Mật khẩu phải có ít nhất 6 ký tự.",
  "error.emailTaken": "Email này đã được đăng ký.",
  "error.invalidCredentials": "Email hoặc mật khẩu không đúng.",
  "error.googleAccount": "Tài khoản này đăng nhập bằng Google. Hãy dùng \"Đăng nhập với Google\".",
  "error.resetInvalid": "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.",
  "error.linkInvalid": "Liên kết không hợp lệ hoặc đã hết hạn.",
  "error.alreadyOwned": "Bạn đã sở hữu lớp này.",
  "error.userNotFound": "Không tìm thấy người dùng với tên hoặc email này.",
  "error.cannotInviteSelf": "Bạn không thể mời chính mình.",
  "error.alreadyShared": "Người dùng này đã có quyền truy cập.",
  "error.tokenLimit": "Đã đạt giới hạn token. Hãy thu hồi một token trước.",
  "error.alreadyFetched": "Từ này đã được lấy về.",
  "error.noCardsToAnalyze": "Lớp này chưa có thẻ nào để phân tích.",
  "error.aiNotConfigured": "Máy chủ chưa cấu hình gợi ý nhãn bằng AI.",
  "error.aiFailed": "Gợi ý nhãn bằng AI thất bại. Hãy thử lại.",
  "confirm.leaveSession": "Bạn đã trả lời {n} thẻ và kết quả đã được lưu. Rời phiên ngay?",
  "keymap.quizNext": "Câu tiếp theo (sau khi trả lời)",
  "keymap.exitStudy": "Thoát (hỏi lại nếu đang học dở)",
  "mcq.wrongAnswerPlaceholder": "Đáp án sai",
  "mcq.removeWrongAnswer": "Xóa đáp án sai",
  "validate.imageUploadRequiresServer": "Tải ảnh lên yêu cầu chế độ server.",
  "validate.fileTooLarge": "Tệp vượt quá giới hạn 5 MB.",
  "error.uploadFailed": "Tải lên thất bại",
  "error.uploadFailedWithMessage": "Tải lên thất bại: {message}",
  "error.aiSuggestFailedWithMessage": "Không thể gợi ý thẻ: {message}",
  "study.noCardsMatchFilter": "Không có thẻ nào khớp với bộ lọc đã chọn.",
  "setup.reviewCapReached": "Có {due} thẻ đến hạn, nhưng đã hết lượt ôn hôm nay ({done}/{cap}). Tăng Số lượt ôn tối đa mỗi ngày trong Tùy chọn để học tiếp.",
  "common.copied": "Đã sao chép!",
  "promptGuide.copyPrompt": "Sao chép Prompt",
  "tts.testPhrase": "Đây là bản kiểm tra tốc độ đọc.",
  "common.releaseToRefresh": "Thả để làm mới",
  "alert.noLessonsInSelectedClasses": "Các lớp đã chọn không có bài học nào.",
  "quiz.exit": "Thoát Trắc nghiệm",
  "quiz.scoreTitle": "Đúng {n} trên {total} câu đã trả lời",
  "quiz.layoutGrid": "Xếp đáp án cạnh nhau",
  "quiz.layoutList": "Xếp đáp án thành danh sách",
  "quiz.cappedHint": "Đúng — nhưng thẻ này cần trả lời đúng ở chế độ Thẻ ghi nhớ để chuyển sang khoảng ôn dài hơn.",
  "study.notDueHint": "Thẻ này chưa đến hạn ôn, nên câu trả lời không ảnh hưởng đến lịch ôn.",
  "study.explanation": "Giải thích",
  "keymap.reviewPrevNext": "Xem lại câu trước / câu sau đã trả lời"
});

function t(key, vars) {
  var lang = (typeof state !== "undefined" && state.language) || "en";
  var dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
  // English plurals: a "key_one" variant is used when n is 1. Vietnamese has no plural forms.
  var str = vars && vars.n === 1 && dict[key + "_one"] !== undefined ? dict[key + "_one"] : dict[key];
  if (str === undefined) str = TRANSLATIONS.en[key];
  if (str === undefined) return key;
  if (vars) {
    Object.keys(vars).forEach(function(k) {
      str = str.split("{" + k + "}").join(vars[k]);
    });
  }
  return str;
}

function applyI18n(root) {
  root = root || document;
  root.querySelectorAll("[data-i18n]").forEach(function(el) {
    var text = t(el.getAttribute("data-i18n"));
    // Buttons that pair an inline SVG icon with a trailing text node
    // (e.g. <button>{svg} Archive</button>) must keep the icon — update
    // just the last text-node child instead of clobbering everything.
    var lastText = null;
    for (var i = el.childNodes.length - 1; i >= 0; i--) {
      if (el.childNodes[i].nodeType === 3) { lastText = el.childNodes[i]; break; }
    }
    var hasElementChild = Array.prototype.some.call(el.childNodes, function(n) { return n.nodeType === 1; });
    if (lastText && hasElementChild) {
      // Preserve which side the icon is on: "{icon} Text" vs "Text {icon}"
      var pad = (lastText.previousSibling ? " " : "") + text + (lastText.nextSibling ? " " : "");
      lastText.data = pad;
    } else {
      el.textContent = text;
    }
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach(function(el) {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
  root.querySelectorAll("[data-i18n-title]").forEach(function(el) {
    el.title = t(el.getAttribute("data-i18n-title"));
  });
  root.querySelectorAll("[data-i18n-aria]").forEach(function(el) {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
  });
  // Rich-HTML strings (embedded <strong>/<code>) can't go through the
  // textContent path above without losing their formatting.
  var bulkImportHint = document.getElementById("bulk-import-hint");
  if (bulkImportHint) bulkImportHint.innerHTML = t("bulkImport.hint");
}

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

// Vietnamese-exclusive diacritics only (đ, ơ/ư horn vowels, ă, and the stacked tone-on-
// modified-vowel range U+1EA0-1EF9) — deliberately excludes base accented vowels shared
// with French/Spanish/German/Portuguese (à/á/â/è/é/ê/etc.), which alone would false-positive
// on card content in those languages. Plain Vietnamese text with only shared-vowel accents
// and no tier-1 character (e.g. "Tôi tên là Phê") isn't caught by this and falls back to
// state.language — an accepted gap, not a bug.
var VI_DIACRITIC_RE = /[ĐđƠơƯưĂăẠ-ỹ]/;
// Quality-tier name markers across engines: Apple (enhanced/premium), generic (neural),
// Android/Google Cloud-style (wavenet/studio), Edge neural voices ("...Online (Natural)").
var QUALITY_VOICE_RE = /enhanced|premium|neural|wavenet|studio|natural|online/i;

var LANG_VOICE_CONFIG = {
  vi: { poolRe: /^vi(-|$)/i, primaryLang: "vi-VN" },
  en: { poolRe: /^en(-|$)/i, primaryLang: "en-US" }
};

function _detectSpeechLang(text) {
  if (VI_DIACRITIC_RE.test(text)) return "vi";
  return (typeof state !== "undefined" && state.language === "vi") ? "vi" : "en";
}

var _ttsVoices = [];
var _ttsVoiceCache = {};
function _refreshVoices() {
  _ttsVoices = (window.speechSynthesis && window.speechSynthesis.getVoices()) || [];
  _ttsVoiceCache = {};
}

// Prefer a voice advertised as enhanced while keeping language matching ahead of voice name.
function _pickVoice(langHint) {
  var lang = langHint === "vi" ? "vi" : "en";
  if (_ttsVoiceCache[lang]) return _ttsVoiceCache[lang];
  if (!_ttsVoices.length) _refreshVoices();
  if (!_ttsVoices.length) return null;

  var cfg = LANG_VOICE_CONFIG[lang];
  var pool = _ttsVoices.filter(function(v) { return cfg.poolRe.test(v.lang); });
  if (!pool.length && lang !== "en") {
    cfg = LANG_VOICE_CONFIG.en;
    pool = _ttsVoices.filter(function(v) { return cfg.poolRe.test(v.lang); });
  }
  if (!pool.length) pool = _ttsVoices;

  var voice =
    pool.find(function(v) { return QUALITY_VOICE_RE.test(v.name); }) ||
    pool.find(function(v) { return /google/i.test(v.name) && v.lang === cfg.primaryLang; }) ||
    pool.find(function(v) { return v.lang === cfg.primaryLang; }) ||
    pool.find(function(v) { return /google/i.test(v.name); }) ||
    pool[0];

  _ttsVoiceCache[lang] = voice;
  return voice;
}

if (window.speechSynthesis) {
  _refreshVoices();
  if (typeof window.speechSynthesis.addEventListener === "function") {
    window.speechSynthesis.addEventListener("voiceschanged", _refreshVoices);
  }
}

function speakWith(text, rate, langHint) {
  if (!window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  var lang = langHint === "vi" || langHint === "en" ? langHint : _detectSpeechLang(text);
  setTimeout(function() {
    var u = new SpeechSynthesisUtterance(text);
    var voice = _pickVoice(lang);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else {
      u.lang = lang === "vi" ? "vi-VN" : "en-US";
    }
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

// What the quiz speaker reads: the card's term and nothing else -- not the question wording,
// not the options. A card without a term (multiple choice, true/false, image) has no button.
function quizSpeechText(card) {
  if (!card || !card.data || card.format === "mcq" || card.format === "true-false" || card.format === "image-def") return "";
  var term = typeof card.data.term === "string" ? card.data.term.trim() : "";
  if (term && window.getVocabularySpeechText) term = window.getVocabularySpeechText(term);
  return term;
}

function speakQuizTerm() {
  speakText(quizSpeechText(state.quizCards[state.quizIndex]));
}

function speakStudyFront() {
  var card = state.studyCards[state.studyIndex];
  var text = state.studyFrontText;
  if (card && card.format === "term-def" && window.getVocabularySpeechText) {
    text = window.getVocabularySpeechText(text);
  }
  speakText(text);
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

// A pasted spreadsheet row separates columns with tabs; "|" still wins when a line has one,
// so LaTeX and existing pastes keep their meaning.
function splitBulkParts(line) {
  return line.split(line.indexOf("|") === -1 && line.indexOf("\t") !== -1 ? "\t" : "|");
}

// Lines the parsers skip are pushed onto `rejected` (when given) with a reason, so the preview
// can say which lines won't be added instead of silently dropping them.
function rejectBulkLine(rejected, lineIndex, reasonKey) {
  if (rejected) rejected.push({ line: lineIndex + 1, reason: t(reasonKey) });
}

function parseBulkTermDef(raw, rejected) {
  var lines = raw.split("\n");
  var cards = [];
  lines.forEach(function(line, i) {
    var trimmed = line.trim();
    if (!trimmed) return;
    var parts = splitBulkParts(protectLatexPipes(trimmed));
    if (parts.length < 2) { rejectBulkLine(rejected, i, "bulk.errNoSeparator"); return; }
    var term = restoreLatexPipes(parts[0].trim());
    var def  = restoreLatexPipes(parts.slice(1).join("|").trim());
    if (term && def) cards.push({ format: "term-def", data: { term: term, def: def } });
    else rejectBulkLine(rejected, i, "bulk.errEmptyPart");
  });
  return cards;
}

function parseBulkMCQ(raw, rejected) {
  var lines = raw.split("\n");
  var cards = [];
  lines.forEach(function(line, i) {
    var trimmed = line.trim();
    if (!trimmed) return;
    // Split off optional explanation after ";;"
    var semiIdx     = trimmed.indexOf(";;");
    var mcqPart     = semiIdx >= 0 ? trimmed.slice(0, semiIdx) : trimmed;
    var explanation = semiIdx >= 0 ? trimmed.slice(semiIdx + 2).trim() : null;
    var parts = splitBulkParts(protectLatexPipes(mcqPart));
    if (parts.length < 3) { rejectBulkLine(rejected, i, "bulk.errMcqParts"); return; }
    var q           = restoreLatexPipes(parts[0].trim());
    var correct     = restoreLatexPipes(parts[1].trim());
    var distractors = parts.slice(2).map(function(p) { return restoreLatexPipes(p.trim()); }).filter(Boolean);
    if (distractors.length > 4) distractors = distractors.slice(0, 4);
    if (q && correct && distractors.length >= 1) {
      var data = { question: q, correct: correct, distractors: distractors };
      if (explanation) data.explanation = explanation;
      cards.push({ format: "mcq", data: data });
    } else {
      rejectBulkLine(rejected, i, "bulk.errMcqParts");
    }
  });
  return cards;
}

function parseBulkTF(raw, rejected) {
  var lines = raw.split("\n");
  var cards = [];
  lines.forEach(function(line, i) {
    var trimmed = line.trim();
    if (!trimmed) return;
    var semiIdx = trimmed.indexOf(";;");
    var tfPart = semiIdx >= 0 ? trimmed.slice(0, semiIdx) : trimmed;
    var explanation = semiIdx >= 0 ? trimmed.slice(semiIdx + 2).trim() : null;
    var parts = splitBulkParts(protectLatexPipes(tfPart));
    if (parts.length < 2) { rejectBulkLine(rejected, i, "bulk.errNoSeparator"); return; }
    var statement = restoreLatexPipes(parts[0].trim());
    var answer = restoreLatexPipes(parts[1].trim()).toLowerCase();
    if (!statement) { rejectBulkLine(rejected, i, "bulk.errEmptyPart"); return; }
    if (answer !== "true" && answer !== "false") { rejectBulkLine(rejected, i, "bulk.errTfAnswer"); return; }
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
          tags: normalizeTagsArray(fields.tags),
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
        if (fields.tags !== undefined) fields = Object.assign({}, fields, { tags: normalizeTagsArray(fields.tags) });
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
        id: fields.clientId || genId("att"),
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
    undoAttempt: function(id) {
      save(KEY_ATTEMPTS, (load(KEY_ATTEMPTS) || []).filter(function(a) { return a.id !== id; }));
      return Promise.resolve({ ok: true });
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

function difficultyLabel(level) {
  return level === "easy" ? t("difficulty.easy")
    : level === "medium" ? t("difficulty.medium")
    : level === "hard" ? t("difficulty.hard")
    : t("difficulty.new");
}

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
  if (stats.total === 0) return '<span class="fc-difficulty-badge badge-new">' + t("difficulty.new") + '</span>';
  var classes = { easy: "badge-easy", medium: "badge-medium", hard: "badge-hard" };
  return '<span class="fc-difficulty-badge ' + classes[stats.level] + '">' +
    difficultyLabel(stats.level) + ' · ' + stats.correct + '/' + stats.total + '</span>';
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
   DASHBOARD METRIC CONFIG
   Per-metric visibility for the summary-board hero card (Home + Dashboard share one config):
   "hidden" | "show". "highlight" was the old headline row; saved configs may still hold it,
   and it reads as "show".
   ============================ */
var DASH_METRICS = [
  { key: "streak",          labelKey: "stat.dayStreak" },
  { key: "aboveAvg",        labelKey: "stat.aboveAvgLabel" },
  { key: "studyTime",       labelKey: "dashboard.studyTime" },
  { key: "avgDaily",        labelKey: "stat.avgDailyLabel" },
  { key: "minDaily",        labelKey: "stat.minDailyLabel" },
  { key: "maxDaily",        labelKey: "stat.maxDailyLabel" },
  { key: "classes",         labelKey: "stat.classes" },
  { key: "lessons",         labelKey: "stat.lessons" },
  { key: "cards",           labelKey: "stat.cards" },
  { key: "sessions",        labelKey: "stat.sessions" },
  { key: "attempts",        labelKey: "stat.attempts" }
];

var DEFAULT_DASH_METRIC_CONFIG = {
  streak: "show", aboveAvg: "show", studyTime: "show",
  avgDaily: "show", minDaily: "show", maxDaily: "show",
  classes: "show", lessons: "show", cards: "show", sessions: "show", attempts: "show"
};

/* ============================
   APP STATE
   ============================ */

var store = LocalStorageAdapter;

var state = {
  currentClass: null,
  currentLesson: null,
  vocabularyRequests: [],
  editingClassId: null,
  editingLessonId: null,
  // True while a suggest-tags request is in flight (any class — only one modal is ever open
  // at a time) — guards against stacking a second concurrent request. The separate
  // requestedClassId closure variable in btn-suggest-tags's click handler (not global state)
  // is what catches a stale response landing in a since-switched-to class's tags input.
  suggestTagsPending: false,
  editingCardId: null,
  tfAnswer: null,
  deleteCallback: null,

  // Study Setup
  setupRequestId: 0,
  setupDataPromise: null,
  studyPresets: [],
  maxReviewsPerDay: null,
  // Whether to show the type-before-flip input this session — set by startStudy() from
  // the chosen mode ("flashcard-write" vs plain "flashcard"), not a persisted preference.
  typeToCompare: false,
  // True while a forced-retype drill (Learning/Hard in Flashcard & Write mode) is pending —
  // reset defensively on every renderFlashcard() call, not just on success/exit, so it can
  // never leak between cards or sessions.
  fcForcedRetype: false,
  fcRetypeAdvanceDelay: 0,
  dashMetricConfig: Object.assign({}, DEFAULT_DASH_METRIC_CONFIG),
  _dashHeroData: null,

  // Study
  studyCards: [],
  studyIndex: 0,
  studyMode: "flashcard",
  studyFlipped: false,
  studyHasFlippedCard: false,
  studyCardGraded: false,
  fcHintSteps: 0,
  studyKnownMap: {},
  studyFrontText: "",
  studyBackText: "",
  translationRequestId: 0,
  translationPending: false,

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
  highContrast: false,
  haptics: true,
  sounds: true,
  dailyGoal: 20,
  quizCountsAsKnown: false,
  fontScale: 1,
  ttsRate: 0.9,
  language: (function() {
    try { return localStorage.getItem("fc-language") || "en"; } catch (_) { return "en"; }
  }()),

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
  // Home tag filter: "all" or a tag string (persisted)
  homeTagFilter: (function() {
    try { return localStorage.getItem("fc-home-tag-filter") || "all"; } catch (_) { return "all"; }
  }()),
  // Whether the tag filter pill row is expanded (persisted; collapsed by default so the
  // pill row — which can grow to many tags — doesn't eat vertical space until asked for)
  homeTagBarExpanded: (function() {
    try { return localStorage.getItem("fc-home-tag-expanded") === "1"; } catch (_) { return false; }
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
  }()),

  // Avg/Min/Max Study Time window in days; null = all-time (persisted)
  studyTimeWindowDays: (function() {
    try {
      var v = parseInt(localStorage.getItem("fc-studytime-window"), 10);
      return isNaN(v) ? null : v;
    } catch (_) { return null; }
  }())
};

/* ============================
   SCREEN NAVIGATION
   ============================ */

function showScreen(id) {
  if (id !== "upstream") flushUpstreamPending();
  if (id !== "flashcard" && document.getElementById("screen-flashcard").classList.contains("active")) {
    clearFlashcardTranslation();
  }
  hideVocabularySelectionAction(true);
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
      document.getElementById("class-detail-name").innerHTML = classIconHtml(cls.icon) + " " + escHtml(cls.name);
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

var toastTimer = null;

function showToast(message, kind) {
  var el = document.getElementById("toast");
  el.textContent = message;
  el.classList.toggle("error", kind === "error");
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { el.classList.add("hidden"); }, 4000);
}

// Server errors are English; the ones a user can cause carry a stable code we translate.
function serverError(body, fallback) {
  var key = body && body.code ? "error." + body.code : null;
  return key && TRANSLATIONS.en[key] !== undefined ? t(key) : (body && body.error) || fallback;
}

// A validation message under its field, focused so the user lands on what to fix.
function showFieldError(field, message) {
  var err = document.getElementById(field.id + "-error") || document.createElement("p");
  err.id = field.id + "-error";
  err.className = "field-error";
  err.textContent = message;
  if (!err.isConnected) field.after(err);
  field.setAttribute("aria-invalid", "true");
  field.setAttribute("aria-describedby", err.id);
  var target = field.matches("input, textarea, select, button") ? field : field.querySelector("input, textarea, button");
  if (target) target.focus();
}

function clearFieldError(field) {
  var err = document.getElementById(field.id + "-error");
  if (err) err.remove();
  field.removeAttribute("aria-invalid");
  field.removeAttribute("aria-describedby");
}

function clearFieldErrors(root) {
  root.querySelectorAll(".field-error").forEach(function(el) { el.remove(); });
  root.querySelectorAll("[aria-invalid]").forEach(function(el) {
    el.removeAttribute("aria-invalid");
    el.removeAttribute("aria-describedby");
  });
}

// Disables a save button while its request is in flight, so a double tap or Ctrl/Cmd+Enter
// can't create the same record twice, and reports a failed save instead of doing nothing.
function withBusy(btn, run) {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = t("common.saving");
  Promise.resolve().then(run).catch(function(err) {
    showToast(t("toast.saveFailed", { message: err.message }), "error");
  }).then(function() {
    btn.disabled = false;
    btn.textContent = t(btn.getAttribute("data-i18n"));
  });
}

// Dialogs open in #modal-overlay, oldest first: the confirm dialog can open on top of a form.
var modalStack = [];

function restoreFocus(el) {
  if (el && el.isConnected && el.getClientRects().length) el.focus({ preventScroll: true });
}

// Everything but the top layer is inert, so Tab, taps and screen readers stay inside it.
// The order matches fcCloseTopModal's precedence.
function syncInert() {
  var top = ["modal-search", "modal-keymap", "modal-overlay", "modal-share", "modal-prompt-guide"]
    .map(function(id) { return document.getElementById(id); })
    .filter(function(el) { return !el.classList.contains("hidden"); })[0];
  Array.prototype.forEach.call(document.body.children, function(el) {
    if (el.id !== "toast" && el.tagName !== "SCRIPT") el.inert = !!top && el !== top;
  });
  var topId = modalStack.length ? "modal-" + modalStack[modalStack.length - 1].id : null;
  document.querySelectorAll("#modal-overlay > .modal").forEach(function(m) { m.inert = m.id !== topId; });
}

// Dialogs whose input would be lost by closing them. Manage Presets isn't here: it applies
// each change immediately.
var DIRTY_GUARDED = ["class", "lesson", "card-termdef", "card-mcq", "card-tf", "card-imagedef",
  "bulk", "bulk-import", "vocabulary-add", "preferences", "dash-metrics"];

// A cheap "did the user change anything": field values, selected pickers, previews, and
// value labels ([data-dirty-text], e.g. Preferences text size and speed).
function modalFormState(modal) {
  var body = modal.querySelector(".modal-body");
  return Array.from(body.querySelectorAll("input, textarea, select, .active, .selected, img, [data-dirty-text]"))
    .filter(function(el) { return !el.closest("[data-no-dirty]"); })
    .map(function(el) {
      if (el.type === "checkbox") return el.checked;
      if (el.tagName === "IMG") return el.getAttribute("src") + el.className;
      if ("value" in el && el.tagName !== "BUTTON") return el.value;
      return el.textContent + (el.dataset.value || el.dataset.color || el.dataset.icon || "");
    }).join("\u0000");
}

function openModal(id) {
  var modal = document.getElementById("modal-" + id);
  if (!modalStack.some(function(e) { return e.id === id; })) {
    // Callers fill the fields before opening, so this is the untouched state.
    modalStack.push({ id: id, opener: document.activeElement,
      snapshot: DIRTY_GUARDED.indexOf(id) !== -1 ? modalFormState(modal) : null });
  }
  clearFieldErrors(modal);
  document.getElementById("modal-overlay").classList.remove("hidden");
  modal.classList.remove("hidden");
  syncInert();
  // Callers that want a field focused do it right after; focusing the dialog itself doesn't
  // pop the phone keyboard.
  (id === "delete" ? modal.querySelector('[data-modal="delete"]') : modal).focus();
}

function closeModal(id) {
  var modal = document.getElementById("modal-" + id);
  if (!modal) return;
  if (id === "tutorial" && !modal.classList.contains("hidden")) markTutorialSeen();
  if (id === "preferences") revertPrefsPreview();
  // Blur first so a pending edit that commits on focusout (preset rename) still lands.
  if (modal.contains(document.activeElement)) document.activeElement.blur();
  modal.classList.add("hidden");
  var idx = modalStack.findIndex(function(e) { return e.id === id; });
  var entry = idx === -1 ? null : modalStack.splice(idx, 1)[0];
  if (!modalStack.length) document.getElementById("modal-overlay").classList.add("hidden");
  syncInert();
  if (entry) restoreFocus(entry.opener);
}

// Esc, browser Back and backdrop taps close only the top dialog, asking first if it holds
// unsaved changes (Cancel and × are explicit and never ask). A stray backdrop tap must not
// dismiss the tutorial (Skip, × and Esc still do).
function requestCloseTopModal(fromBackdrop) {
  var top = modalStack[modalStack.length - 1];
  if (!top) return;
  if (fromBackdrop && top.id === "tutorial") return;
  if (top.snapshot !== null && top.snapshot !== modalFormState(document.getElementById("modal-" + top.id))) {
    confirmAction(t("confirm.discardChanges"), function() { closeModal(top.id); }, "discard");
    return;
  }
  closeModal(top.id);
}

// Standalone overlays (share, prompt guide, keymap, search) get the same focus handling.
function showLayer(el) {
  if (el.classList.contains("hidden")) el._opener = document.activeElement;
  el.classList.remove("hidden");
  syncInert();
  el.querySelector(".modal").focus();
}

function hideLayer(el) {
  if (el.classList.contains("hidden")) return;
  el.classList.add("hidden");
  syncInert();
  restoreFocus(el._opener);
}

document.getElementById("modal-overlay").addEventListener("click", function(e) {
  if (e.target === this) requestCloseTopModal(true);
});

// Typing in a field clears its validation message.
document.getElementById("modal-overlay").addEventListener("input", function(e) {
  var field = e.target.closest("[aria-invalid]");
  if (field) clearFieldError(field);
});

// Enter in a single-line field submits the dialog like a native form. Textareas keep Enter for
// new lines, and an IME Enter that commits a composed word (Vietnamese Telex) must not submit.
document.getElementById("modal-overlay").addEventListener("keydown", function(e) {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229 || e.defaultPrevented || e.shiftKey || e.ctrlKey || e.metaKey) return;
  var field = e.target;
  if (field.tagName !== "INPUT" || field.readOnly || !/^(text|number|email|search)$/.test(field.type)) return;
  var btn = field.id === "pref-token-name" ? document.getElementById("pref-token-create")
    : field.closest(".modal").querySelector(".modal-footer .btn-primary:not([data-modal])");
  if (!btn || btn.disabled) return;
  e.preventDefault();
  btn.click();
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
    } else if (key === "last_activity") {
      r = (a.last_activity_at || 0) - (b.last_activity_at || 0);
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
  // Isolated .catch so a new-card-estimate failure can't blank out the rest of the board.
  var newCardEstimatePromise = store.getNewCardEstimate().catch(function() { return null; });
  Promise.all([store.getDashboard(state.studyTimeWindowDays), newCardEstimatePromise]).then(function(results) {
    var dash = results[0], newCardEstimate = results[1];
    var grid = document.getElementById("home-summary-grid");
    grid.innerHTML = streakTimeHeroCard(dash.streak, dash.studyTime, dash.summary, newCardEstimate, dash.today);
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
    renderUpstreamIndicators(classes);
    classes = sortClasses(classes, state.currentClassSort, state.currentClassSortDir);
    document.getElementById("class-sort-select").value = state.currentClassSort;
    document.getElementById("class-sort-dir").innerHTML = state.currentClassSortDir === "desc" ? ICON_CHEVRON_DOWN : ICON_CHEVRON_UP;

    // Build slicer pills from unique levels/tags among classes in the current archived/active view
    _renderHomeSlicer(classes.filter(function(c) { return !!c.archived === state.showArchived; }));
    _renderHomeTagSlicer(classes.filter(function(c) { return !!c.archived === state.showArchived; }));

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

function _renderHomeTagSlicer(classes) {
  var toggleBtn = document.getElementById("btn-tag-filter-toggle");
  var bar = document.getElementById("home-tag-slicer-bar");
  if (!toggleBtn || !bar) return;
  var tags = [];
  classes.forEach(function(c) {
    (c.tags || []).forEach(function(tg) { if (tags.indexOf(tg) === -1) tags.push(tg); });
  });

  bar.innerHTML = "";
  if (tags.length === 0) {
    toggleBtn.classList.add("hidden");
    bar.classList.add("hidden");
    if (state.homeTagFilter !== "all") {
      state.homeTagFilter = "all";
      try { localStorage.setItem("fc-home-tag-filter", "all"); } catch (_) {}
    }
    _syncTagFilterToggleUI();
    return;
  }

  if (state.homeTagFilter !== "all" && tags.indexOf(state.homeTagFilter) === -1) {
    state.homeTagFilter = "all";
    try { localStorage.setItem("fc-home-tag-filter", "all"); } catch (_) {}
  }

  toggleBtn.classList.remove("hidden");
  bar.classList.remove("hidden");

  var allBtn = document.createElement("button");
  allBtn.className = "pill" + (state.homeTagFilter === "all" ? " active" : "");
  allBtn.dataset.filter = "all";
  allBtn.textContent = t("setup.all");
  bar.appendChild(allBtn);

  tags.forEach(function(tg) {
    var btn = document.createElement("button");
    btn.className = "pill" + (state.homeTagFilter === tg ? " active" : "");
    btn.dataset.filter = tg;
    btn.textContent = tg;
    bar.appendChild(btn);
  });

  _syncTagFilterToggleUI();
}

// Keeps the collapse state, the toggle button's "filter active" tint, and the compact
// active-tag label (shown only while collapsed, so the current filter is never invisible)
// all in sync with state.homeTagFilter / state.homeTagBarExpanded.
function _syncTagFilterToggleUI() {
  var bar = document.getElementById("home-tag-slicer-bar");
  var toggleBtn = document.getElementById("btn-tag-filter-toggle");
  var label = document.getElementById("tag-filter-active-label");
  if (!bar || !toggleBtn || !label) return;
  bar.classList.toggle("collapsed", !state.homeTagBarExpanded);
  toggleBtn.classList.toggle("filter-active", state.homeTagFilter !== "all");
  if (state.homeTagFilter !== "all" && !state.homeTagBarExpanded) {
    label.textContent = state.homeTagFilter;
    label.classList.remove("hidden");
  } else {
    label.classList.add("hidden");
  }
}

function _applyHomeFilter(classes) {
  var base = classes.filter(function(c) { return !!c.archived === state.showArchived; });
  if (state.homeFilter !== "all") {
    base = base.filter(function(c) { return String(c.level) === state.homeFilter; });
  }
  if (state.homeTagFilter !== "all") {
    base = base.filter(function(c) { return c.tags && c.tags.indexOf(state.homeTagFilter) !== -1; });
  }
  return base;
}

function _renderClassItems(classes) {
  var container = document.getElementById("class-list");
  var empty = document.getElementById("empty-home");
  container.innerHTML = "";

  if (classes.length === 0) {
    empty.querySelector("p").textContent = state.showArchived
      ? t("home.emptyArchived")
      : t("home.emptyDefault");
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
  if (state.homeSelectMode) {
    // Selection follows what's on screen: drop classes the new filter hides.
    var shown = classes.map(function(c) { return c.id; });
    state.selectedClassIds = state.selectedClassIds.filter(function(id) { return shown.indexOf(id) !== -1; });
    _syncClassSelectionUI();
  }
}

// Re-sorts, re-filters or switches view using the classes already loaded, so the page doesn't
// refetch and jump, and select mode survives.
function _renderHomeClassList() {
  _renderClassItems(_applyHomeFilter(sortClasses(state.homeClasses, state.currentClassSort, state.currentClassSortDir)));
  if (state._classAccuracyMap) _applyClassAccuracy(state._classAccuracyMap);
}

function toggleClassArchived(cls) {
  var archiving = !cls.archived;
  return store.updateClass(cls.id, { archived: archiving ? 1 : 0 }).then(function() {
    showToast(t(archiving ? "toast.archived" : "toast.unarchived", { name: cls.name }));
    return renderHome();
  }, function(err) {
    showToast(t("toast.saveFailed", { message: err.message }), "error");
  });
}

// "Level" is the default class-sort criterion but was never shown anywhere on the card
// itself — folded into the existing lesson-count meta line rather than a new badge.
function formatClassMeta(cls, lessonCount) {
  var lessons = t("count.lessons", { n: lessonCount });
  return cls.level != null && cls.level !== "" ? t("class.levelMeta", { level: cls.level, lessons: lessons }) : lessons;
}

function _renderClassGridCard(cls, container) {
  var card = document.createElement("div");
  card.className = "class-card" + (cls.archived ? " class-card-archived" : "");
  card.tabIndex = -1;
  card.dataset.classId = cls.id;
  card.innerHTML =
    '<div class="class-card-accent" style="background:' + cls.color + '"></div>' +
    '<span class="class-icon">' + classIconHtml(cls.icon, 28) + '</span>' +
    '<div class="class-name">' + escHtml(cls.name) + '</div>' +
    '<div class="class-meta" id="cls-meta-' + cls.id + '">' + t("common.loading") + '</div>' +
    (cls.tags && cls.tags.length
      ? '<div class="class-tags">' + cls.tags.map(function(tg) { return '<span class="class-tag-chip">' + escHtml(tg) + '</span>'; }).join('') + '</div>'
      : '') +
    (cls.due_count > 0 ? '<span class="due-badge class-due-badge">' + t("count.due", { n: cls.due_count }) + '</span>' : '') +
    '<span class="class-acc-pill hidden" id="cls-acc-' + cls.id + '"></span>' +
    '<div class="progress-mini-wrap" id="cls-prog-wrap-' + cls.id + '" style="display:none">' +
      '<div class="progress-mini"><div class="progress-mini-fill" id="cls-prog-fill-' + cls.id + '" style="transform:scaleX(0);background:' + cls.color + '"></div></div>' +
      '<span class="progress-mini-text" id="cls-prog-text-' + cls.id + '"></span>' +
    '</div>' +
    '<div class="class-card-actions">' +
      '<button class="icon-btn" title="' + (cls.archived ? t("common.unarchive") : t("common.archive")) + '" data-cls-archive="' + cls.id + '">' + (cls.archived ? ICON_UNARCHIVE : ICON_ARCHIVE) + '</button>' +
      '<button class="icon-btn" title="' + t("common.edit") + '" data-cls-edit="' + cls.id + '">' + ICON_EDIT + '</button>' +
      '<button class="icon-btn danger" title="' + t("common.delete") + '" data-cls-del="' + cls.id + '">' + ICON_DELETE + '</button>' +
    '</div>';
  onLongPress(card, function() { longPressSelectClass(cls.id); });
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
    confirmDelete(t("confirm.deleteClass", { name: cls.name }), function() {
      store.deleteClass(cls.id).then(renderHome);
    });
  });
  container.appendChild(card);

  store.getLessons(cls.id).then(function(lessons) {
    var meta = document.getElementById("cls-meta-" + cls.id);
    if (meta) meta.textContent = formatClassMeta(cls, lessons.length);
  });
  store.getProgress("class", cls.id).then(function(p) { setClassProgress(cls.id, p); });
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
    '<span class="class-list-icon">' + classIconHtml(cls.icon, 22) + '</span>' +
    '<div class="class-list-info">' +
      '<div class="class-list-name">' + escHtml(cls.name) + '</div>' +
      '<div class="class-list-meta" id="cls-meta-' + cls.id + '">' + t("common.loading") + '</div>' +
      (cls.tags && cls.tags.length
        ? '<div class="class-tags">' + cls.tags.map(function(tg) { return '<span class="class-tag-chip">' + escHtml(tg) + '</span>'; }).join('') + '</div>'
        : '') +
      '<div class="progress-mini-wrap" id="cls-prog-wrap-' + cls.id + '" style="display:none">' +
        '<div class="progress-mini"><div class="progress-mini-fill" id="cls-prog-fill-' + cls.id + '" style="transform:scaleX(0);background:' + cls.color + '"></div></div>' +
        '<span class="progress-mini-text" id="cls-prog-text-' + cls.id + '"></span>' +
      '</div>' +
    '</div>' +
    '<div class="class-list-right">' +
      (cls.due_count > 0 ? '<span class="due-badge">' + t("count.due", { n: cls.due_count }) + '</span>' : '') +
      '<span class="class-acc-pill hidden" id="cls-acc-' + cls.id + '"></span>' +
      (state.homeSelectMode ? '' :
        '<div class="class-list-actions">' +
          '<button class="icon-btn" title="' + (cls.archived ? t("common.unarchive") : t("common.archive")) + '" data-cls-archive="' + cls.id + '">' + (cls.archived ? ICON_UNARCHIVE : ICON_ARCHIVE) + '</button>' +
          '<button class="icon-btn" title="' + t("common.edit") + '" data-cls-edit="' + cls.id + '">' + ICON_EDIT + '</button>' +
          '<button class="icon-btn danger" title="' + t("common.delete") + '" data-cls-del="' + cls.id + '">' + ICON_DELETE + '</button>' +
        '</div>') +
    '</div>';
  onLongPress(row, function() { longPressSelectClass(cls.id); });
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
    confirmDelete(t("confirm.deleteClass", { name: cls.name }), function() {
      store.deleteClass(cls.id).then(renderHome);
    });
  });
  container.appendChild(row);

  store.getLessons(cls.id).then(function(lessons) {
    var meta = document.getElementById("cls-meta-" + cls.id);
    if (meta) meta.textContent = formatClassMeta(cls, lessons.length);
  });
  store.getProgress("class", cls.id).then(function(p) { setClassProgress(cls.id, p); });
  if (state._classAccuracyMap && state._classAccuracyMap[cls.id]) {
    _setClassAccuracyPill(cls.id, state._classAccuracyMap[cls.id]);
  }
}

function classComplete(p) {
  return !!p && p.total > 0 && p.known >= p.total;
}

// A class with every card known says so in place of its progress line, rather than with a
// badge of its own: the bar already is the measure, so at 100% it turns success green and the
// text becomes "Complete". It is not stored -- a card falling back to not known takes it away.
function classProgressHtml(p) {
  if (classComplete(p)) {
    return '<span class="class-done-pill"><svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-4.9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      escHtml(t("class.complete")) + '</span><span>' + escHtml(t("count.cards", { n: p.total })) + '</span>';
  }
  // 239 of 240 rounds to 100%, which would read as complete beside a class that is.
  var pct = Math.min(99, Math.round(p.known / p.total * 100));
  return escHtml(t("count.knownProgress", { known: p.known, total: p.total, pct: pct }));
}

function setClassProgress(classId, p) {
  if (!p || p.total === 0) return;
  var wrap = document.getElementById("cls-prog-wrap-" + classId);
  var fill = document.getElementById("cls-prog-fill-" + classId);
  var text = document.getElementById("cls-prog-text-" + classId);
  if (!wrap) return;
  var done = classComplete(p);
  wrap.style.display = "";
  wrap.classList.toggle("is-complete", done);
  fill.style.transform = scaleXStyle(done ? 1 : Math.round(p.known / p.total * 100) / 100);
  text.innerHTML = classProgressHtml(p);
  text.title = t(done ? "class.completeTooltip" : "class.knownTooltip");
}

function _setClassAccuracyPill(classId, acc) {
  var el = document.getElementById("cls-acc-" + classId);
  if (!el || acc.total === 0) return;
  var pct = Math.round(acc.correct / acc.total * 100);
  el.textContent = pct + "%";
  el.title = t("class.accuracyTooltip");
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
      _renderHomeClassList();
    });
  }

  var tagSlicerBar = document.getElementById("home-tag-slicer-bar");
  if (tagSlicerBar) {
    tagSlicerBar.addEventListener("click", function(e) {
      var btn = e.target.closest(".pill");
      if (!btn) return;
      state.homeTagFilter = btn.dataset.filter;
      try { localStorage.setItem("fc-home-tag-filter", state.homeTagFilter); } catch (_) {}
      tagSlicerBar.querySelectorAll(".pill").forEach(function(b) {
        b.classList.toggle("active", b.dataset.filter === state.homeTagFilter);
      });
      _syncTagFilterToggleUI();
      _renderHomeClassList();
    });
  }

  var tagFilterToggleBtn = document.getElementById("btn-tag-filter-toggle");
  if (tagFilterToggleBtn) {
    tagFilterToggleBtn.addEventListener("click", function() {
      state.homeTagBarExpanded = !state.homeTagBarExpanded;
      try { localStorage.setItem("fc-home-tag-expanded", state.homeTagBarExpanded ? "1" : "0"); } catch (_) {}
      _syncTagFilterToggleUI();
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
      _renderHomeClassList();
    });
  }
}());

document.getElementById("class-sort-select").addEventListener("change", function() {
  state.currentClassSort = this.value;
  try { localStorage.setItem("fc-class-sort", this.value); } catch (_) {}
  if (state.homeClasses) _renderHomeClassList(); else renderHome();
});

document.getElementById("class-sort-dir").addEventListener("click", function() {
  state.currentClassSortDir = state.currentClassSortDir === "asc" ? "desc" : "asc";
  try { localStorage.setItem("fc-class-sort-dir", state.currentClassSortDir); } catch (_) {}
  this.innerHTML = state.currentClassSortDir === "desc" ? ICON_CHEVRON_DOWN : ICON_CHEVRON_UP;
  if (state.homeClasses) _renderHomeClassList(); else renderHome();
});

function openClass(classId) {
  store.getClass(classId).then(function(cls) {
    if (!cls) return;
    state.currentClass = cls;
    state.lessonFilter = "all";
    state._lessonAccuracyMap = {};
    var nameEl = document.getElementById("class-detail-name");
    nameEl.innerHTML = classIconHtml(cls.icon) + " " + escHtml(cls.name) +
      (cls.archived ? ' <span class="archived-badge">' + t("archive.archived") + '</span>' : "");
    document.getElementById("btn-archive-class").innerHTML = (cls.archived ? ICON_UNARCHIVE : ICON_ARCHIVE) + " " + (cls.archived ? t("class.unarchiveClass") : t("class.archiveClass"));
    setSelectMode(false);
    document.getElementById("lesson-sort-select").value = state.currentLessonSort;
    document.getElementById("lesson-sort-dir").innerHTML = state.currentLessonSortDir === "desc" ? ICON_CHEVRON_DOWN : ICON_CHEVRON_UP;
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
  document.getElementById("lesson-sort-dir").innerHTML = state.currentLessonSortDir === "desc" ? ICON_CHEVRON_DOWN : ICON_CHEVRON_UP;
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
  CLASS_ICON_DEFS.forEach(function(def) {
    var opt = document.createElement("span");
    opt.className = "icon-opt";
    opt.innerHTML = classSvgIcon(def.path, def.color, 20);
    opt.dataset.icon = def.key;
    opt.addEventListener("click", function() {
      picker.querySelectorAll(".icon-opt").forEach(function(o) { o.classList.remove("active"); });
      this.classList.add("active");
    });
    picker.appendChild(opt);
  });
}

function openNewClass() {
  state.editingClassId = null;
  document.getElementById("modal-class-title").textContent = t("class.newClass");
  document.getElementById("class-name-input").value = "";
  document.getElementById("class-level-input").value = "";
  document.getElementById("class-tags-input").value = "";
  initColorPicker();
  initIconPicker();
  // Default selections
  document.querySelector("#color-picker .color-swatch").classList.add("active");
  document.querySelector("#icon-picker .icon-opt").classList.add("active");
  // Suggest-tags reads the class's existing cards, so it's meaningless for a class that
  // doesn't exist yet (no id to query, no cards to have written any).
  document.getElementById("btn-suggest-tags").classList.add("hidden");
  openModal("class");
  document.getElementById("class-name-input").focus();
}

function openEditClass(classId) {
  store.getClass(classId).then(function(cls) {
    if (!cls) return;
    state.editingClassId = classId;
    document.getElementById("modal-class-title").textContent = t("class.editClass");
    document.getElementById("class-name-input").value = cls.name;
    document.getElementById("class-level-input").value = cls.level != null ? cls.level : "";
    document.getElementById("class-tags-input").value = (cls.tags || []).join(", ");
    initColorPicker();
    initIconPicker();
    var colorSwatch = document.querySelector('[data-color="' + cls.color + '"]');
    if (colorSwatch) colorSwatch.classList.add("active");
    else document.querySelector("#color-picker .color-swatch").classList.add("active");
    var iconOpt = document.querySelector('[data-icon="' + classIconKey(cls.icon) + '"]');
    if (iconOpt) iconOpt.classList.add("active");
    else document.querySelector("#icon-picker .icon-opt").classList.add("active");
    // Local/offline mode has no server to call, and a server without ANTHROPIC_API_KEY
    // configured can't fulfill the request either — hide rather than show a button that
    // always errors.
    document.getElementById("btn-suggest-tags").classList.toggle("hidden", !(IS_SERVER && window.APP_CONFIG.aiSuggestEnabled));
    // The click handler's guard blocks a second request while ANY class's suggestion is
    // pending (not just this one), so the button must reflect that globally too — otherwise
    // it'd show enabled on a freshly-opened class while a click silently no-ops.
    setSuggestBtnState(state.suggestTagsPending);
    openModal("class");
  });
}

function setSuggestBtnState(pending) {
  var btn = document.getElementById("btn-suggest-tags");
  btn.disabled = pending;
  btn.textContent = t(pending ? "class.suggestingTags" : "class.suggestTags");
}

document.getElementById("btn-suggest-tags").addEventListener("click", function() {
  if (!state.editingClassId || state.suggestTagsPending) return;
  var requestedClassId = state.editingClassId; // closeModal()/openEditClass() don't cancel this request
  state.suggestTagsPending = true;
  setSuggestBtnState(true);
  store.suggestClassTags(requestedClassId).then(function(res) {
    // If the user closed this modal and opened a different class's editor while the
    // request was in flight, #class-tags-input now belongs to that other class — applying
    // this response would silently merge one class's suggested tags into another's. Only
    // guards the tag-merging/error-alert side effects, not the button reset below — the
    // button tracks the global pending flag (only one modal is open at a time), so it must
    // always be re-enabled once that flag clears, regardless of which class is now showing.
    if (state.editingClassId !== requestedClassId) return;
    var input = document.getElementById("class-tags-input");
    // Merge with whatever's already typed rather than overwrite it — normalizeTagsArray
    // dedupes case-insensitively, so re-running this (or suggesting over hand-typed tags)
    // never produces duplicate pills once saved.
    var existing = parseTagsInput(input.value);
    input.value = normalizeTagsArray(existing.concat(res.tags || [])).join(", ");
  }).catch(function(err) {
    if (state.editingClassId === requestedClassId)
      showToast(t("error.aiSuggestFailedWithMessage", { message: err.message }), "error");
  }).finally(function() {
    state.suggestTagsPending = false;
    setSuggestBtnState(false);
  });
});

document.getElementById("btn-save-class").addEventListener("click", function() {
  var name  = document.getElementById("class-name-input").value.trim();
  var active_color = document.querySelector("#color-picker .color-swatch.active");
  var active_icon  = document.querySelector("#icon-picker .icon-opt.active");
  var nameInput = document.getElementById("class-name-input");
  clearFieldErrors(document.getElementById("modal-class"));
  if (!name) { showFieldError(nameInput, t("validate.enterClassName")); return; }
  var color = active_color ? active_color.dataset.color : CLASS_COLORS[0];
  var icon  = active_icon  ? active_icon.dataset.icon   : CLASS_ICON_DEFAULT_KEY;
  var levelVal = document.getElementById("class-level-input").value.trim();
  var level = levelVal !== "" ? parseInt(levelVal, 10) : null;
  if (level !== null && isNaN(level)) { showFieldError(document.getElementById("class-level-input"), t("validate.levelMustBeNumber")); return; }
  var tags = parseTagsInput(document.getElementById("class-tags-input").value);
  withBusy(this, function() {
    var p;
    if (state.editingClassId) {
      p = store.updateClass(state.editingClassId, { name: name, color: color, icon: icon, level: level, tags: tags });
    } else {
      p = store.createClass({ name: name, color: color, icon: icon, level: level, tags: tags });
    }
    return p.then(function() {
      closeModal("class");
      renderHome();
    });
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

// Triggers a browser download for a GET endpoint that can fail (auth/rate-limit/validation/
// ownership) — a plain `window.location.href = url` navigation (the pattern the pre-existing
// CSV export uses) would navigate the whole SPA away to a bare JSON error body on any non-2xx
// response, with no way back except a reload. Fetching first and only building a download
// link on success keeps the app intact and surfaces a normal error alert instead.
//
// Guarded globally (one flag for every caller, not per-URL) rather than per button: it's
// simple and the realistic failure mode is the same button double-clicked, or a user firing
// off export A then immediately export B before A's browser save dialog even appears — either
// way, one download in flight at a time is enough, matching how state.suggestTagsPending
// guards the (also single-modal-at-a-time) AI-suggest button elsewhere in this file.
var downloadInFlight = false;
function downloadFromApi(url) {
  if (downloadInFlight) return;
  downloadInFlight = true;
  fetch(url, { credentials: "same-origin" }).then(function(r) {
    if (r.status === 401) { showAuthScreen(); return null; }
    if (!r.ok) {
      return r.json().then(function(data) {
        throw new Error(serverError(data, t("error.requestFailed", { status: r.status })));
      });
    }
    // Prefer the RFC 6266 filename*=UTF-8''... form — the server sends this specifically to
    // carry non-ASCII names (e.g. Vietnamese class/lesson titles) correctly; the plain
    // filename="..." alongside it is a deliberately mangled ASCII-safe fallback for clients
    // that don't understand the extended form, and this download (a Blob + <a download>, not
    // an HTTP navigation) never even sends the header to a client that wouldn't — it's read
    // right here, so there's no reason to settle for the fallback.
    var disposition = r.headers.get("Content-Disposition") || "";
    var utf8Match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
    var asciiMatch = /filename="([^"]+)"/.exec(disposition);
    var filename = utf8Match ? decodeURIComponent(utf8Match[1]) : (asciiMatch ? asciiMatch[1] : "export");
    return r.blob().then(function(blob) {
      var blobUrl = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    });
  }).catch(function(err) {
    showToast(err.message, "error");
  }).finally(function() {
    downloadInFlight = false;
  });
}

document.getElementById("btn-export-class").addEventListener("click", function() {
  if (!state.currentClass) return;
  downloadFromApi("/api/export/flashcards?classId=" + encodeURIComponent(state.currentClass.id));
});

// Counterpart to downloadFromApi: reads a previously-exported flashcards JSON file and posts
// it to POST /api/import/flashcards, which always creates brand-new classes (no merge option —
// see docs/decisions.md). Same in-flight guard pattern as downloadFromApi, for the same reason
// (double-picking a file, or picking while a prior import is still in flight).
var importInFlight = false;
document.getElementById("btn-import-flashcards").addEventListener("click", function() {
  if (importInFlight) return;
  document.getElementById("import-flashcards-input").click();
});
document.getElementById("import-flashcards-input").addEventListener("change", function(e) {
  var file = e.target.files[0];
  e.target.value = ""; // allow re-selecting the same file back-to-back
  if (!file) return;
  importInFlight = true;
  file.text().then(function(text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(t("import.invalidJson"));
    }
    // A full backup (flat rows with study progress) isn't a class export; say so rather than
    // letting the class importer fail on its shape.
    if (parsed && Array.isArray(parsed.cards) && Array.isArray(parsed.states)) throw new Error(t("import.isFullBackup"));
    return store.importFlashcards({ classes: parsed && parsed.classes });
  }).then(function(result) {
    renderHome();
    showToast(t("import.success", { classes: t("count.classes", { n: result.imported.classes }), lessons: t("count.lessons", { n: result.imported.lessons }), cards: t("count.cards", { n: result.imported.cards }) }));
  }).catch(function(err) {
    showToast(err.message, "error");
  }).finally(function() {
    importInFlight = false;
  });
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

  var allBtn = document.createElement("button");
  allBtn.className = "pill" + (state.lessonFilter === "all" ? " active" : "");
  allBtn.dataset.filter = "all";
  allBtn.textContent = t("setup.all");
  bar.appendChild(allBtn);

  formats.forEach(function(fmt) {
    var btn = document.createElement("button");
    btn.className = "pill" + (state.lessonFilter === fmt ? " active" : "");
    btn.dataset.filter = fmt;
    btn.textContent = formatLabel(fmt);
    bar.appendChild(btn);
  });
}

function formatLabel(format) {
  return format === "term-def" ? t("format.termDef")
    : format === "mcq" ? t("format.mcq")
    : format === "true-false" ? t("format.trueFalse")
    : t("format.imageDef");
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
        reviewLabel = t("count.cardsDueForReview", { n: dueCount });
      } else if (nextReviewAt) {
        var secsLeft = nextReviewAt - now;
        var reviewLabel2 = secsLeft < 3600 ? t("unit.min", { n: Math.ceil(secsLeft / 60) })
          : secsLeft < 86400 ? t("unit.h", { n: Math.ceil(secsLeft / 3600) })
          : t("unit.d", { n: Math.ceil(secsLeft / 86400) });
        reviewLabel = t("lesson.nextReviewIn", { time: reviewLabel2 });
      }

      var acc = accMap && accMap[lesson.id];
      var accHtml = acc && acc.total > 0
        ? '<span class="lesson-acc-pill ' + (acc.pct >= 70 ? "acc-high" : acc.pct >= 40 ? "acc-mid" : "acc-low") + '" id="les-acc-' + lesson.id + '" title="' + escHtml(t("class.accuracyTooltip")) + '">' + acc.pct + '%</span>'
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
          '<div class="lesson-meta" id="les-meta-' + lesson.id + '">' + t("common.loading") + '</div>' +
          (reviewLabel ? '<div class="lesson-due-label' + (isDue ? " is-due" : "") + '">' + reviewLabel + '</div>' : '') +
          '<div class="progress-mini-wrap" id="les-prog-wrap-' + lesson.id + '" style="display:none">' +
            '<div class="progress-mini"><div class="progress-mini-fill" id="les-prog-fill-' + lesson.id + '" style="transform:scaleX(0)"></div></div>' +
            '<span class="progress-mini-text" id="les-prog-text-' + lesson.id + '"></span>' +
          '</div>' +
        '</div>' +
        // One fixed-width slot for the badges, so every row's progress bar ends at the same x.
        '<div class="lesson-badges">' +
          (isDue ? '<span class="due-badge">' + t("count.due", { n: dueCount }) + '</span>' : '') +
          accHtml +
          '<span class="format-badge ' + lesson.format + '">' + formatLabel(lesson.format) + '</span>' +
        '</div>' +
        (state.selectMode
          ? ''
          : '<div class="lesson-actions">' +
              '<button class="icon-btn" title="' + t("common.edit") + '" data-les-edit="' + lesson.id + '">' + ICON_EDIT + '</button>' +
              '<button class="icon-btn danger" title="' + t("common.delete") + '" data-les-del="' + lesson.id + '">' + ICON_DELETE + '</button>' +
            '</div>');
      onLongPress(item, function() {
        if (!state.selectMode) setSelectMode(true);
        if (state.selectedLessonIds.indexOf(lesson.id) === -1) toggleLessonSelection(lesson.id);
      });
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
          confirmDelete(t("confirm.deleteLesson", { title: lesson.title }), function() {
            store.deleteLesson(lesson.id).then(renderLessons);
          });
        });
      }
      list.appendChild(item);
      store.getCards(lesson.id).then(function(cards) {
        var meta = document.getElementById("les-meta-" + lesson.id);
        if (meta) meta.textContent = t("count.cards", { n: cards.length });
      });
      store.getProgress("lesson", lesson.id).then(function(p) {
        if (!p || p.total === 0) return;
        var wrap = document.getElementById("les-prog-wrap-" + lesson.id);
        var fill = document.getElementById("les-prog-fill-" + lesson.id);
        var text = document.getElementById("les-prog-text-" + lesson.id);
        if (!wrap) return;
        var pct = Math.round(p.known / p.total * 100);
        wrap.style.display = "";
        if (p.mastery) {
          renderMasteryBar(wrap, p);
          return;
        }
        fill.style.transform = scaleXStyle(pct / 100);
        text.textContent = t("count.knownProgress", { known: p.known, total: p.total, pct: pct });
        text.title = t("class.knownTooltip");
      });
    });
  });
}

// Brainscape's deck mastery bar: mastered, known, learning, new, left to right. The memory
// states come from the scheduler, so this shows long-term progress, which the manual Know It
// flag (now in the tooltip, to keep the label on one line on a phone) does not.
var MASTERY_ORDER = ["mastered", "known", "learning"];

function renderMasteryBar(wrap, p) {
  var m = p.mastery, total = p.total;
  var pct = Math.round(m.mastered / total * 100);
  var tip = t("mastery.tooltip", { mastered: m.mastered, remembered: m.known, learning: m.learning, fresh: m.new, flagged: p.known, total: total });
  wrap.innerHTML =
    '<div class="mastery-bar" role="img" aria-label="' + escHtml(tip) + '">' +
      MASTERY_ORDER.map(function(k) {
        return m[k] ? '<i class="mastery-' + k + '" style="width:' + (m[k] / total * 100).toFixed(2) + '%"></i>' : '';
      }).join('') +
    '</div>' +
    '<span class="progress-mini-text" title="' + escHtml(tip) + '">' +
      escHtml(t("mastery.text", { pct: pct })) + '</span>';
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

// Long-press a class, lesson or card to start selecting. On phones the Select button sits
// behind the ⋮ menu (or is hidden), and long-press is the gesture people already expect.
// Touch only: mouse users keep the Select button and the X shortcut.
var LONG_PRESS_MS = 500;
var LONG_PRESS_SLOP_PX = 10;   // more movement than this is a scroll, not a press

// Swallows the click that ends a long-press. Kept on the document, not on the pressed
// element: a card long-press re-renders the list to show checkboxes, so the click lands
// on a brand-new element that knows nothing of the press -- and toggled the card straight
// back off. Every new touch clears it, so a press that produced no click (iOS often sends
// none) cannot swallow the next ordinary tap.
var longPressSwallowClick = false;
document.addEventListener("touchstart", function() { longPressSwallowClick = false; }, { capture: true, passive: true });
document.addEventListener("click", function(e) {
  if (!longPressSwallowClick) return;
  longPressSwallowClick = false;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);

function onLongPress(el, handler) {
  var timer = null, startX = 0, startY = 0, fired = false;
  function cancel() { if (timer) { clearTimeout(timer); timer = null; } }
  el.addEventListener("touchstart", function(e) {
    cancel();
    fired = false;
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    timer = setTimeout(function() {
      timer = null;
      fired = true;
      longPressSwallowClick = true;
      haptic("select");
      handler();
    }, LONG_PRESS_MS);
  }, { passive: true });
  el.addEventListener("touchmove", function(e) {
    if (!timer) return;
    var tch = e.touches[0];
    if (Math.abs(tch.clientX - startX) > LONG_PRESS_SLOP_PX || Math.abs(tch.clientY - startY) > LONG_PRESS_SLOP_PX) cancel();
  }, { passive: true });
  el.addEventListener("touchend", cancel);
  el.addEventListener("touchcancel", cancel);
  // Android opens a context menu on long-press; the press is ours.
  el.addEventListener("contextmenu", function(e) { if (fired || timer) e.preventDefault(); });
}

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
  document.getElementById("select-count").textContent = t("common.nSelected", { n: n });
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
  _syncClassSelectionUI();
}

// Checkboxes and the selected state on the rendered class cards, from state.
function _syncClassSelectionUI() {
  var on = state.homeSelectMode;
  document.querySelectorAll("#class-list [data-class-id]").forEach(function(card) {
    var selected = on && state.selectedClassIds.indexOf(card.dataset.classId) !== -1;
    card.classList.toggle("selected", selected);
    var existing = card.querySelector(".lesson-check");
    if (on && !existing) {
      existing = document.createElement("input");
      existing.type = "checkbox";
      existing.className = "lesson-check";
      if (card.classList.contains("class-list-row")) {
        var colorbar = card.querySelector(".class-list-colorbar");
        card.insertBefore(existing, colorbar ? colorbar.nextSibling : card.firstChild);
      } else {
        card.insertBefore(existing, card.firstChild);
      }
    } else if (!on && existing) {
      existing.remove();
      existing = null;
    }
    if (existing) existing.checked = selected;
  });
  updateHomeSelectBar();
}

function longPressSelectClass(classId) {
  if (!state.homeSelectMode) setHomeSelectMode(true);
  if (state.selectedClassIds.indexOf(classId) === -1) toggleClassSelection(classId);
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
  if (countEl) countEl.textContent = t("home.classesSelectedCount", { n: n });
  var studyBtn = document.getElementById("btn-study-classes");
  if (studyBtn) studyBtn.disabled = n === 0;
  var exportBtn = document.getElementById("btn-export-classes");
  if (exportBtn) exportBtn.disabled = n === 0;
  var archiveBtn = document.getElementById("btn-archive-classes");
  if (archiveBtn) archiveBtn.disabled = n === 0;
  var total = document.querySelectorAll("#class-list [data-class-id]").length;
  var allCheck = document.getElementById("select-all-classes");
  if (allCheck) allCheck.checked = total > 0 && n === total;
}

document.getElementById("btn-select-classes").addEventListener("click", function() {
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
        showToast(t("alert.noLessonsInSelectedClasses"));
        return;
      }
      var lessonIds = allLessons.map(function(l) { return l.id; });
      var n = ids.length;
      setHomeSelectMode(false);
      openSetup({
        lessonIds: lessonIds,
        lessons: allLessons,
        returnScreen: "home",
        title: t("home.classesSelectedCount", { n: n })
      });
    });
});

document.getElementById("btn-export-classes").addEventListener("click", function() {
  var ids = state.selectedClassIds.slice();
  if (ids.length === 0) return;
  downloadFromApi("/api/export/flashcards?classIds=" + encodeURIComponent(ids.join(",")));
});

document.getElementById("btn-archive-classes").addEventListener("click", function() {
  var ids = state.selectedClassIds.slice();
  if (ids.length === 0) return;
  confirmAction(t("confirm.archiveClasses", { n: ids.length }), function() {
    Promise.all(ids.map(function(id) { return store.updateClass(id, { archived: 1 }); }))
      .then(function() {
        setHomeSelectMode(false);
        renderHome();
        showToast(t("toast.archivedMany", { n: ids.length }));
      })
      .catch(function() { showToast(t("alert.archiveClassesFailed"), "error"); });
  }, "archive");
});

var ICON_CLOSE_16 = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

function setCardSelectMode(on) {
  state.cardSelectMode = on;
  state.selectedCardIds = [];
  document.getElementById("btn-select-cards").classList.toggle("active", on);
  var toolbar = document.getElementById("lesson-toolbar");
  if (on) {
    toolbar.innerHTML =
      '<div class="select-bar">' +
        '<div class="select-bar-head">' +
          '<button type="button" class="btn btn-ghost select-bar-close" id="btn-card-select-cancel" title="' + escHtml(t("common.cancel")) + '" aria-label="' + escHtml(t("common.cancel")) + '">' + ICON_CLOSE_16 + '</button>' +
          '<span id="card-select-count" class="select-count">' + escHtml(t("common.zeroSelected")) + '</span>' +
          '<label class="select-all-label">' +
            '<input type="checkbox" id="select-all-cards"> ' + escHtml(t("common.selectAll")) +
          '</label>' +
        '</div>' +
        '<div class="select-bar-actions">' +
          '<button class="btn btn-sm btn-danger" id="btn-delete-selected-cards" disabled>' + escHtml(t("common.deleteSelected")) + '</button>' +
        '</div>' +
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
        t("confirm.deleteSelectedCards", { n: ids.length }),
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
  if (countEl) countEl.textContent = t("common.nSelected", { n: n });
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
    t("confirm.deleteSelectedLessons", { n: ids.length }),
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

var FORMAT_HINT_KEYS = {
  "term-def":   "lesson.hintTermDef",
  "mcq":        "lesson.hintMcq",
  "true-false": "lesson.hintTrueFalse",
  "image-def":  "lesson.hintImageDef"
};

function initLessonFormatPicker(selectedFormat) {
  var picker = document.getElementById("lesson-format-picker");
  picker.querySelectorAll(".pill").forEach(function(p) {
    p.classList.toggle("active", p.dataset.value === selectedFormat);
    if (p.dataset.value === "image-def") p.style.display = IS_SERVER ? "" : "none";
  });
  document.getElementById("format-hint").textContent = FORMAT_HINT_KEYS[selectedFormat] ? t(FORMAT_HINT_KEYS[selectedFormat]) : "";
}

document.getElementById("lesson-format-picker").addEventListener("click", function(e) {
  var pill = e.target.closest(".pill");
  if (!pill) return;
  this.querySelectorAll(".pill").forEach(function(p) { p.classList.remove("active"); });
  pill.classList.add("active");
  document.getElementById("format-hint").textContent = t(FORMAT_HINT_KEYS[pill.dataset.value]);
});

function openNewLesson() {
  document.getElementById("lesson-format-picker").querySelectorAll(".pill").forEach(function(p) {
    p.disabled = false;
    p.style.pointerEvents = "";
    p.style.opacity = "";
  });
  state.editingLessonId = null;
  document.getElementById("modal-lesson-title").textContent = t("lesson.newLesson");
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
  document.getElementById("modal-lesson-title").textContent = t("lesson.editLesson");
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

// Mirrors server/routes/classes.js's normalizeTags() exactly — trim/lowercase/dedupe/cap
// at 10, applied to whatever tags end up in local storage too (not just the server path),
// since LocalStorageAdapter has no separate authoritative validation layer of its own.
function normalizeTagsArray(tags) {
  var seen = [];
  (tags || []).forEach(function(tag) {
    if (typeof tag !== "string") return;
    var t = tag.trim().toLowerCase();
    if (t && seen.indexOf(t) === -1) seen.push(t);
  });
  return seen.slice(0, 10);
}

function parseTagsInput(value) {
  return normalizeTagsArray(value.split(","));
}

document.getElementById("btn-save-lesson").addEventListener("click", function() {
  var title = document.getElementById("lesson-title-input").value.trim();
  if (!title) { showFieldError(document.getElementById("lesson-title-input"), t("validate.enterLessonTitle")); return; }
  var activePill = document.querySelector("#lesson-format-picker .pill.active");
  var format = activePill ? activePill.dataset.value : "term-def";
  // Re-enable pills after submit
  document.getElementById("lesson-format-picker").querySelectorAll(".pill").forEach(function(p) {
    p.disabled = false;
    p.style.pointerEvents = "";
    p.style.opacity = "";
  });
  withBusy(this, function() {
    var p;
    if (state.editingLessonId) {
      p = store.updateLesson(state.editingLessonId, { title: title });
    } else {
      p = store.createLesson({ classId: state.currentClass.id, title: title, format: format });
    }
    return p.then(function() {
      closeModal("lesson");
      renderLessons();
    });
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

/* ---- KnowledgeApp changes review screen ---- */

function renderUpstreamIndicators(classes) {
  setUpstreamCount(IS_SERVER ? classes.reduce(function(sum, c) { return sum + (c.upstream_count || 0); }, 0) : 0);
}

// The sidebar badge and home banner, kept current as cards are reviewed rather than only when
// Home re-renders.
function setUpstreamCount(count) {
  var n = state.upstreamCount = Math.max(0, count);
  var badge = document.getElementById("sidebar-upstream-badge");
  var banner = document.getElementById("home-upstream-banner");
  badge.textContent = n;
  badge.classList.toggle("hidden", n === 0);
  document.getElementById("home-upstream-banner-text").textContent = t("upstream.bannerText", { n: n });
  banner.classList.toggle("hidden", n === 0);
}

function openUpstreamScreen() {
  state.upstreamFilter = "all";
  setPillGroup("upstream-filter", "all");
  document.getElementById("upstream-status").classList.add("hidden");
  showScreen("upstream");
  renderUpstream();
}

function openVocabularyScreen() {
  showScreen("vocabulary");
  refreshVocabularyQueue(true);
}

function updateVocabularyBadge(count) {
  var badge = document.getElementById("sidebar-vocabulary-badge");
  badge.textContent = count;
  badge.classList.toggle("hidden", count === 0);
  badge.setAttribute("aria-label", t("vocabulary.pendingCount", { n: count }));
}

function refreshVocabularyQueue(showLoading) {
  var loading = document.getElementById("vocabulary-loading");
  var error = document.getElementById("vocabulary-error");
  if (showLoading) {
    loading.classList.remove("hidden");
    error.classList.add("hidden");
    document.getElementById("vocabulary-empty").classList.add("hidden");
    document.getElementById("vocabulary-list").innerHTML = "";
  }
  return store.getVocabularyRequests().then(function(result) {
    state.vocabularyRequests = result.requests || [];
    updateVocabularyBadge(state.vocabularyRequests.length);
    renderVocabularyQueue();
  }).catch(function(err) {
    if (!showLoading) return;
    loading.classList.add("hidden");
    error.querySelector("p").textContent = err.message;
    error.classList.remove("hidden");
  });
}

function renderVocabularyQueue() {
  document.getElementById("vocabulary-loading").classList.add("hidden");
  document.getElementById("vocabulary-error").classList.add("hidden");
  var list = document.getElementById("vocabulary-list");
  list.innerHTML = "";
  var requests = state.vocabularyRequests || [];
  document.getElementById("vocabulary-empty").classList.toggle("hidden", requests.length !== 0);
  requests.forEach(function(request) {
    var item = document.createElement("article");
    item.className = "vocabulary-request";

    var content = document.createElement("div");
    content.className = "vocabulary-request-content";
    var word = document.createElement("h3");
    word.className = "vocabulary-request-word";
    word.textContent = request.selected_text;
    content.appendChild(word);
    if (request.context_text) {
      var context = document.createElement("p");
      context.className = "vocabulary-request-context";
      context.textContent = request.context_text;
      content.appendChild(context);
    }
    if (request.source_class_name || request.source_lesson_title) {
      var source = document.createElement("p");
      source.className = "vocabulary-request-source";
      source.textContent = t("vocabulary.source", {
        class: request.source_class_name || "",
        lesson: request.source_lesson_title || ""
      });
      content.appendChild(source);
    }

    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-sm btn-danger vocabulary-request-delete";
    remove.setAttribute("data-i18n", "common.delete");
    remove.textContent = t("common.delete");
    remove.addEventListener("click", function() {
      confirmDelete(t("vocabulary.deleteConfirm", { word: request.selected_text }), function() {
        remove.disabled = true;
        store.deleteVocabularyRequest(request.id).then(function() {
          return refreshVocabularyQueue(true);
        }).catch(function(err) {
          remove.disabled = false;
          var message = err.code === "alreadyFetched"
            ? t("vocabulary.alreadyFetched")
            : t("vocabulary.deleteError", { message: err.message });
          showToast(message, "error");
          if (err.code === "alreadyFetched") refreshVocabularyQueue(true);
        });
      });
    });

    item.appendChild(content);
    item.appendChild(remove);
    list.appendChild(item);
  });
}

function openAddVocabularyModal() {
  document.getElementById("vocabulary-add-word").value = "";
  document.getElementById("vocabulary-add-context").value = "";
  document.getElementById("vocabulary-add-error").classList.add("hidden");
  openModal("vocabulary-add");
  document.getElementById("vocabulary-add-word").focus();
}

function addVocabularyRequest() {
  var wordInput = document.getElementById("vocabulary-add-word");
  var contextInput = document.getElementById("vocabulary-add-context");
  var error = document.getElementById("vocabulary-add-error");
  var word = wordInput.value.trim();
  if (!word) {
    error.textContent = t("vocabulary.enterWord");
    error.classList.remove("hidden");
    wordInput.focus();
    return;
  }

  var button = document.getElementById("btn-vocabulary-add-save");
  button.disabled = true;
  store.saveVocabulary({ selected_text: word, context_text: contextInput.value.trim() }).then(function() {
    closeModal("vocabulary-add");
    return refreshVocabularyQueue(true);
  }).catch(function(err) {
    error.textContent = err.code === "duplicateWordQueued" || err.code === "duplicateWordFetched"
      ? t(err.code === "duplicateWordQueued" ? "vocabulary.duplicatePending" : "vocabulary.duplicateFetched", { word: word })
      : t("vocabulary.addError", { message: err.message });
    error.classList.remove("hidden");
  }).then(function() {
    button.disabled = false;
  });
}

function renderUpstream() {
  var loading = document.getElementById("upstream-loading");
  loading.classList.remove("hidden");
  store.getUpstreamChanges().then(function(res) {
    state.upstreamData = res;
    setUpstreamCount(res.count.total);
    loading.classList.add("hidden");
    showUpstreamData();
  }).catch(function(err) {
    loading.classList.add("hidden");
    document.getElementById("upstream-body").classList.add("hidden");
    var emptyEl = document.getElementById("upstream-empty");
    emptyEl.classList.remove("hidden");
    emptyEl.querySelector("p").textContent = err.message;
  });
}

function showUpstreamData() {
  var empty = state.upstreamData.count.total === 0;
  var emptyEl = document.getElementById("upstream-empty");
  emptyEl.querySelector("p").textContent = t("upstream.empty");
  emptyEl.classList.toggle("hidden", !empty);
  document.getElementById("upstream-body").classList.toggle("hidden", empty);
  if (!empty) renderUpstreamList();
}

function upstreamFilteredCards() {
  var f = state.upstreamFilter || "all";
  return state.upstreamData.cards.filter(function(c) { return f === "all" || c.upstream_change === f; });
}

function renderUpstreamList() {
  var count = state.upstreamData.count;
  document.getElementById("upstream-summary").textContent =
    t("upstream.summary", { n: count.total, updated: count.updated, deleted: count.deleted });
  var cards = upstreamFilteredCards();
  var list = document.getElementById("upstream-list");
  list.innerHTML = "";
  var groups = [];
  var byLesson = {};
  cards.forEach(function(card) {
    if (!byLesson[card.lesson_id]) {
      byLesson[card.lesson_id] = [];
      groups.push(byLesson[card.lesson_id]);
    }
    byLesson[card.lesson_id].push(card);
  });
  groups.forEach(function(group) {
    var first = group[0];
    var header = document.createElement("button");
    header.type = "button";
    header.className = "upstream-group-header";
    header.textContent = first.class_name + " › " + first.lesson_title + " (" + group.length + ")";
    header.addEventListener("click", function() { openLessonFromAnywhere(first.class_id, first.lesson_id); });
    list.appendChild(header);
    group.forEach(function(card) { list.appendChild(renderUpstreamItem(card)); });
  });
  if (!cards.length) {
    var none = document.createElement("p");
    none.className = "upstream-summary";
    none.textContent = t("upstream.noneInFilter");
    list.appendChild(none);
  }
  document.getElementById("btn-upstream-ack-all").disabled = cards.length === 0;
  document.getElementById("btn-upstream-study").disabled =
    !cards.some(function(c) { return c.upstream_change === "updated"; });
}

function upstreamFields(card) {
  if (card.format === "term-def") return ["term", "def"];
  var keys = [];
  [card.data || {}, card.prev_data || {}].forEach(function(obj) {
    Object.keys(obj).forEach(function(k) {
      if (k !== "imageUrl" && keys.indexOf(k) === -1) keys.push(k);
    });
  });
  return keys;
}

function upstreamFieldText(obj, key) {
  if (!obj || obj[key] == null) return "";
  return typeof obj[key] === "string" ? obj[key] : JSON.stringify(obj[key]);
}

function upstreamConceptName(card) {
  var key = upstreamFields(card)[0];
  var name = (upstreamFieldText(card.data, key) || upstreamFieldText(card.prev_data, key)).replace(/\s+/g, " ").trim();
  return name.length > 60 ? name.slice(0, 59) + "…" : name;
}

// Takes the card out of the list in place: re-fetching after every mark flashed the loading
// row and jumped the list, once per card, after every sync.
function dropUpstreamCard(card) {
  var data = state.upstreamData;
  var at = data.cards.indexOf(card);
  if (at < 0) return -1;
  data.cards.splice(at, 1);
  data.count.total--;
  data.count[card.upstream_change] = (data.count[card.upstream_change] || 1) - 1;
  setUpstreamCount(data.count.total);
  showUpstreamData();
  return at;
}

function restoreUpstreamCard(card, at) {
  var data = state.upstreamData;
  data.cards.splice(Math.min(at, data.cards.length), 0, card);
  data.count.total++;
  data.count[card.upstream_change] = (data.count[card.upstream_change] || 0) + 1;
  setUpstreamCount(data.count.total);
  showUpstreamData();
}

// The acknowledgement is sent when the undo bar goes, not at the click: the server has no
// "un-acknowledge", and the bar is the only way back from a misclick.
var UPSTREAM_UNDO_MS = 6000;
function markUpstreamReviewed(card) {
  flushUpstreamPending();
  var at = dropUpstreamCard(card);
  if (at < 0) return;
  var pending = { card: card, at: at };
  state.upstreamPending = pending;
  pending.timer = setTimeout(flushUpstreamPending, UPSTREAM_UNDO_MS);
  state.undoHandler = function() {
    clearTimeout(pending.timer);
    state.upstreamPending = null;
    hideUndoBar();
    restoreUpstreamCard(card, at);
  };
  showUndoBar(t("upstream.markedOne", { name: upstreamConceptName(card) }));
}

window.addEventListener("pagehide", function() { flushUpstreamPending(); });

function flushUpstreamPending() {
  var pending = state.upstreamPending;
  if (!pending) return;
  state.upstreamPending = null;
  clearTimeout(pending.timer);
  hideUndoBar();
  store.acknowledgeCardUpdate(pending.card.id).catch(function(err) {
    if (state.upstreamData) restoreUpstreamCard(pending.card, pending.at);
    showToast(err.message, "error");
  });
}

function showUndoBar(text) {
  document.getElementById("grade-undo-text").textContent = text;
  document.getElementById("grade-undo").classList.remove("hidden");
}

function hideUndoBar() {
  state.undoHandler = null;
  document.getElementById("grade-undo").classList.add("hidden");
}

function showUpstreamStatus(cards) {
  var names = cards.map(upstreamConceptName);
  var text = cards.length === 1
    ? t("upstream.markedOne", { name: names[0] })
    : t("upstream.markedMany", { n: cards.length, names: names.slice(0, 5).join(", ") + (names.length > 5 ? ", …" : "") });
  var el = document.getElementById("upstream-status");
  el.textContent = text;
  el.classList.remove("hidden");
}

function renderUpstreamItem(card) {
  var item = document.createElement("div");
  item.className = "upstream-item";

  var top = document.createElement("div");
  top.className = "upstream-item-top";
  var pill = document.createElement("span");
  pill.className = "upstream-pill " + card.upstream_change;
  pill.textContent = t("upstream." + card.upstream_change);
  var time = document.createElement("span");
  time.className = "upstream-time";
  time.textContent = relativeTime(card.upstream_changed_at);
  top.appendChild(pill);
  top.appendChild(time);
  item.appendChild(top);

  var compare = document.createElement("div");
  compare.className = "upstream-compare" + (card.prev_data ? "" : " single");
  var prevCol = null;
  if (card.prev_data) {
    prevCol = document.createElement("div");
    prevCol.className = "upstream-col prev";
    prevCol.innerHTML = '<div class="upstream-col-label"></div>';
    prevCol.firstChild.textContent = t("upstream.previous");
    compare.appendChild(prevCol);
  }
  var currCol = document.createElement("div");
  currCol.className = "upstream-col curr";
  currCol.innerHTML = '<div class="upstream-col-label"></div>';
  currCol.firstChild.textContent = t("upstream.current");
  compare.appendChild(currCol);

  upstreamFields(card).forEach(function(key, i) {
    var cls = i === 0 ? "upstream-field card-term" : "upstream-field card-def";
    var currEl = document.createElement("div");
    currEl.className = cls;
    currCol.appendChild(currEl);
    var curr = upstreamFieldText(card.data, key);
    if (!prevCol) { renderLatex(curr, currEl); return; }
    var prevEl = document.createElement("div");
    prevEl.className = cls;
    prevCol.appendChild(prevEl);
    renderUpstreamField(upstreamFieldText(card.prev_data, key), curr, prevEl, currEl);
  });
  item.appendChild(compare);

  var actions = document.createElement("div");
  actions.className = "upstream-actions";
  function action(labelKey, cls, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-sm " + cls;
    b.textContent = t(labelKey);
    b.addEventListener("click", function() { onClick(b); });
    actions.appendChild(b);
  }
  action("upstream.markReviewed", "btn-outline", function() { markUpstreamReviewed(card); });
  action("upstream.openInLesson", "btn-ghost", function() { openLessonFromAnywhere(card.class_id, card.lesson_id); });
  if (card.format === "term-def") {
    action("common.edit", "btn-ghost", function() {
      openEditCard(card.id, { id: card.id, lesson_id: card.lesson_id, format: card.format, data: card.data });
    });
  }
  if (card.upstream_change === "deleted") {
    action("common.delete", "btn-ghost btn-toolbar-danger upstream-delete", function() {
      confirmDelete(t("confirm.deleteCard"), function() {
        store.deleteCard(card.id, card.lesson_id).then(function() { dropUpstreamCard(card); });
      });
    });
  }
  item.appendChild(actions);
  return item;
}

function hasLatex(text) {
  return splitLatex(text).some(function(p) { return p.type !== "text"; });
}

// A word diff can't be drawn through rendered math, so a field with LaTeX on either side is
// shown rendered, with the current side outlined when it changed.
function renderUpstreamField(prev, curr, prevEl, currEl) {
  if (hasLatex(prev) || hasLatex(curr)) {
    renderLatex(prev, prevEl);
    renderLatex(curr, currEl);
    if (prev !== curr) currEl.classList.add("changed");
    return;
  }
  var d = diffWords(prev, curr);
  prevEl.innerHTML = d.prev;
  currEl.innerHTML = d.curr;
}

var DIFF_MAX_CELLS = 250000;

function diffWords(a, b) {
  var x = a.split(/(\s+)/).filter(function(s) { return s !== ""; });
  var y = b.split(/(\s+)/).filter(function(s) { return s !== ""; });
  function mark(tok, tag) {
    return /^\s+$/.test(tok) ? escHtml(tok) : "<" + tag + ' class="diff-' + tag + '">' + escHtml(tok) + "</" + tag + ">";
  }
  if (x.length * y.length > DIFF_MAX_CELLS) {
    return { prev: x.map(function(s) { return mark(s, "del"); }).join(""),
             curr: y.map(function(s) { return mark(s, "ins"); }).join("") };
  }
  var n = x.length, m = y.length;
  var lcs = [];
  for (var i = 0; i <= n; i++) lcs.push(new Uint16Array(m + 1));
  for (i = n - 1; i >= 0; i--) {
    for (var j = m - 1; j >= 0; j--) {
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  var prev = [], curr = [];
  i = 0; j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { prev.push(escHtml(x[i])); curr.push(escHtml(y[j])); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { prev.push(mark(x[i], "del")); i++; }
    else { curr.push(mark(y[j], "ins")); j++; }
  }
  for (; i < n; i++) prev.push(mark(x[i], "del"));
  for (; j < m; j++) curr.push(mark(y[j], "ins"));
  return { prev: prev.join(""), curr: curr.join("") };
}

document.getElementById("btn-upstream-back").addEventListener("click", function() {
  renderHome();
  showScreen("home");
});

document.getElementById("btn-vocabulary-back").addEventListener("click", function() {
  renderHome();
  showScreen("home");
});
document.getElementById("btn-vocabulary-add").addEventListener("click", openAddVocabularyModal);
document.getElementById("btn-vocabulary-add-save").addEventListener("click", addVocabularyRequest);

/* ============================
   ACHIEVEMENTS
   The server works out where each one stands (routes/achievements.js) and records a tier the
   first time it is seen; this side only draws them and reports the few things only it sees.
   ============================ */
var ACH_GROUPS = ["showingUp", "mastery", "effort", "method", "curiosity"];
var ACH_ICONS = {
  dayStreak: "flame", daysStudied: "cal", goalKeeper: "goal", aboveAverage: "up", comeback: "back",
  steadyRhythm: "wave", dueZero: "zero", classMastered: "star", lessonMastered: "book",
  longTermCards: "brain", longMemory: "bars", vocabInUse: "abc", toughOne: "mtn", leechCleared: "bug",
  recallCleared: "recall", writer: "pen", deepSession: "clock", hoursStudied: "hour",
  recallFirst: "head", mixedPractice: "mix", secondLook: "eye", cardFixer: "wrench",
  wordCollector: "words", explorer: "compass", builder: "build", fromTheBook: "shelf", freshStart: "seed"
};
var ACH_ICON_PATHS = {
  flame: '<path d="M12 3c1.5 3.9 6 5.4 6 10.5a6 6 0 0 1-12 0c0-2.6 1.4-3.9 2.4-5.1.3 2 1.2 3 2.4 3.4C10.5 8.4 11.1 5.1 12 3z"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  goal: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  up: '<path d="M4 17l5-5 4 4 7-8"/><path d="M15 8h5v5"/>',
  back: '<path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M5 4v4h4"/>',
  wave: '<path d="M3 12h3l2-5 4 10 3-7 2 2h4"/>',
  zero: '<circle cx="12" cy="12" r="8"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8z"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h7"/>',
  brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a3 3 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
  bars: '<path d="M4 20h16M6 20v-6M12 20V8M18 20V4"/>',
  abc: '<path d="M4 18l4-12 4 12M5.5 14h5M15 6v12h3a3 3 0 0 0 0-6h-3"/>',
  mtn: '<path d="M3 19l6-11 4 6 3-4 5 9z"/>',
  bug: '<rect x="7" y="8" width="10" height="11" rx="5"/><path d="M12 8V5M7 13H3M21 13h-4M8 18l-3 2M16 18l3 2"/>',
  recall: '<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>',
  pen: '<path d="M4 18l12-12 3 3L7 21H4z"/><path d="M14 4l2-2 4 4-2 2"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  hour: '<path d="M7 3h10M7 21h10M8 3c0 5 8 6 8 9s-8 4-8 9M16 3c0 5-8 6-8 9"/>',
  head: '<circle cx="12" cy="8" r="4"/><path d="M5 21c0-4 3-6 7-6s7 2 7 6"/>',
  mix: '<path d="M4 7h4l8 10h4M4 17h4l8-10h4"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L13 18l-3 3-4-4 3-3 6.5-6.5a4 4 0 0 1-1-1z"/>',
  words: '<path d="M5 3h10l4 4v14H5z"/><path d="M8 11h8M8 15h5"/>',
  compass: '<circle cx="12" cy="12" r="8"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  build: '<rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/><rect x="8.5" y="4" width="7" height="7" rx="1"/>',
  shelf: '<path d="M5 4v16M9 4v16M13 5l4 15M3 20h18"/>',
  seed: '<path d="M12 20v-8M12 12c0-4 3-7 7-7 0 4-3 7-7 7zM12 14c0-3-2-5-6-5 0 3 2 5 6 5z"/>'
};
// What a plain count is counting, where the server sends no unit of its own.
var ACH_UNITS = {
  dayStreak: "days", daysStudied: "days", goalKeeper: "days", aboveAverage: "days", dueZero: "days",
  lessonMastered: "lessons", longTermCards: "cards", vocabInUse: "words", toughOne: "cards",
  writer: "typed", hoursStudied: "hours", cardFixer: "fixes", wordCollector: "words",
  builder: "cards", freshStart: "cards"
};

function achIcon(key) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (ACH_ICON_PATHS[ACH_ICONS[key]] || ACH_ICON_PATHS.star) + '</svg>';
}

// Medal colour for a tier: bronze first, gold at the top tier of a ladder, silver between.
// A single-step achievement stays bronze, as the design preview showed. A lost one keeps
// the colour of what it was, faded by CSS.
function achMedalTier(tier, steps) {
  if (!tier) return 0;
  if (steps === 1 || tier === 1) return 1;
  return tier >= steps ? 3 : 2;
}

function achThresholdLabel(item, tier) {
  if (!tier || item.tiers.length === 1) return "";
  var n = item.tiers[tier - 1];
  return item.key === "hoursStudied" ? n + "h" : String(n);
}

function achDate(sec) {
  return new Date(sec * 1000).toLocaleDateString(state.language === "vi" ? "vi-VN" : "en-US", { day: "numeric", month: "short" });
}

function achCountText(cur, target, unit) {
  if (unit === "%") return t("ach.progressPct", { cur: cur, target: target });
  return t("ach.progress", { cur: cur, target: target, unit: unit ? t("ach.unit." + unit) : "" }).trim();
}

// The line under a medal's name: how far along, when it was earned, or why it is not moving.
function achProgressText(item) {
  var s = item.show || {};
  var text;
  if (s.off) text = t("ach.goalOff");
  else if (s.unit === "waiting") text = s.cur > 0 ? t("ach.waiting", { n: s.cur }) : item.tier ? (item.earnedAt ? t("ach.earnedOn", { date: achDate(item.earnedAt) }) : "") : t("ach.notYet");
  else if (item.next == null) {
    text = item.tiers.length > 1 ? t("ach.count", { n: item.value, unit: ACH_UNITS[item.key] ? t("ach.unit." + ACH_UNITS[item.key]) : "" }).trim()
      : item.earnedAt ? t("ach.earnedOn", { date: achDate(item.earnedAt) }) : "";
  } else if (s.target && (s.unit || item.tiers.length > 1)) text = achCountText(s.cur, s.target, s.unit || ACH_UNITS[item.key]);
  else text = item.value > 0 ? achCountText(item.value, item.next, ACH_UNITS[item.key]) : t("ach.notYet");
  return item.lost ? t("ach.wasEarned") + (text ? " · " + text : "") : text;
}

function achBadgeHtml(item) {
  var shownTier = item.lost && !item.tier ? 1 : item.tier;
  var medal = achMedalTier(shownTier, item.tiers.length);
  var label = achThresholdLabel(item, shownTier);
  var cls = "ach-badge " + (medal ? "ach-t" + medal : "ach-locked") + (item.lost ? " ach-lost" : "");
  var name = t("ach." + item.key + ".name");
  var desc = t("ach." + item.key + ".desc");
  return '<div class="' + cls + '" data-key="' + escHtml(item.key) + '">' +
    '<div class="ach-medal">' + achIcon(item.key) + (label ? '<span class="ach-tn">' + escHtml(label) + '</span>' : '') + '</div>' +
    '<div class="ach-name">' + escHtml(name) + '</div>' +
    '<div class="ach-desc">' + escHtml(desc) + '</div>' +
    '<div class="ach-sub">' + escHtml(achProgressText(item)) + '</div>' +
    (item.next != null && !(item.show && item.show.off)
      ? '<div class="ach-prog" aria-hidden="true"><i style="width:' + Math.round(Math.max(0, Math.min(1, item.progress || 0)) * 100) + '%"></i></div>' : '') +
  '</div>';
}

function achEarnedCount(items) {
  return items.filter(function(it) { return it.tier > 0; }).length;
}

// The closest unfinished one, for the Dashboard strip. Ones that cannot move (the daily
// goal is off) are skipped.
function achNextUp(items) {
  var open = items.filter(function(it) { return it.next != null && !(it.show && it.show.off) && it.progress > 0 && it.progress < 1; });
  open.sort(function(a, b) { return b.progress - a.progress; });
  return open[0] || null;
}

// Medals for the session-complete screen: what rose since the snapshot taken when the
// session began. A lossable one climbing back to a tier it held before is not new; the
// server only stamps a fresh earnedAt when a tier beats the recorded best.
function achNewlyEarned(before, items, max) {
  if (!before) return [];
  return items.filter(function(it) {
    return before.tiers[it.key] !== undefined && it.tier > before.tiers[it.key] && it.earnedAt >= before.now;
  }).slice(0, max || 3);
}

function achSnapshot(data) {
  var tiers = {};
  data.items.forEach(function(it) { tiers[it.key] = it.tier; });
  return { now: data.now, tiers: tiers };
}

function achTierName(medal) {
  return t("ach.tier" + medal);
}

function achEarnedLineText(item) {
  var name = t("ach." + item.key + ".name");
  if (item.tiers.length === 1) return t("ach.earnedLine", { name: name });
  return t("ach.earnedTierLine", { name: name, tier: achTierName(achMedalTier(item.tier, item.tiers.length)), threshold: achThresholdLabel(item, item.tier) });
}

function achSeenKey() {
  return "fc-ach-seen-" + (currentUser && currentUser.id);
}

// "New" means recorded after the page was last opened. The first fetch on a device marks
// everything seen, so someone who has studied for a year is not greeted with 20 new medals.
function updateAchievementsBadge(data) {
  var badge = document.getElementById("sidebar-achievements-badge");
  if (!badge || !data) return;
  var seen = null;
  try { seen = localStorage.getItem(achSeenKey()); } catch (_) {}
  if (seen === null) { markAchievementsSeen(data.now); seen = String(data.now); }
  var n = data.items.filter(function(it) { return it.tier > 0 && it.earnedAt && it.earnedAt > Number(seen); }).length;
  badge.textContent = t("ach.newCount", { n: n });
  badge.classList.toggle("hidden", n === 0);
}

function markAchievementsSeen(now) {
  try { localStorage.setItem(achSeenKey(), String(now)); } catch (_) {}
}

function refreshAchievements() {
  if (!IS_SERVER || !store.getAchievements) return Promise.resolve(null);
  return store.getAchievements().then(function(data) {
    state.achievements = data;
    updateAchievementsBadge(data);
    return data;
  });
}

function recordStudyEvent(kind, ref) {
  if (!IS_SERVER || !store.recordStudyEvent || !ref) return;
  store.recordStudyEvent(kind, String(ref)).catch(function() {});
}

// Second look: going back to a quiz question that was answered wrong, to read it again.
function noteQuizSecondLook() {
  var card = state.quizCards[state.quizIndex];
  var res = card && findQuizResult(card);
  if (res && !res.correct) recordStudyEvent("second_look", card.id);
}

function openAchievementsScreen() {
  showScreen("achievements");
  var list = document.getElementById("ach-list");
  var loadEl = document.getElementById("ach-loading");
  var errEl = document.getElementById("ach-error");
  loadEl.classList.toggle("hidden", !!state.achievements);
  errEl.classList.add("hidden");
  if (state.achievements) renderAchievementsPage(state.achievements);
  refreshAchievements().then(function(data) {
    loadEl.classList.add("hidden");
    if (!data) return;
    renderAchievementsPage(data);
    markAchievementsSeen(data.now);
    updateAchievementsBadge(data);
  }).catch(function() {
    loadEl.classList.add("hidden");
    if (!state.achievements) { list.innerHTML = ""; errEl.classList.remove("hidden"); }
  });
}

function renderAchievementsPage(data) {
  var filter = state.achFilter || "all";
  document.getElementById("ach-summary").textContent = t("ach.earnedCount", { n: achEarnedCount(data.items), total: data.items.length });
  document.getElementById("ach-filters").innerHTML = ["all"].concat(ACH_GROUPS).map(function(g) {
    return '<button type="button" class="pill' + (g === filter ? ' active' : '') + '" data-group="' + g + '" aria-pressed="' + (g === filter) + '">' +
      escHtml(g === "all" ? t("ach.filterAll") : t("ach.group." + g)) + '</button>';
  }).join('');
  document.getElementById("ach-list").innerHTML = ACH_GROUPS.filter(function(g) { return filter === "all" || filter === g; }).map(function(g) {
    var items = data.items.filter(function(it) { return it.group === g; });
    if (!items.length) return '';
    return '<section class="ach-group"><h3 class="ach-group-h">' + escHtml(t("ach.group." + g)) +
      ' <span>' + achEarnedCount(items) + ' / ' + items.length + '</span></h3>' +
      '<div class="ach-shelf">' + items.map(achBadgeHtml).join('') + '</div></section>';
  }).join('');
}

// The achievements row in the Dashboard's Streak tile: the latest medals, the count, and the
// closest unfinished one.
function achMiniHtml(data) {
  var items = data.items;
  var latest = items.filter(function(it) { return it.tier > 0 && !it.lost; })
    .sort(function(a, b) { return (b.earnedAt || 0) - (a.earnedAt || 0); }).slice(0, 3);
  var next = achNextUp(items);
  var count = achEarnedCount(items);
  var text = next
    ? t("ach.next", { name: t("ach." + next.key + ".name"), tier: achTierName(achMedalTier(next.tier + 1, next.tiers.length)) })
    : count === items.length ? t("ach.allEarned") : t("ach.keepGoing");
  return '<div class="dash-ach-mini">' +
    (latest.length ? '<div class="ach-strip-medals">' + latest.map(function(it) {
      return '<span class="ach-medal ach-t' + achMedalTier(it.tier, it.tiers.length) + '" title="' + escHtml(t("ach." + it.key + ".name")) + '">' + achIcon(it.key) + '</span>';
    }).join('') + '</div>' : '') +
    '<div class="dash-ach-mini-text"><span><b>' + count + ' / ' + items.length + '</b> · ' + escHtml(text) + '</span>' +
      (next ? '<div class="ach-prog"><i style="width:' + Math.round(next.progress * 100) + '%"></i></div>' : '') + '</div>' +
    '<button type="button" class="btn btn-ghost btn-sm dash-ach-mini-link" data-open-achievements>' + escHtml(t("dashboard.achAll")) + '</button>' +
  '</div>';
}

function renderDashAchievements() {
  if (!IS_SERVER) return;
  refreshAchievements().then(function(data) {
    if (!data) return;
    document.querySelectorAll("#dash-summary-grid [data-ach-mini]").forEach(function(el) { el.innerHTML = achMiniHtml(data); });
  }).catch(function() {});
}

document.getElementById("ach-filters").addEventListener("click", function(e) {
  var btn = e.target.closest("[data-group]");
  if (!btn || !state.achievements) return;
  state.achFilter = btn.dataset.group;
  renderAchievementsPage(state.achievements);
});

document.getElementById("btn-achievements-back").addEventListener("click", function() {
  renderHome();
  showScreen("home");
});

document.getElementById("btn-upstream-banner-review").addEventListener("click", openUpstreamScreen);

document.getElementById("upstream-filter").addEventListener("click", function(e) {
  var pill = e.target.closest(".pill");
  if (!pill || !state.upstreamData) return;
  state.upstreamFilter = pill.dataset.value;
  setPillGroup("upstream-filter", state.upstreamFilter);
  renderUpstreamList();
});

document.getElementById("btn-upstream-ack-all").addEventListener("click", function() {
  var btn = this;
  var cards = upstreamFilteredCards();
  var ids = cards.map(function(c) { return c.id; });
  if (!ids.length) return;
  confirmAction(t("upstream.confirmAckAll", { n: ids.length }), function() {
    ackAllShown(btn, cards, ids);
  }, "review");
});

function ackAllShown(btn, cards, ids) {
  flushUpstreamPending();
  btn.disabled = true;
  store.acknowledgeCardUpdates(ids).then(function() {
    showUpstreamStatus(cards);
    renderUpstream();
  }, function(err) {
    btn.disabled = false;
    showToast(err.message, "error");
  });
}

document.getElementById("btn-upstream-study").addEventListener("click", function() {
  var seen = {};
  var lessons = [];
  upstreamFilteredCards().forEach(function(c) {
    if (c.upstream_change !== "updated" || seen[c.lesson_id]) return;
    seen[c.lesson_id] = true;
    lessons.push({ id: c.lesson_id, title: c.lesson_title, class_id: c.class_id });
  });
  if (!lessons.length) return;
  openSetup({
    lessonIds: lessons.map(function(l) { return l.id; }),
    lessons: lessons,
    returnScreen: "upstream",
    title: t("upstream.screenTitle")
  });
  // openSetup resets the filter to "all"; clicking the pill runs the normal hint + match-count path.
  document.querySelector('#setup-filter .pill[data-value="updated"]').click();
});

function renderUpstreamNotice(card) {
  var wrap = document.createElement("div");
  wrap.className = "card-upstream";

  var pill = document.createElement("span");
  pill.className = "upstream-pill " + card.upstream_change;
  pill.textContent = t("upstream." + card.upstream_change);
  wrap.appendChild(pill);

  var prev = null;
  if (card.upstream_prev_data) {
    try { prev = JSON.parse(card.upstream_prev_data); } catch (_) {}
  }
  var prevBox = null;
  if (prev) {
    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "link-btn";
    toggle.textContent = t("upstream.showPrevious");
    prevBox = document.createElement("div");
    prevBox.className = "card-prev hidden";
    var prevLabel = document.createElement("div");
    prevLabel.className = "card-prev-label";
    prevLabel.textContent = t("upstream.previous");
    var prevTerm = document.createElement("div");
    prevTerm.className = "card-term";
    var prevDef = document.createElement("div");
    prevDef.className = "card-def";
    renderLatex(prev.term || "", prevTerm);
    renderLatex(prev.def || "", prevDef);
    prevBox.appendChild(prevLabel);
    prevBox.appendChild(prevTerm);
    prevBox.appendChild(prevDef);
    toggle.addEventListener("click", function(e) {
      e.stopPropagation();
      var hidden = prevBox.classList.toggle("hidden");
      toggle.textContent = t(hidden ? "upstream.showPrevious" : "upstream.hidePrevious");
    });
    wrap.appendChild(toggle);
  }

  var ack = document.createElement("button");
  ack.type = "button";
  ack.className = "btn btn-sm btn-outline";
  ack.textContent = t("upstream.markReviewed");
  ack.addEventListener("click", function(e) {
    e.stopPropagation();
    ack.disabled = true;
    store.acknowledgeCardUpdate(card.id).then(function() {
      setUpstreamCount((state.upstreamCount || 0) - 1);
      renderCards();
    }, function() { ack.disabled = false; });
  });
  wrap.appendChild(ack);

  if (prevBox) wrap.appendChild(prevBox);
  return wrap;
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
      if (countBadge) { countBadge.textContent = t("count.cards", { n: 0 }); countBadge.classList.remove("hidden"); }
      return;
    }
    empty.classList.add("hidden");
    list.classList.remove("hidden");
    if (countBadge) { countBadge.textContent = t("count.cards", { n: cards.length }); countBadge.classList.remove("hidden"); }
    cards.forEach(function(card, i) {
      var item = document.createElement("div");
      item.className = "card-item" + (state.selectedCardIds.indexOf(card.id) !== -1 ? " selected" : "");
      item.dataset.cardId = card.id;
      var stats = statsMap[card.id] || { total: 0, correct: 0, level: "new" };
      var pct = stats.total > 0 ? Math.round(stats.correct / stats.total * 100) : null;
      var pillLabel = stats.total === 0 ? t("difficulty.new")
        : difficultyLabel(stats.level) + " · " + pct + "%";
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
        cImg.alt = t("card.imageAlt");
        cImg.style.maxHeight = "60px";
        cImg.style.maxWidth  = "120px";
        cImg.style.objectFit = "contain";
        cImg.style.borderRadius = "4px";
        termEl.appendChild(cImg);
        renderLatex(card.data.def, defEl);
      } else if (card.format === "true-false") {
        renderLatex(card.data.statement, termEl);
        defEl.textContent = "✓ " + (card.data.correct === "true" ? t("common.true") : t("common.false"));
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
            '<button class="icon-btn" title="' + t("common.edit") + '" data-card-edit="' + card.id + '">' + ICON_EDIT + '</button>' +
            '<button class="icon-btn danger" title="' + t("common.delete") + '" data-card-del="' + card.id + '">' + ICON_DELETE + '</button>' +
          '</div>');

      var contentEl = item.querySelector(".card-content");
      contentEl.appendChild(termEl);
      contentEl.appendChild(defEl);

      if (IS_SERVER) {
        var tsDiv = document.createElement("div");
        tsDiv.className = "card-timestamps";
        var tsItems = [
          { label: t("card.lastSeen"), value: relativeTime(card.last_seen_at) },
          { label: t("card.lastStudied"), value: relativeTime(card.last_studied_at) },
          { label: t("card.nextReview"), value: futureRelativeTime(card.srs_due_at) }
        ];
        tsItems.forEach(function(ts) {
          var span = document.createElement("span");
          span.className = "card-ts-item";
          span.textContent = ts.label + ": " + ts.value;
          tsDiv.appendChild(span);
        });
        contentEl.appendChild(tsDiv);
        if (card.upstream_change) contentEl.appendChild(renderUpstreamNotice(card));
      }

      onLongPress(item, function() {
        if (state.cardSelectMode) {
          if (state.selectedCardIds.indexOf(card.id) === -1) toggleCardSelection(card.id);
          return;
        }
        // Card items are built differently in select mode (checkbox, no edit/delete), so
        // entering it re-renders -- with this card already selected.
        setCardSelectMode(true);
        state.selectedCardIds = [card.id];
        updateCardSelectBar();
        renderCards();
      });
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
          confirmDelete(t("confirm.deleteCard"), function() {
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
        dueBtn.textContent = t("study.reviewDue", { n: dueCount });
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

document.getElementById("btn-export-lesson").addEventListener("click", function() {
  if (!state.currentLesson) return;
  downloadFromApi("/api/export/flashcards?lessonId=" + encodeURIComponent(state.currentLesson.id));
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
  if (!dueCards.length) { showToast(t("alert.noCardsDue")); return; }
  startDueQuiz(state.currentLesson, dueCards).catch(function() {
    showToast(t("setup.loadFailed"), "error");
  });
});

// The lesson's quick-quiz button and the Dashboard's due rows bypass Study Setup entirely, so
// they need their own fresh reviews-today fetch to apply the same daily cap Setup respects.
function startDueQuiz(lesson, dueCards, returnScreen) {
  var hasCap = IS_SERVER && state.maxReviewsPerDay !== null && state.maxReviewsPerDay !== undefined;
  var capPromise = hasCap ? store.getReviewsToday() : Promise.resolve({ count: 0 });
  return capPromise.then(function(r) {
    var capped = applyReviewCap(dueCards, r.count);
    if (!capped.length) { showToast(t("alert.dailyReviewCapReached")); return; }
    state.studyScope = {
      lessonIds: [lesson.id],
      lessons: [lesson],
      returnScreen: returnScreen || "lesson",
      title: lesson.title
    };
    state.studyMode = "quiz";
    state.quizCards = shuffle(capped);
    store.markCardsSeen(capped.map(function(c) { return c.id; }));
    startQuiz();
  });
}

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
  input.placeholder = t("mcq.wrongAnswerPlaceholder");
  input.value = value || "";
  var rm = document.createElement("button");
  rm.type = "button";
  rm.className = "icon-btn danger";
  rm.title = t("common.remove");
  rm.setAttribute("aria-label", t("mcq.removeWrongAnswer"));
  rm.innerHTML = ICON_X;
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
    document.getElementById("modal-card-termdef-title").textContent = t("card.addCard");
    document.getElementById("card-term-input").value = "";
    document.getElementById("card-def-input").value = "";
    document.getElementById("card-term-preview").innerHTML = "";
    document.getElementById("card-def-preview").innerHTML = "";
    openModal("card-termdef");
    document.getElementById("card-term-input").focus();
  } else if (format === "true-false") {
    document.getElementById("modal-card-tf-title").textContent = t("card.addCard");
    document.getElementById("card-tf-statement-input").value = "";
    document.getElementById("card-tf-statement-preview").innerHTML = "";
    document.getElementById("card-tf-explanation-input").value = "";
    document.getElementById("tf-explanation-details").removeAttribute("open");
    document.querySelectorAll(".tf-answer-btn").forEach(function(b) { b.classList.remove("selected"); });
    state.tfAnswer = null;
    openModal("card-tf");
    document.getElementById("card-tf-statement-input").focus();
  } else if (format === "image-def") {
    document.getElementById("modal-card-imagedef-title").textContent = t("card.addCard");
    document.getElementById("card-image-input").value = "";
    document.getElementById("card-imagedef-input").value = "";
    document.getElementById("card-image-preview").src = "";
    document.getElementById("card-image-preview").classList.add("hidden");
    document.getElementById("card-image-drop-label").classList.remove("hidden");
    stagedImageUrl = null;
    openModal("card-imagedef");
    document.getElementById("card-imagedef-input").focus();
  } else {
    document.getElementById("modal-card-mcq-title").textContent = t("card.addCard");
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

function openEditCard(cardId, presetCard, fromStudy) {
  state.editingCardId = cardId;
  state.editFromStudy = !!fromStudy;
  // A study/quiz session may span multiple lessons, so state.currentLesson can be the wrong
  // lesson for the card actually on screen — reuse the card object already in memory instead
  // of refetching by (possibly mismatched) lesson id.
  var lookup = presetCard ? Promise.resolve([presetCard]) : store.getCards(state.currentLesson.id);
  lookup.then(function(cards) {
    var card = cards.find(function(c) { return c.id === cardId; });
    if (!card) return;
    // Save handlers use this (not state.currentLesson, which can be null or the wrong
    // lesson during a multi-lesson study/quiz session) to persist the edit.
    state.editingCardLessonId = card.lesson_id;
    if (card.format === "term-def") {
      document.getElementById("modal-card-termdef-title").textContent = t("card.editCard");
      document.getElementById("card-term-input").value = card.data.term;
      document.getElementById("card-def-input").value  = card.data.def;
      renderLatex(card.data.term, document.getElementById("card-term-preview"));
      renderLatex(card.data.def,  document.getElementById("card-def-preview"));
      openModal("card-termdef");
    } else if (card.format === "true-false") {
      document.getElementById("modal-card-tf-title").textContent = t("card.editCard");
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
      document.getElementById("modal-card-imagedef-title").textContent = t("card.editCard");
      stagedImageUrl = card.data.imageUrl;
      var prevImg = document.getElementById("card-image-preview");
      prevImg.src = card.data.imageUrl;
      prevImg.classList.remove("hidden");
      document.getElementById("card-image-drop-label").classList.add("hidden");
      document.getElementById("card-imagedef-input").value = card.data.def;
      openModal("card-imagedef");
    } else {
      document.getElementById("modal-card-mcq-title").textContent = t("card.editCard");
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

// After saving an edit, the lesson card list (if visible) is refreshed via renderCards() as
// before — but if the edit was opened from mid-Flashcard/Quiz session, that in-memory array
// won't pick up the change until the session restarts unless we patch it here too.
function syncEditedCardIntoStudySession(cardId, data) {
  if (state.editFromStudy) recordStudyEvent("card_fix", cardId);
  var fcCard = state.studyCards && state.studyCards.find(function(c) { return c.id === cardId; });
  if (fcCard) {
    fcCard.data = data;
    if (state.studyCards[state.studyIndex] === fcCard) renderFlashcard();
  }
  var quizCard = state.quizCards && state.quizCards.find(function(c) { return c.id === cardId; });
  if (quizCard) {
    quizCard.data = data;
    if (state.quizCards[state.quizIndex] === quizCard) renderQuizCard();
  }
}

document.getElementById("btn-save-card-termdef").addEventListener("click", function() {
  var term = document.getElementById("card-term-input").value.trim();
  var def  = document.getElementById("card-def-input").value.trim();
  if (!term || !def) { showFieldError(document.getElementById(term ? "card-def-input" : "card-term-input"), t("validate.fillTermDef")); return; }
  var data = { term: term, def: def };
  var editingId = state.editingCardId;
  var editingLessonId = state.editingCardLessonId;
  withBusy(this, function() {
    var p;
    if (editingId) {
      p = store.updateCard(editingId, editingLessonId, { data: data });
    } else {
      p = store.createCard({ lessonId: state.currentLesson.id, format: "term-def", data: data });
    }
    return p.then(function() {
      closeModal("card-termdef");
      if (editingId) syncEditedCardIntoStudySession(editingId, data);
      renderCards();
      if (getActiveScreen() === "upstream") renderUpstream();
    });
  });
});

document.getElementById("btn-save-card-mcq").addEventListener("click", function() {
  var q = document.getElementById("card-q-input").value.trim();
  var c = document.getElementById("card-correct-input").value.trim();
  var distractors = Array.from(
    document.getElementById("mcq-distractor-list").querySelectorAll("input")
  ).map(function(i) { return i.value.trim(); }).filter(Boolean);
  if (!q || !c || distractors.length === 0 || distractors.length > 4) {
    var emptyMcq = !q ? "card-q-input" : !c ? "card-correct-input" : "mcq-distractor-list";
    showFieldError(document.getElementById(emptyMcq), t("validate.fillMcq"));
    return;
  }
  var explanation = document.getElementById("card-explanation-input").value.trim();
  var data = { question: q, correct: c, distractors: distractors };
  if (explanation) data.explanation = explanation;
  var editingId = state.editingCardId;
  var editingLessonId = state.editingCardLessonId;
  withBusy(this, function() {
    var p;
    if (editingId) {
      p = store.updateCard(editingId, editingLessonId, { data: data });
    } else {
      p = store.createCard({ lessonId: state.currentLesson.id, format: "mcq", data: data });
    }
    return p.then(function() {
      closeModal("card-mcq");
      if (editingId) syncEditedCardIntoStudySession(editingId, data);
      renderCards();
    });
  });
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
  clearFieldError(document.getElementById("tf-answer-picker"));
});

document.getElementById("card-tf-statement-input").addEventListener("input", function() {
  renderLatex(this.value, document.getElementById("card-tf-statement-preview"));
});

document.getElementById("btn-save-card-tf").addEventListener("click", function() {
  var statement = document.getElementById("card-tf-statement-input").value.trim();
  if (!statement) { showFieldError(document.getElementById("card-tf-statement-input"), t("validate.enterStatement")); return; }
  if (!state.tfAnswer) { showFieldError(document.getElementById("tf-answer-picker"), t("validate.selectTrueFalse")); return; }
  var explanation = document.getElementById("card-tf-explanation-input").value.trim();
  var data = { statement: statement, correct: state.tfAnswer };
  if (explanation) data.explanation = explanation;
  var editingId = state.editingCardId;
  var editingLessonId = state.editingCardLessonId;
  withBusy(this, function() {
    var p = editingId
      ? store.updateCard(editingId, editingLessonId, { data: data })
      : store.createCard({ lessonId: state.currentLesson.id, format: "true-false", data: data });
    return p.then(function() {
      closeModal("card-tf");
      if (editingId) syncEditedCardIntoStudySession(editingId, data);
      renderCards();
    });
  });
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
  if (!IS_SERVER) { showFieldError(document.getElementById("card-image-drop"), t("validate.imageUploadRequiresServer")); return; }
  var ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  if (ALLOWED.indexOf(file.type) === -1) {
    showFieldError(document.getElementById("card-image-drop"), t("validate.unsupportedFileType"));
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showFieldError(document.getElementById("card-image-drop"), t("validate.fileTooLarge"));
    return;
  }
  clearFieldError(document.getElementById("card-image-drop"));
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
    .then(function(r) { return r.json().then(function(d) { if (!r.ok) throw new Error(serverError(d, t("error.uploadFailed"))); return d; }); })
    .then(function(d) { if (uploadSeq === mySeq) stagedImageUrl = d.url; })
    .catch(function(err) { if (uploadSeq === mySeq) { showToast(t("error.uploadFailedWithMessage", { message: err.message }), "error"); stagedImageUrl = previousUrl; } });
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
  if (!stagedImageUrl) { showFieldError(document.getElementById("card-image-drop"), t("validate.chooseImageFirst")); return; }
  var def = document.getElementById("card-imagedef-input").value.trim();
  if (!def) { showFieldError(document.getElementById("card-imagedef-input"), t("validate.enterDefinition")); return; }
  var data = { imageUrl: stagedImageUrl, def: def };
  var editingId = state.editingCardId;
  var editingLessonId = state.editingCardLessonId;
  withBusy(this, function() {
    var p = editingId
      ? store.updateCard(editingId, editingLessonId, { data: data })
      : store.createCard({ lessonId: state.currentLesson.id, format: "image-def", data: data });
    return p.then(function() {
      closeModal("card-imagedef");
      if (editingId) syncEditedCardIntoStudySession(editingId, data);
      renderCards();
    });
  });
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
  var rejected = [];
  var cards = format === "term-def" ? parseBulkTermDef(raw, rejected) : format === "true-false" ? parseBulkTF(raw, rejected) : parseBulkMCQ(raw, rejected);
  preview.innerHTML = "";
  if (cards.length === 0 && rejected.length === 0) return;
  var countEl = document.createElement("div");
  countEl.className = "bulk-preview-count";
  countEl.textContent = t("bulk.cardsDetected", { n: cards.length });
  preview.appendChild(countEl);
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
      defEl.textContent = "✓ " + (card.data.correct === "true" ? t("common.true") : t("common.false"));
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
    more.textContent = t("bulk.andMore", { n: cards.length - 5 });
    preview.appendChild(more);
  }
  renderBulkRejected(preview, rejected);
}

// Lists the lines a bulk paste will skip and why, so nothing is dropped silently.
function renderBulkRejected(container, rejected) {
  if (!rejected.length) return;
  var box = document.createElement("div");
  box.className = "bulk-preview-rejected";
  var head = document.createElement("div");
  head.className = "bulk-preview-rejected-head";
  head.textContent = t("bulk.linesSkipped", { n: rejected.length });
  box.appendChild(head);
  rejected.slice(0, 10).forEach(function(r) {
    var row = document.createElement("div");
    row.textContent = t("bulk.lineReason", { n: r.line, reason: r.reason });
    box.appendChild(row);
  });
  if (rejected.length > 10) {
    var more = document.createElement("div");
    more.textContent = t("bulk.andMore", { n: rejected.length - 10 });
    box.appendChild(more);
  }
  container.appendChild(box);
}

function openBulkAdd() {
  if (!state.currentLesson) return;
  var format = state.currentLesson.format;
  document.getElementById("modal-bulk-title").textContent = t("bulk.addCardsTitle");
  document.getElementById("bulk-input").value = "";
  document.getElementById("bulk-preview").innerHTML = "";
  var errEl = document.getElementById("bulk-error");
  if (errEl) errEl.classList.add("hidden");
  var hint = format === "term-def"
    ? t("bulk.hintTermDef")
    : format === "true-false"
    ? t("bulk.hintTrueFalse")
    : t("bulk.hintMcq");
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
    if (errEl) { errEl.textContent = t("bulk.noValidCards"); errEl.classList.remove("hidden"); }
    return;
  }
  if (errEl) errEl.classList.add("hidden");
  var withLesson = cards.map(function(c) {
    return { lessonId: state.currentLesson.id, format: c.format, data: c.data };
  });
  withBusy(this, function() {
    return store.createCards(withLesson).then(function() {
      closeModal("bulk");
      renderCards();
      showToast(t("toast.cardsAdded", { n: withLesson.length }));
    });
  });
});

/* ============================
   DELETE CONFIRM
   ============================ */

function confirmAction(msg, cb, actionKey) {
  var keys = { archive: ["confirm.archiveTitle", "common.archive"], leave: ["confirm.leaveTitle", "study.exit"],
    discard: ["confirm.discardTitle", "confirm.discard"], review: ["confirm.reviewTitle", "upstream.markReviewed"],
    disableLink: ["share.disableLinkTitle", "share.disableLink"] }[actionKey]
    || ["delete.confirmTitle", "common.delete"];
  var titleKey = keys[0];
  var buttonKey = keys[1];
  var title = document.getElementById("delete-confirm-title");
  var button = document.getElementById("btn-confirm-delete");
  if (title) {
    title.setAttribute("data-i18n", titleKey);
    title.textContent = t(titleKey);
  }
  if (button) {
    button.setAttribute("data-i18n", buttonKey);
    button.textContent = t(buttonKey);
  }
  document.getElementById("delete-confirm-text").textContent = msg;
  state.deleteCallback = cb;
  openModal("delete");
}

function confirmDelete(msg, cb) {
  confirmAction(msg, cb, "delete");
}

document.getElementById("btn-confirm-delete").addEventListener("click", function() {
  haptic("danger");
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
  document.getElementById("setup-filter-hint").textContent = t(FILTER_HINT_KEYS.all);
  document.getElementById("setup-mode-hint").textContent = t(MODE_HINT_KEYS.flashcard);

  // Say what's being studied: the lesson's name, or how many lessons together.
  var scopeLabel = document.getElementById("setup-scope-label");
  var scopeLessons = state.studyScope.lessons;
  scopeLabel.textContent = scopeLessons.length > 1
    ? t("setup.studyingTogether", { n: scopeLessons.length })
    : (scopeLessons[0] && scopeLessons[0].title) || "";
  scopeLabel.classList.toggle("hidden", !scopeLabel.textContent);

  // Show Interleaved pill only for multi-lesson sessions; always default to in-order
  var multiLesson = state.studyScope.lessons.length > 1;
  document.getElementById("pill-order-interleaved").style.display = multiLesson ? "" : "none";
  setPillGroup("setup-order", "in-order");

  renderSetupPresets();
  resetSetupPresetSaveRow();

  showScreen("setup");

  // Fetch card + stats data once up front — both the live match-count preview below and
  // the eventual Start click reuse this same promise (startStudy() awaits it too), so
  // opening Setup never causes more network round-trips than clicking Start alone used to.
  var matchCountEl = document.getElementById("setup-match-count");
  if (matchCountEl) matchCountEl.textContent = "";
  document.getElementById("btn-start-study").disabled = false;
  var requestId = ++state.setupRequestId;
  var ids = state.studyScope.lessonIds;
  var reviewsTodayPromise = IS_SERVER ? store.getReviewsToday() : Promise.resolve({ count: 0 });
  state.setupDataPromise = Promise.all([store.getBulkCards(ids), reviewsTodayPromise]).then(function(results) {
    var cards = results[0], reviewsToday = results[1].count;
    var knownMap = {};
    cards.forEach(function(c) {
      if (c.known !== null && c.known !== undefined) knownMap[c.id] = c.known === 1 || c.known === true;
    });
    return store.getDifficultyMap(cards.map(function(c) { return c.id; })).then(function(statsMap) {
      var data = { cards: cards, knownMap: knownMap, statsMap: statsMap, reviewsToday: reviewsToday };
      // Ignore if the user has since reopened Setup for a different scope before this resolved.
      if (requestId === state.setupRequestId) updateSetupMatchCount(data);
      return data;
    });
  }).catch(function() {
    // A rejected promise here would otherwise leave the match count blank forever and make
    // Start silently do nothing (its .then() never fires). Resolve with an empty card list
    // instead — startStudy() already alerts on a zero-card result, so Start still gives
    // the user a clear signal rather than a dead button.
    if (requestId === state.setupRequestId && matchCountEl) {
      matchCountEl.textContent = t("setup.loadFailed");
      matchCountEl.classList.add("setup-match-count-warn");
    }
    return { cards: [], knownMap: {}, statsMap: {}, reviewsToday: 0, loadFailed: true };
  });
}

function updateSetupMatchCount(data) {
  var countEl = document.getElementById("setup-match-count");
  if (!countEl || !data) return;
  // Keep saying the load failed; recounting the empty fallback would blame the filter.
  if (data.loadFailed) {
    countEl.textContent = t("setup.loadFailed");
    countEl.classList.add("setup-match-count-warn");
    return;
  }
  var filterPill = document.querySelector("#setup-filter .pill.active");
  var filter = filterPill ? filterPill.dataset.value : "all";
  var matched = filterCardsBySetup(data.cards, filter, data.knownMap, data.statsMap, data.reviewsToday);
  var countPill = document.querySelector("#setup-count .pill.active");
  var limit = countPill && countPill.dataset.value !== "all" ? parseInt(countPill.dataset.value, 10) : Infinity;
  var n = Math.min(limit, matched.length);
  countEl.classList.toggle("setup-match-count-warn", matched.length === 0);
  // Due Only and Needs Recall are capped by Max reviews per day, while Home's due badge is
  // not. Saying "no cards match" next to a "20 due" badge reads as a bug, so name the cap.
  var uncapped = matched.length === 0 && (filter === "due" || filter === "needsRecall")
    ? filterCardsBySetup(data.cards, filter, data.knownMap, data.statsMap, data.reviewsToday, true).length : 0;
  countEl.textContent = uncapped > 0
    ? t("setup.reviewCapReached", { due: uncapped, done: data.reviewsToday, cap: state.maxReviewsPerDay })
    : matched.length === 0 ? t("study.noCardsMatchFilter")
    : n < matched.length ? t("setup.studyCountOf", { n: n, total: matched.length })
    : t("setup.studyCount", { n: n });
  document.getElementById("btn-start-study").disabled = matched.length === 0;
}

function setPillGroup(groupId, value) {
  var group = document.getElementById(groupId);
  group.querySelectorAll(".pill").forEach(function(p) {
    p.classList.toggle("active", p.dataset.value === value);
    p.setAttribute("aria-pressed", String(p.dataset.value === value));
  });
}

function renderSetupPresets() {
  var list = document.getElementById("setup-presets-list");
  if (!list) return;
  list.innerHTML = state.studyPresets.map(function(preset, i) {
    var numBadge = i < 9 ? '<span class="setup-preset-chip-num">' + (i + 1) + '</span>' : '';
    return '<span class="setup-preset-chip" data-preset-id="' + escHtml(preset.id) + '">' +
      numBadge +
      '<span class="setup-preset-chip-name" data-preset-id="' + escHtml(preset.id) + '">' + escHtml(preset.name) + '</span>' +
      '<button class="setup-preset-chip-remove" data-preset-id="' + escHtml(preset.id) + '" title="' + escHtml(t("common.delete")) + '">' + ICON_X + '</button>' +
      '</span>';
  }).join("");
}

function applyStudyPreset(preset) {
  setPillGroup("setup-count", preset.count);
  setPillGroup("setup-filter", preset.filter);
  // needsRecall cards are, by definition, cards only ever confirmed via quiz recognition —
  // studying them in Quiz mode again wouldn't change that, so force Flashcard mode, same
  // guard as the manual filter-pill handler, so a preset can't silently produce a no-op session.
  var mode = preset.filter === "needsRecall" ? "flashcard" : preset.mode;
  setPillGroup("setup-mode", mode);
  // Interleaved only applies to multi-lesson sessions — its pill is hidden otherwise, so
  // falling back avoids silently activating a pill the user can't see.
  var multiLesson = state.studyScope && state.studyScope.lessons.length > 1;
  var order = preset.order === "interleaved" && !multiLesson ? "in-order" : preset.order;
  setPillGroup("setup-order", order);

  var filterHint = document.getElementById("setup-filter-hint");
  var filterKey = FILTER_HINT_KEYS[preset.filter];
  if (filterHint) filterHint.textContent = filterKey ? t(filterKey) : "";
  var modeHint = document.getElementById("setup-mode-hint");
  var modeKey = mode === "quiz" && state.quizCountsAsKnown ? "setup.hintQuizModeKnown" : MODE_HINT_KEYS[mode];
  if (modeHint) modeHint.textContent = modeKey ? t(modeKey) : "";

  var thisRequestId = state.setupRequestId;
  state.setupDataPromise.then(function(data) {
    if (thisRequestId === state.setupRequestId) updateSetupMatchCount(data);
  });
}

function savePresetsToServer() {
  fetch("/api/auth/preferences", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studyPresets: state.studyPresets })
  }).catch(function() {});
  try {
    var cached = JSON.parse(localStorage.getItem("fc-preferences") || "{}");
    cached.studyPresets = state.studyPresets;
    localStorage.setItem("fc-preferences", JSON.stringify(cached));
  } catch (_) {}
}

function resetSetupPresetSaveRow() {
  document.getElementById("setup-preset-name-input").classList.add("hidden");
  document.getElementById("setup-preset-name-input").value = "";
  document.getElementById("btn-setup-confirm-preset").classList.add("hidden");
  document.getElementById("btn-setup-cancel-preset").classList.add("hidden");
  document.getElementById("btn-setup-save-preset").classList.remove("hidden");
}

document.getElementById("setup-presets-list").addEventListener("click", function(e) {
  var removeBtn = e.target.closest(".setup-preset-chip-remove");
  if (removeBtn) {
    var presetId = removeBtn.dataset.presetId;
    var preset = state.studyPresets.filter(function(p) { return p.id === presetId; })[0];
    if (!preset) return;
    confirmDelete(t("setup.deletePresetConfirm", { name: preset.name }), function() {
      state.studyPresets = state.studyPresets.filter(function(p) { return p.id !== presetId; });
      savePresetsToServer();
      renderSetupPresets();
    });
    return;
  }
  var chipName = e.target.closest(".setup-preset-chip-name");
  if (chipName) {
    var preset2 = state.studyPresets.filter(function(p) { return p.id === chipName.dataset.presetId; })[0];
    if (preset2) applyStudyPreset(preset2);
  }
});

document.getElementById("btn-setup-save-preset").addEventListener("click", function() {
  this.classList.add("hidden");
  document.getElementById("btn-setup-confirm-preset").classList.remove("hidden");
  document.getElementById("btn-setup-cancel-preset").classList.remove("hidden");
  var input = document.getElementById("setup-preset-name-input");
  input.classList.remove("hidden");
  input.focus();
});

document.getElementById("btn-setup-cancel-preset").addEventListener("click", function() {
  resetSetupPresetSaveRow();
});

document.getElementById("setup-preset-name-input").addEventListener("keydown", function(e) {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === "Enter") { e.preventDefault(); document.getElementById("btn-setup-confirm-preset").click(); }
  else if (e.key === "Escape") { e.preventDefault(); document.getElementById("btn-setup-cancel-preset").click(); }
});

document.getElementById("btn-setup-confirm-preset").addEventListener("click", function() {
  var name = document.getElementById("setup-preset-name-input").value.trim();
  if (!name) return;
  var orderEl = document.querySelector("#setup-order .pill.active");
  var preset = {
    id: genId("preset"),
    name: name,
    count: document.querySelector("#setup-count .pill.active").dataset.value,
    filter: document.querySelector("#setup-filter .pill.active").dataset.value,
    mode: document.querySelector("#setup-mode .pill.active").dataset.value,
    order: orderEl ? orderEl.dataset.value : "in-order"
  };
  state.studyPresets.push(preset);
  savePresetsToServer();
  renderSetupPresets();
  resetSetupPresetSaveRow();
});

/* ============================
   MANAGE PRESETS (reorder / rename / update-to-current)
   ============================ */

// Short display labels for a preset's saved values, nested under one object (rather than three
// separate top-level vars) to keep this feature's lookup tables from adding to the module's
// already-large set of globals. Distinct from FILTER_HINT_KEYS/MODE_HINT_KEYS below (those are
// full descriptive sentences for the setup screen's hint text, not compact enough here).
var PRESET_LABEL_KEYS = {
  filter: { all: "setup.allCards", due: "setup.dueOnly", needsRecall: "setup.needsRecall", learning: "setup.stillLearning", updated: "setup.updated" },
  mode: { flashcard: "setup.flashcards", "flashcard-write": "setup.flashcardWrite", quiz: "setup.quiz" },
  order: { "in-order": "setup.inOrder", shuffle: "common.shuffle", interleaved: "setup.interleaved" }
};
function presetLabel(kind, value) {
  var key = PRESET_LABEL_KEYS[kind][value];
  return key ? t(key) : value;
}

// "Update to current setup" has no visible effect on the row otherwise — reorder/rename/
// delete are all self-evidently visible (the row moves/renames/disappears), but overwriting
// count/filter/mode/order previously changed nothing a user could see without hovering a
// tooltip. This summary line is both the "what does this preset currently hold" context AND
// the after-the-fact confirmation that an update actually took effect.
function formatPresetSummary(preset) {
  var count = preset.count === "all" ? t("setup.all") : preset.count;
  return [count, presetLabel("filter", preset.filter), presetLabel("mode", preset.mode), presetLabel("order", preset.order)].join(" · ");
}

// A function, not a cached string — it's re-read at render time AND at the flash-feedback
// revert (below), and both need the label re-evaluated fresh against the active language, not
// frozen at whatever language was active when the script first loaded.
function manageUpdateBtnDefaultHtml() {
  return ICON_SAVE + " " + t("setup.updatePresetHint");
}

function renderManagePresetsList() {
  var list = document.getElementById("manage-presets-list");
  var presets = state.studyPresets;
  document.getElementById("manage-presets-empty").classList.toggle("hidden", presets.length > 0);
  list.innerHTML = presets.map(function(preset, i) {
    return '<div class="manage-preset-row">' +
      '<div class="manage-preset-row-top">' +
        '<span class="manage-preset-num">' + (i + 1) + '</span>' +
        '<div class="manage-preset-reorder">' +
          '<button class="icon-btn manage-preset-up" data-preset-id="' + escHtml(preset.id) + '" title="' + escHtml(t("setup.moveUp")) + '" aria-label="' + escHtml(t("setup.moveUp")) + '"' + (i === 0 ? " disabled" : "") + '>' + ICON_CHEVRON_UP + '</button>' +
          '<button class="icon-btn manage-preset-down" data-preset-id="' + escHtml(preset.id) + '" title="' + escHtml(t("setup.moveDown")) + '" aria-label="' + escHtml(t("setup.moveDown")) + '"' + (i === presets.length - 1 ? " disabled" : "") + '>' + ICON_CHEVRON_DOWN + '</button>' +
        '</div>' +
        '<span class="manage-preset-name">' + escHtml(preset.name) + '</span>' +
        '<input type="text" class="manage-preset-name-input hidden" data-preset-id="' + escHtml(preset.id) + '" maxlength="40" value="' + escHtml(preset.name) + '">' +
        '<button class="icon-btn manage-preset-rename" title="' + escHtml(t("setup.renamePreset")) + '" aria-label="' + escHtml(t("setup.renamePreset")) + '">' + ICON_EDIT + '</button>' +
        '<button class="icon-btn danger manage-preset-delete" data-preset-id="' + escHtml(preset.id) + '" title="' + escHtml(t("common.delete")) + '" aria-label="' + escHtml(t("common.delete")) + '">' + ICON_DELETE + '</button>' +
      '</div>' +
      '<div class="manage-preset-row-bottom">' +
        '<span class="manage-preset-summary">' + escHtml(formatPresetSummary(preset)) + '</span>' +
        '<button class="btn btn-sm btn-ghost manage-preset-update" data-preset-id="' + escHtml(preset.id) + '">' + manageUpdateBtnDefaultHtml() + '</button>' +
      '</div>' +
    '</div>';
  }).join("");
}

document.getElementById("btn-manage-presets").addEventListener("click", function() {
  renderManagePresetsList();
  openModal("manage-presets");
});

function movePreset(presetId, direction) {
  var idx = state.studyPresets.findIndex(function(p) { return p.id === presetId; });
  var newIdx = idx + direction;
  if (idx === -1 || newIdx < 0 || newIdx >= state.studyPresets.length) return;
  var tmp = state.studyPresets[idx];
  state.studyPresets[idx] = state.studyPresets[newIdx];
  state.studyPresets[newIdx] = tmp;
  savePresetsToServer();
  renderManagePresetsList();
  renderSetupPresets();
}

// Rename commits on focusout (covers Enter-via-blur, Tab, and click-away in one place) rather
// than a separate confirm button — the input row already reads as "editing," and firing on
// blur matches how the existing preset-name field elsewhere just gets typed into directly.
//
// Deliberately does NOT call renderManagePresetsList() — a full re-render replaces the list's
// innerHTML, which detaches every button in it, including whatever the user is mid-click on:
// clicking a DIFFERENT row's Update/Delete/move button while this input is still focused blurs
// it first (mousedown fires before click), and if that blur's handler re-rendered the list out
// from under the click, the click event would arrive at a now-detached node and never bubble to
// the delegated listener below — silently swallowing that click. Updating just this one row's
// two elements in place keeps every other button's identity intact across the commit.
function commitPresetRename(inputEl) {
  var presetId = inputEl.dataset.presetId;
  var preset = state.studyPresets.filter(function(p) { return p.id === presetId; })[0];
  if (!preset) return;
  var trimmed = inputEl.value.trim();
  if (trimmed && trimmed !== preset.name) {
    preset.name = trimmed;
    savePresetsToServer();
    renderSetupPresets(); // a different list, on a different screen — safe to fully re-render
  }
  var row = inputEl.closest(".manage-preset-row");
  row.querySelector(".manage-preset-name").textContent = preset.name;
  inputEl.value = preset.name;
  inputEl.classList.add("hidden");
  row.querySelector(".manage-preset-name").classList.remove("hidden");
}

document.getElementById("manage-presets-list").addEventListener("click", function(e) {
  var upBtn = e.target.closest(".manage-preset-up");
  if (upBtn) { movePreset(upBtn.dataset.presetId, -1); return; }
  var downBtn = e.target.closest(".manage-preset-down");
  if (downBtn) { movePreset(downBtn.dataset.presetId, 1); return; }

  var renameBtn = e.target.closest(".manage-preset-rename");
  if (renameBtn) {
    var row = renameBtn.closest(".manage-preset-row");
    row.querySelector(".manage-preset-name").classList.add("hidden");
    var input = row.querySelector(".manage-preset-name-input");
    input.classList.remove("hidden");
    input.focus();
    input.select();
    return;
  }

  var updateBtn = e.target.closest(".manage-preset-update");
  if (updateBtn) {
    var preset = state.studyPresets.filter(function(p) { return p.id === updateBtn.dataset.presetId; })[0];
    if (!preset) return;
    var orderEl = document.querySelector("#setup-order .pill.active");
    preset.count = document.querySelector("#setup-count .pill.active").dataset.value;
    preset.filter = document.querySelector("#setup-filter .pill.active").dataset.value;
    preset.mode = document.querySelector("#setup-mode .pill.active").dataset.value;
    preset.order = orderEl ? orderEl.dataset.value : "in-order";
    savePresetsToServer();
    // The summary line is the real feedback (it now visibly shows the new values) — the
    // button's own text briefly confirming "Updated" on top of that (same pattern as "Copy
    // Prompt" elsewhere in this file) covers the case where the values happened to already
    // match, when the summary line wouldn't visibly change at all.
    updateBtn.closest(".manage-preset-row-bottom").querySelector(".manage-preset-summary").textContent = formatPresetSummary(preset);
    flashButtonFeedback(updateBtn, ICON_CHECK + " " + t("setup.presetUpdated"), manageUpdateBtnDefaultHtml(), 1500);
    return;
  }

  var deleteBtn = e.target.closest(".manage-preset-delete");
  if (deleteBtn) {
    var presetId = deleteBtn.dataset.presetId;
    var toDelete = state.studyPresets.filter(function(p) { return p.id === presetId; })[0];
    if (!toDelete) return;
    confirmDelete(t("setup.deletePresetConfirm", { name: toDelete.name }), function() {
      state.studyPresets = state.studyPresets.filter(function(p) { return p.id !== presetId; });
      savePresetsToServer();
      renderManagePresetsList();
      renderSetupPresets();
    });
  }
});

document.getElementById("manage-presets-list").addEventListener("keydown", function(e) {
  if (e.target.classList.contains("manage-preset-name-input") && e.key === "Enter") {
    e.preventDefault();
    e.target.blur(); // triggers the focusout handler below, which commits
  }
});

document.getElementById("manage-presets-list").addEventListener("focusout", function(e) {
  if (e.target.classList.contains("manage-preset-name-input")) {
    commitPresetRename(e.target);
  }
});

// Pill group click handlers
var FILTER_HINT_KEYS = {
  all:         "setup.hintAll",
  due:         "setup.hintDue",
  needsRecall: "setup.hintNeedsRecall",
  learning:    "setup.hintLearning",
  updated:     "setup.hintUpdated"
};

var MODE_HINT_KEYS = {
  flashcard:       "setup.hintFlashcardMode",
  "flashcard-write": "setup.hintFlashcardWriteMode",
  quiz:            "setup.hintQuizMode"
};

["setup-count","setup-filter","setup-mode","setup-order"].forEach(function(groupId) {
  document.getElementById(groupId).addEventListener("click", function(e) {
    var pill = e.target.closest(".pill");
    if (!pill) return;
    setPillGroup(groupId, pill.dataset.value);
    // A mouse click leaves the pill focused, which would make the next Enter re-select it
    // instead of starting the session.
    if (e.detail) pill.blur();
    if (groupId === "setup-filter") {
      var hint = document.getElementById("setup-filter-hint");
      var key = FILTER_HINT_KEYS[pill.dataset.value];
      if (hint) hint.textContent = key ? t(key) : "";
      // needsRecall cards are only ever confirmed via quiz recognition — default to
      // Flashcard so picking this filter doesn't silently produce a no-op session.
      if (pill.dataset.value === "needsRecall") {
        setPillGroup("setup-mode", "flashcard");
        var modeHintOnFilterSwitch = document.getElementById("setup-mode-hint");
        if (modeHintOnFilterSwitch) modeHintOnFilterSwitch.textContent = t(MODE_HINT_KEYS.flashcard);
      }
    }
    // Filter changes which cards match; Card Count changes how many of them are studied.
    if (groupId === "setup-filter" || groupId === "setup-count") {
      var thisRequestId = state.setupRequestId;
      state.setupDataPromise.then(function(data) {
        if (thisRequestId === state.setupRequestId) updateSetupMatchCount(data);
      });
    }
    if (groupId === "setup-mode") {
      var modeHint = document.getElementById("setup-mode-hint");
      var modeKey = pill.dataset.value === "quiz" && state.quizCountsAsKnown ? "setup.hintQuizModeKnown" : MODE_HINT_KEYS[pill.dataset.value];
      if (modeHint) modeHint.textContent = modeKey ? t(modeKey) : "";
    }
  });
});

// Leaving mid-session by keyboard or browser Back asks first; the Exit button stays a
// one-tap escape hatch. The session summary is deliberately not shown for an early exit.
function confirmLeaveStudy(leave) {
  var quiz = getActiveScreen() === "quiz";
  var log = state.studySessionLog || {};
  var done = quiz ? state.quizResults.length : state.studyCards.filter(function(c) { return log[c.id]; }).length;
  var total = quiz ? state.quizCards.length : state.studyCards.length;
  if (!done || done >= total) { leave(); return; }
  confirmAction(t("confirm.leaveSession", { n: done }), leave, "leave");
}

function markFcOverflow() {
  ["fc-front-content", "fc-back-content"].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("fc-long", el.textContent.length > FC_LONG_TEXT);
    el.classList.toggle("fc-more", el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  });
}
var FC_LONG_TEXT = 140;
["fc-front-content", "fc-back-content"].forEach(function(id) {
  var el = document.getElementById(id);
  if (el) el.addEventListener("scroll", markFcOverflow, { passive: true });
});
window.addEventListener("resize", function() {
  if (document.getElementById("screen-flashcard").classList.contains("active")) markFcOverflow();
});

// Return to wherever study was launched from (a lesson, or the class list for multi-lesson study)
function returnFromStudy() {
  dismissGradeUndo();
  clearTimeout(state.fcAdvanceTimer);
  clearTimeout(state.quizAdvanceTimer);
  clearFlashcardTranslation();
  var target = studyReturnTarget();
  showScreen(target);
  if (target === "home") renderHome();
  else if (target === "upstream") renderUpstream();
  else if (target === "dashboard") renderDashboard();
  // The card list, not the class's lesson list: the session just changed every pill on it.
  else if (target === "lesson") renderCards();
  else renderLessons();
}

function studyReturnTarget() {
  return state.studyScope && state.studyScope.returnScreen ? state.studyScope.returnScreen : "lesson";
}

var BACK_LABEL_KEYS = {
  lesson: "results.backToLesson", home: "results.backToHome", class: "results.backToClass",
  upstream: "results.backToUpdates", dashboard: "results.backToDashboard"
};

// The end-screen button names where it actually goes; it said "Back to Lesson" after a
// session started from Home, a class or Updates.
function setStudyBackLabels() {
  var key = BACK_LABEL_KEYS[studyReturnTarget()] || BACK_LABEL_KEYS.lesson;
  ["btn-results-back", "btn-summary-back"].forEach(function(id) {
    var el = document.getElementById(id);
    el.setAttribute("data-i18n", key);
    applyI18n(el.parentNode);
  });
}

/* ============================
   SESSION COMPLETE
   ============================ */

// Same clamp as the server's (attempts.js MAX_DURATION_MS): a card left open over lunch
// should not turn a six-minute session into an hour.
var SESSION_CARD_MAX_MS = 5 * 60 * 1000;
var STREAK_MILESTONES = [7, 14, 30, 50, 100, 200, 365, 500, 1000];

// Today's numbers as they were before this session, so the end screen can tell whether this
// session is what extended the streak or reached the daily goal.
function beginStudySession() {
  dismissGradeUndo();
  state.sessionMs = 0;
  state.sessionDurations = [];
  state.sessionTodayAtStart = null;
  var token = state.sessionToken = {};
  if (IS_SERVER && store.getToday) {
    store.getToday().then(function(today) {
      if (state.sessionToken === token) state.sessionTodayAtStart = today;
    }).catch(function() {});
  }
  state.sessionAchAtStart = null;
  if (IS_SERVER && store.getAchievements) {
    store.getAchievements().then(function(data) {
      if (state.sessionToken === token) state.sessionAchAtStart = achSnapshot(data);
    }).catch(function() {});
  }
}

// Returns what was added, so undoing a grade can take the same amount back off.
function addSessionTime(ms) {
  if (typeof ms !== "number" || !(ms > 0)) return 0;
  ms = Math.min(ms, SESSION_CARD_MAX_MS);
  state.sessionMs = (state.sessionMs || 0) + ms;
  (state.sessionDurations = state.sessionDurations || []).push(ms);
  return ms;
}

// Brainscape's "estimated time left". Seconds per card come from this session once it has
// three answers (pace varies by lesson and by day), else from the user's own history for the
// mode, else a guess. A median throughout, so one long pause does not swing it.
var ETA_FALLBACK_MS = { flashcard: 10000, quiz: 15000 };
var ETA_MIN_SAMPLES = 3;

function medianOf(values) {
  if (!values || !values.length) return null;
  var sorted = values.slice().sort(function(a, b) { return a - b; });
  var mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function estimateTimeLeftMs(remaining, source) {
  if (!(remaining > 0)) return 0;
  var own = state.sessionDurations && state.sessionDurations.length >= ETA_MIN_SAMPLES ? medianOf(state.sessionDurations) : null;
  var history = state.sessionTodayAtStart && state.sessionTodayAtStart.medianMs ? state.sessionTodayAtStart.medianMs[source] : null;
  return remaining * (own || history || ETA_FALLBACK_MS[source]);
}

function formatTimeLeft(ms) {
  if (!(ms > 0)) return "";
  return ms < 60000 ? t("eta.underMinute") : t("eta.minutes", { n: Math.round(ms / 60000) });
}

function studyProgressText(position, total, remaining, source) {
  var eta = formatTimeLeft(estimateTimeLeftMs(remaining, source));
  return position + " / " + total + (eta ? " · " + eta : "");
}

function formatSessionTime(ms) {
  var sec = Math.round((ms || 0) / 1000);
  return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
}

function sessionHeadline(ratio) {
  return ratio >= 1 ? t("done.perfect") : ratio >= 0.8 ? t("done.great") : t("done.complete");
}

// What changed today because of this session: the streak ticking up on the day's first
// session (a milestone gets its own line), and the daily goal being crossed.
function sessionCheers(before, after, goal) {
  var lines = [];
  if (!before || !after) return lines;
  if (!before.studiedToday && after.studiedToday && after.streak > before.streak) {
    lines.push(STREAK_MILESTONES.indexOf(after.streak) !== -1
      ? { kind: "milestone", text: t("done.streakMilestone", { n: after.streak }) }
      : { kind: "streak", text: t("done.streak", { from: before.streak, to: after.streak }) });
  }
  if (goal > 0 && before.count < goal && after.count >= goal) {
    lines.push({ kind: "goal", text: t("done.goalMet", { n: after.count }) });
  }
  return lines;
}

function renderSessionDone(id, ratio, tiles) {
  var box = document.getElementById(id);
  box.innerHTML =
    '<div class="session-done-title">' + escHtml(sessionHeadline(ratio)) + '</div>' +
    '<div class="session-tiles">' + tiles.map(function(tile, i) {
      return '<div class="session-tile tone-' + tile.tone + '" style="animation-delay:' + (i * 90) + 'ms">' +
        '<div class="session-tile-label">' + escHtml(tile.label) + '</div>' +
        '<div class="session-tile-value">' + escHtml(String(tile.value)) + '</div>' +
      '</div>';
    }).join('') + '</div>' +
    '<div class="session-cheers" aria-live="polite"></div>';
  var before = state.sessionTodayAtStart;
  var achBefore = state.sessionAchAtStart;
  if (!IS_SERVER || !store.getToday || (!before && !achBefore)) return;
  var token = state.sessionToken;
  // The last answers may still be queued; read today's numbers only once they are written.
  store.writesSettled().then(function() {
    return Promise.all([
      before ? store.getToday() : null,
      achBefore ? refreshAchievements().catch(function() { return null; }) : null
    ]);
  }).then(function(res) {
    if (state.sessionToken !== token) return;
    var after = res[0];
    var lines = after ? sessionCheers(before, after, state.dailyGoal) : [];
    var earned = res[1] ? achNewlyEarned(achBefore, res[1].items, 3) : [];
    if (!lines.length && !earned.length) return;
    box.querySelector(".session-cheers").innerHTML = lines.map(function(l) {
      return '<div class="session-cheer cheer-' + l.kind + '">' +
        (l.kind === "goal" ? dailyGoalRing(after.count, state.dailyGoal) : '<span class="session-flame">' + ICON_FLAME + '</span>') +
        '<span>' + escHtml(l.text) + '</span></div>';
    }).join('') + earned.map(function(it) {
      return '<div class="session-cheer cheer-ach"><span class="ach-medal ach-t' + achMedalTier(it.tier, it.tiers.length) + '">' + achIcon(it.key) + '</span>' +
        '<span>' + escHtml(achEarnedLineText(it)) + '</span></div>';
    }).join('');
    playSound("combo");
  }).catch(function() {});
}

// Shown when a flashcard session finishes normally (not on early Exit) — how many cards
// were graded, the new-vs-review split, and a status breakdown, all from state.studySessionLog.
function showFlashcardSummary() {
  haptic("complete");
  var log = state.studySessionLog || {};
  var gradedIds = Object.keys(log);
  var total = gradedIds.length;
  var counts = { learning: 0, hard: 0, known: 0, confident: 0 };
  var newCount = 0;
  gradedIds.forEach(function(id) {
    counts[log[id]]++;
    if (state.studySessionNewSet[id]) newCount++;
  });

  var knownCount = counts.hard + counts.known + counts.confident;
  renderSessionDone("summary-done", total > 0 ? knownCount / total : 0, [
    { label: t("done.cards"), value: total, tone: "gold" },
    { label: t("done.known"), value: (total ? Math.round(knownCount / total * 100) : 0) + "%", tone: "green" },
    { label: t("done.time"), value: formatSessionTime(state.sessionMs), tone: "blue" }
  ]);
  document.getElementById("summary-new-count").textContent = newCount;
  document.getElementById("summary-review-count").textContent = total - newCount;

  document.getElementById("summary-status-breakdown").innerHTML =
    diffBar(t("study.learning"),  counts.learning,  total, "var(--danger)") +
    diffBar(t("study.hard"),      counts.hard,      total, "var(--warning)") +
    diffBar(t("study.knowIt"),    counts.known,     total, "var(--success)") +
    diffBar(t("study.confident"), counts.confident, total, "var(--primary)");

  var skippedCount = (state.studyCards ? state.studyCards.length : 0) - total;
  var skippedNote = document.getElementById("summary-skipped-note");
  if (skippedCount > 0) {
    skippedNote.textContent = t("summary.skippedNote", { n: skippedCount });
    skippedNote.classList.remove("hidden");
  } else {
    skippedNote.classList.add("hidden");
  }

  setStudyBackLabels();
  showScreen("flashcard-summary");
}

document.getElementById("btn-summary-back").addEventListener("click", function() {
  returnFromStudy();
});

// Lets the user browse back through the session's cards (Prev/Next) instead of only
// being able to leave — useful now that finishing the last card auto-shows this screen
// with no pause to look it over first.
document.getElementById("btn-summary-review").addEventListener("click", function() {
  showScreen("flashcard");
  renderFlashcard();
});

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

// Takes one card from each group in turn (round-robin), skipping groups once they're
// exhausted — guarantees alternation across groups instead of relying on chance, unlike a
// flat shuffle of the combined list.
function roundRobinMerge(groups) {
  var result = [];
  var maxLen = groups.reduce(function(m, g) { return Math.max(m, g.length); }, 0);
  for (var i = 0; i < maxLen; i++) {
    groups.forEach(function(g) { if (i < g.length) result.push(g[i]); });
  }
  return result;
}

// Caps due/needsRecall cards to the user's remaining daily review budget (Preferences →
// Max reviews per day), prioritizing the most-overdue cards rather than arbitrary DB order.
// "Reviews done today" counts answers to cards first answered before today; new cards'
// first-day answers are not reviews (server/lib/today.js).
function applyReviewCap(dueCards, reviewsToday) {
  // null/undefined means "no limit" — checked explicitly (not a truthy check) so a real
  // cap of 0 ("study nothing today") isn't mistaken for "no limit" set.
  if (state.maxReviewsPerDay === null || state.maxReviewsPerDay === undefined) return dueCards;
  var remaining = Math.max(0, state.maxReviewsPerDay - reviewsToday);
  return dueCards.slice().sort(function(a, b) { return (a.srs_due_at || 0) - (b.srs_due_at || 0); }).slice(0, remaining);
}

// Shared between the live match-count preview on Study Setup and startStudy() itself,
// so the two can never drift out of sync on what counts as a "match".
function filterCardsBySetup(cards, filter, knownMap, statsMap, reviewsToday, ignoreCap) {
  if (filter === "due") {
    var nowSec2 = Math.floor(Date.now() / 1000);
    var due = cards.filter(function(c) { return c.srs_due_at && c.srs_due_at <= nowSec2; });
    return ignoreCap ? due : applyReviewCap(due, reviewsToday);
  } else if (filter === "needsRecall") {
    // A card "needs recall" if its most recent correct answer came from quiz recognition,
    // never from actively recalling it in Flashcard/Recall mode — the FSRS-era replacement
    // for the old ladder's step-position check (RECOGNITION_CAP_STEP), using the same
    // underlying intent: quiz answers are weaker evidence than active recall.
    var nowSec3 = Math.floor(Date.now() / 1000);
    var needsRecall = cards.filter(function(c) {
      return c.last_correct_source === "quiz" && c.srs_due_at && c.srs_due_at <= nowSec3;
    });
    return ignoreCap ? needsRecall : applyReviewCap(needsRecall, reviewsToday);
  } else if (filter === "learning") {
    return cards.filter(function(c) { return knownMap[c.id] !== true; });
  } else if (filter === "updated") {
    // Removed-from-source cards need a decision on the review screen, not studying.
    return cards.filter(function(c) { return c.upstream_change === "updated"; });
  }
  return cards;
}

function startStudy(count, filter, mode, order) {
  // Reuses the single fetch openSetup() already kicked off (populates state.setupDataPromise)
  // instead of re-fetching — the promise resolves immediately if it already has, or waits if not.
  state.setupDataPromise.then(function(data) {
    var cards = data.cards, knownMap = data.knownMap, statsMap = data.statsMap;
    var ids = state.studyScope ? state.studyScope.lessonIds : [state.currentLesson.id];
    var reviewsToday = data.reviewsToday;

    state.studyKnownMap = knownMap;
    state.studyStatsMap = statsMap;

    // Rebuild per-lesson grouping for blocked mode
    var byLesson = {};
    cards.forEach(function(c) {
      if (!byLesson[c.lesson_id]) byLesson[c.lesson_id] = [];
      byLesson[c.lesson_id].push(c);
    });
    var cardArrays = ids.map(function(id) { return byLesson[id] || []; });

    var filtered = filterCardsBySetup(cards, filter, knownMap, statsMap, reviewsToday);

    if (order === "blocked") {
      // Shuffle within each lesson group, then concatenate
      var grouped = cardArrays.map(function(arr) {
        var g = arr.filter(function(c) { return filtered.some(function(f) { return f.id === c.id; }); });
        return weightedShuffle(g, statsMap);
      });
      filtered = grouped.reduce(function(acc, g) { return acc.concat(g); }, []);
      if (count !== "all") filtered = filtered.slice(0, parseInt(count, 10));
    } else if (order === "shuffle") {
      if (count !== "all") {
        filtered = weightedShuffle(filtered, statsMap).slice(0, parseInt(count, 10));
      } else {
        filtered = weightedShuffle(filtered, statsMap);
      }
    } else if (order === "interleaved") {
      // Round-robin across lesson groups guarantees alternation, unlike a flat shuffle
      // (which is interleaved only in expectation and can still run several same-lesson
      // cards in a row by chance). Each group keeps its own weighted-difficulty ordering.
      var interleaveGroups = cardArrays.map(function(arr) {
        var g = arr.filter(function(c) { return filtered.some(function(f) { return f.id === c.id; }); });
        return weightedShuffle(g, statsMap);
      });
      filtered = roundRobinMerge(interleaveGroups);
      if (count !== "all") filtered = filtered.slice(0, parseInt(count, 10));
    } else {
      // "in-order": keep original DB order
      if (count !== "all") filtered = filtered.slice(0, parseInt(count, 10));
    }

    if (filtered.length === 0) {
      showToast(t("study.noCardsMatchFilter"));
      return;
    }

    state.studyMode = mode;

    // Record last_seen_at for all cards in this session (fire-and-forget)
    store.markCardsSeen(filtered.map(function(c) { return c.id; }));

    if (mode === "flashcard" || mode === "flashcard-write") {
      state.studyCards = filtered;
      state.studyIndex = 0;
      state.studyFlipped = false;
      // "Flashcard & Write" is Flashcard mode with the type-before-flip input forced on
      // for the whole session — same cards, same grading buttons, same SRS behavior, only
      // this one cosmetic difference. Previously a standalone Preferences toggle; now
      // chosen per-session as its own mode instead (see docs/decisions.md).
      state.typeToCompare = (mode === "flashcard-write");
      // Session-scoped grading log for the end-of-session summary screen — keyed by
      // cardId so re-grading the same card (via Prev/Next) counts once, at its latest
      // status. "New" is snapshotted now, before any grading in this session can change
      // it — a card with no prior attempts (last_studied_at unset) is new, else review.
      state.studySessionLog = {};
      state.studySessionNewSet = {};
      filtered.forEach(function(c) { if (!c.last_studied_at) state.studySessionNewSet[c.id] = true; });
      startFlashcards();
    } else if (mode === "quiz") {
      state.quizCards  = filtered;
      state.quizIndex  = 0;
      state.quizScore  = 0;
      state.quizResults = [];
      startQuiz();
    }
  });
}

/* ============================
   FLASHCARD STUDY
   ============================ */

function startFlashcards() {
  beginStudySession();
  // Screen must become visible before renderFlashcard() runs — it conditionally calls
  // .focus() on #fc-type-input, which is a silent no-op while still inside a display:none
  // ancestor (only matters at session start; subsequent cards render with the screen
  // already visible).
  showScreen("flashcard");
  renderFlashcard();
}

// Until the answer has been seen, the grade row is a single Show answer button, as in Anki:
// four faded grades read as broken, and they took the place where the reveal belongs.
function setAwaitingReveal(awaiting) {
  document.getElementById("fc-mark-btns").classList.toggle("awaiting-reveal", awaiting);
}

function setMarkButtonsEnabled(enabled) {
  ["btn-fc-learning", "btn-fc-hard", "btn-fc-known", "btn-fc-easy"].forEach(function(id) {
    document.getElementById(id).disabled = !enabled;
  });
  if (enabled && state.fcHintSteps > 0) applyHintGradeCap();
}

// A hinted answer was not recalled unaided, so Know It and Confident would tell FSRS the card
// is easier than it is and push the next review too far out. markCard() enforces the same cap
// for the keyboard and swipe paths, which do not go through the disabled buttons.
function applyHintGradeCap() {
  ["btn-fc-known", "btn-fc-easy"].forEach(function(id) {
    var btn = document.getElementById(id);
    btn.disabled = true;
    btn.title = t("hint.usedTitle");
  });
}

// Hints uncover the answer one word at a time, in reading order. Answers are mostly
// definitions, and a letter mask over a whole sentence (the first design) gave a line of
// underscores that changed everywhere at once on each press.
function hintWords(answer) {
  return (answer || "").normalize("NFC").trim().split(/\s+/).filter(Boolean);
}

// Uncovered words as text, the next few as blocks the length of their word, so you can see
// where you are in the sentence. The card face has a fixed height (220px on a phone), so a
// long definition shows only the last HINT_SHOWN_WINDOW words uncovered, HINT_BLOCKS_AHEAD
// blocks, and a count of the rest. Covered words are not in the DOM at all: a block made by
// colouring text transparent could be selected and read.
var HINT_SHOWN_WINDOW = 6;
var HINT_BLOCKS_AHEAD = 3;
function hintRevealHtml(answer, shown) {
  var words = hintWords(answer);
  var from = Math.max(0, shown - HINT_SHOWN_WINDOW);
  var to = Math.min(words.length, shown + HINT_BLOCKS_AHEAD);
  var parts = words.slice(from, to).map(function(w, k) {
    if (from + k < shown) return escHtml(w);
    return '<span class="hint-hid" style="width:' + Math.min(Array.from(w).length, 16) + 'ch" aria-hidden="true"></span>';
  });
  if (from > 0) parts.unshift("…");
  if (to < words.length) parts.push('<span class="hint-rest">' + escHtml(t("hint.moreWords", { n: words.length - to })) + '</span>');
  return parts.join(" ");
}

// Hints need a plain-text answer to mask; a formula would come out as a row of blanked TeX.
function hintAvailable(answer) {
  return !!(answer || "").trim() && !containsLatex(answer);
}

// Locks out everything but Exit (btn-fc-back, deliberately excluded below) while a
// forced-retype drill is pending, so the user can't skip the reinforcement step via
// Prev/Next/Shuffle/Edit/Delete/re-grading. Reaching Exit requires a mouse/tap during the
// drill — the per-screen keyboard shortcuts (1-4, arrows, Escape, etc.) are already inert
// while any <input> is focused (isInputFocused()), same as for the pre-existing
// type-before-flip scratchpad input. The app-wide Ctrl/Cmd+K search shortcut is a documented
// exception to that (it works from inside any text field everywhere in the app, not just
// here) and can still navigate away — unchanged, pre-existing behavior, out of scope here.
function setFlashcardNavLocked(locked) {
  ["btn-fc-prev", "btn-fc-next", "btn-fc-shuffle", "btn-fc-edit-card", "btn-fc-delete-card",
   "btn-fc-learning", "btn-fc-hard", "btn-fc-known", "btn-fc-easy"].forEach(function(id) {
    document.getElementById(id).disabled = locked;
  });
}

// Instantly (no animation) clears #fc-scene's inline transform left over from a swipe
// gesture's drag/fly-off/cancel (see initSwipeGestures) — shared by renderFlashcard() and
// beginForcedRetype(), the only two places that need the card visible/centered again after a
// swipe grade. Unconditional (no "is there anything to reset" check): a transition/transform
// toggle is a harmless no-op when there's nothing pending, and branching on it is what
// previously let the two call sites' copies quietly drift out of sync with each other.
function resetFlownOffScene(fcSceneEl) {
  fcSceneEl.style.transition = "none";
  fcSceneEl.style.transform = "";
  void fcSceneEl.offsetHeight; // force reflow so transition:none takes effect before it's cleared
  fcSceneEl.style.transition = "";
}

var vocabularySelectionText = "";
var vocabularySelection = null;
var vocabularySavePending = false;

function hideVocabularySelectionAction(clearText) {
  ["fc-selection-action", "quiz-selection-action"].forEach(function(id) {
    var action = document.getElementById(id);
    if (action) action.classList.add("hidden");
  });
  if (clearText) {
    vocabularySelectionText = "";
    vocabularySelection = null;
  }
}

// Where a selection may be saved from on the active study screen, with the card and the
// source text sent as context.
function vocabularySelectionTargets() {
  if (document.getElementById("screen-flashcard").classList.contains("active")) {
    return [{
      root: document.getElementById(state.studyFlipped ? "fc-back-content" : "fc-front-content"),
      card: state.studyCards[state.studyIndex],
      context: state.studyFlipped ? state.studyBackText : state.studyFrontText,
      actionId: "fc-selection-action",
      buttonId: "btn-save-selected-word"
    }];
  }
  if (document.getElementById("screen-quiz").classList.contains("active")) {
    var card = state.quizCards[state.quizIndex];
    if (!card) return [];
    var data = card.data || {};
    var explanation = document.querySelector("#quiz-explanation .explanation-body");
    var question = data.question || data.statement || data.term || "";
    var targets = [
      { root: document.getElementById("quiz-question"), context: question },
      { root: explanation, context: data.explanation || "" }
    ];
    document.querySelectorAll("#quiz-options .quiz-opt.answered .opt-text").forEach(function(el) {
      targets.push({ root: el, context: question + "\n" + el.textContent });
    });
    return targets.filter(function(target) { return target.root; }).map(function(target) {
      target.card = card;
      target.actionId = "quiz-selection-action";
      target.buttonId = "btn-quiz-save-selected-word";
      return target;
    });
  }
  return [];
}

function updateVocabularySelectionAction() {
  var selection = window.getSelection();
  if (!IS_SERVER || !selection || !selection.rangeCount) {
    hideVocabularySelectionAction(true);
    return;
  }

  var text = selection.toString().trim();
  var target = vocabularySelectionTargets().filter(function(t) {
    return t.root.contains(selection.anchorNode) && t.root.contains(selection.focusNode);
  })[0];
  if (!text || text.length > 1000 || !target || !target.card) {
    hideVocabularySelectionAction(true);
    return;
  }

  vocabularySelectionText = text;
  vocabularySelection = target;
  if (target.actionId === "quiz-selection-action" && state.quizAdvanceTimer) {
    clearTimeout(state.quizAdvanceTimer);
    showQuizNextButton();
  }
  var action = document.getElementById(target.actionId);
  var button = document.getElementById(target.buttonId);
  if (!vocabularySavePending) {
    button.disabled = false;
    button.textContent = t("study.saveWord");
  }
  action.classList.remove("hidden");
}

function saveSelectedVocabularyWord() {
  if (vocabularySavePending || !vocabularySelectionText || !vocabularySelection) return;
  var card = vocabularySelection.card;
  var button = document.getElementById(vocabularySelection.buttonId);
  var selectedText = vocabularySelectionText;
  var contextText = String(vocabularySelection.context || "").slice(0, 4000);
  vocabularySavePending = true;
  button.disabled = true;
  button.textContent = t("study.savingWord");
  store.saveVocabulary({
    selected_text: selectedText,
    context_text: contextText,
    source_card_id: card.id
  }).then(function() {
    vocabularySelectionText = "";
    button.disabled = true;
    button.textContent = t("study.wordQueued");
    refreshVocabularyQueue(false);
  }).catch(function(err) {
    if (err && (err.code === "duplicateWordQueued" || err.code === "duplicateWordFetched")) {
      vocabularySelectionText = "";
      button.disabled = true;
      button.textContent = t(err.code === "duplicateWordQueued" ? "study.wordAlreadyQueued" : "study.wordAlreadyFetched");
      return;
    }
    button.disabled = false;
    button.textContent = t("study.wordSaveFailed");
  }).then(function() {
    vocabularySavePending = false;
  });
}

document.addEventListener("selectionchange", updateVocabularySelectionAction);
["btn-save-selected-word", "btn-quiz-save-selected-word"].forEach(function(id) {
  var button = document.getElementById(id);
  button.addEventListener("mousedown", function(e) {
    e.preventDefault();
  });
  button.addEventListener("click", saveSelectedVocabularyWord);
});

function clearFlashcardTranslation() {
  state.translationRequestId++;
  state.translationPending = false;
  var el = document.getElementById("fc-translation");
  if (el) {
    el.textContent = "";
    el.removeAttribute("aria-label");
    el.classList.add("hidden");
    el.classList.remove("is-error", "is-pending");
  }
}

function translateVisibleFlashcardSide() {
  var card = state.studyCards[state.studyIndex];
  if (!card || state.translationPending) return;
  var text = state.studyFlipped ? state.studyBackText : state.studyFrontText;
  var targetLanguage = state.language;
  var el = document.getElementById("fc-translation");
  if (!text || !text.trim()) {
    clearFlashcardTranslation();
    el.textContent = t("study.translationEmpty");
    el.setAttribute("aria-label", el.textContent);
    el.classList.remove("hidden", "is-pending");
    el.classList.add("is-error");
    return;
  }
  if (!IS_SERVER) {
    clearFlashcardTranslation();
    el.textContent = t("study.translationUnavailable");
    el.setAttribute("aria-label", el.textContent);
    el.classList.remove("hidden", "is-pending");
    el.classList.add("is-error");
    return;
  }

  var requestId = ++state.translationRequestId;
  var snapshot = { cardId: card.id, index: state.studyIndex, flipped: state.studyFlipped, text: text, language: targetLanguage };
  state.translationPending = true;
  el.textContent = t("study.translating");
  el.setAttribute("aria-label", el.textContent);
  el.classList.remove("hidden", "is-error");
  el.classList.add("is-pending");

  store.translateText(text, targetLanguage).then(function(result) {
    if (requestId !== state.translationRequestId) return;
    var current = state.studyCards[state.studyIndex];
    if (!current || current.id !== snapshot.cardId || state.studyIndex !== snapshot.index ||
        state.studyFlipped !== snapshot.flipped || state.language !== snapshot.language ||
        (state.studyFlipped ? state.studyBackText : state.studyFrontText) !== snapshot.text ||
        !document.getElementById("screen-flashcard").classList.contains("active")) return;
    state.translationPending = false;
    el.textContent = t("study.translationResult") + ": " + result.translation;
    el.setAttribute("aria-label", el.textContent);
    el.classList.remove("is-pending", "is-error");
  }).catch(function() {
    if (requestId !== state.translationRequestId) return;
    state.translationPending = false;
    var current = state.studyCards[state.studyIndex];
    if (!current || current.id !== snapshot.cardId || state.studyIndex !== snapshot.index ||
        state.studyFlipped !== snapshot.flipped || state.language !== snapshot.language ||
        (state.studyFlipped ? state.studyBackText : state.studyFrontText) !== snapshot.text ||
        !document.getElementById("screen-flashcard").classList.contains("active")) return;
    el.textContent = t("study.translationFailed");
    el.classList.remove("is-pending");
    el.classList.add("is-error");
  });
}

function renderFlashcard() {
  hideVocabularySelectionAction(true);
  clearFlashcardTranslation();
  var cards = state.studyCards;
  var i     = state.studyIndex;
  var card  = cards[i];
  if (!card) return;

  state.studyCardShownAt = Date.now();
  document.getElementById("fc-notdue-hint").classList.add("hidden");

  // Defensive reset of the forced-retype drill, unconditionally — not just on success/exit —
  // so it can never leak nav-lock state into the next card or a future session. Must run
  // BEFORE setMarkButtonsEnabled(false) below: setFlashcardNavLocked(false) re-enables the
  // same four grading buttons, so the "must flip before grading" disable needs to apply last.
  state.fcForcedRetype = false;
  setFlashcardNavLocked(false);
  document.getElementById("btn-fc-next").title = "";
  document.getElementById("fc-retype-wrap").classList.add("hidden");
  document.getElementById("fc-latex-confirm-wrap").classList.add("hidden");
  var retypeInput = document.getElementById("fc-retype-input");
  retypeInput.value = "";
  retypeInput.disabled = false;
  var retypeFeedback = document.getElementById("fc-retype-feedback");
  retypeFeedback.textContent = "";
  retypeFeedback.classList.add("hidden");

  // Grading buttons stay disabled until the card's been flipped at least once this card —
  // otherwise a grade can be submitted on pure guesswork, without ever seeing the answer.
  state.studyHasFlippedCard = false;
  state.studyCardGraded = false;
  setMarkButtonsEnabled(false);
  setAwaitingReveal(true);

  // Optional "type before flip" scratchpad, on for the whole session in Flashcard & Write
  // mode (state.typeToCompare, set once in startStudy()) — reset per card, not tied to
  // grading in any way; purely a self-comparison aid.
  var typeInput = document.getElementById("fc-type-input");
  typeInput.classList.toggle("hidden", !state.typeToCompare);
  typeInput.value = "";
  typeInput.disabled = false;
  document.getElementById("fc-your-guess").classList.add("hidden");
  // Auto-focus only when the mode has it on — the user picked Flashcard & Write specifically to type on
  // every card, so this saves a click; when it's off the input isn't even visible.
  if (state.typeToCompare) typeInput.focus();
  state.fcHintSteps = 0;
  document.getElementById("fc-type-hint-text").innerHTML = "";
  document.getElementById("fc-hint-cap").classList.add("hidden");
  var hintBtn = document.getElementById("btn-fc-type-hint");
  hintBtn.textContent = t("hint.button");
  hintBtn.disabled = false;
  ["btn-fc-known", "btn-fc-easy"].forEach(function(id) {
    var btn = document.getElementById(id);
    btn.title = t(id === "btn-fc-known" ? "study.knowItHint" : "study.confidentHint");
  });

  // Cancel any pending auto-advance from a previous grade — otherwise it fires later
  // against whatever card the user has since navigated to (Prev/Next/dot/shuffle/delete),
  // same race Quiz mode already guards against via state.quizAdvanceTimer.
  clearTimeout(state.fcAdvanceTimer);

  // Progress
  document.getElementById("fc-progress-text").textContent = studyProgressText(i + 1, cards.length,
    cards.length - Object.keys(state.studySessionLog || {}).length, "flashcard");
  document.getElementById("fc-progress-fill").style.transform = scaleXStyle((i + 1) / cards.length);

  // Lesson label (multi-lesson sessions)
  setStudyLessonLabel("fc-lesson-label", card);

  // Flip state — reset must be instant, not animated. If the previous card was left
  // flipped (the common case: flip, grade, auto-advance), .fc-card's CSS transition would
  // otherwise animate the un-flip over 500ms with the NEW card's content already swapped
  // in below, briefly revealing its answer mid-rotation. Temporarily disabling the
  // transition snaps it to front-facing immediately; the deliberate flip animation (user
  // clicking/tapping the card) is untouched since that's a separate code path. Order matters:
  // the class removal (the actual un-flip) must happen while the transition is still
  // disabled, restoring the transition only afterward — doing it the other way around (reflow
  // first, restore, then remove the class) would un-flip under the now-active 0.5s transition.
  state.studyFlipped = false;
  var fcCardEl = document.getElementById("fc-card");
  fcCardEl.style.transition = "none";
  fcCardEl.classList.remove("flipped");
  void fcCardEl.offsetHeight; // force reflow so transition:none takes effect before it's cleared
  fcCardEl.style.transition = "";
  // Swipe-to-grade leaves #fc-scene translated off-screen after its fly-off animation (see
  // initSwipeGestures) — reset that here too, so the just-graded card never snaps back to
  // center and flashes stale content before this render's new content is in place.
  resetFlownOffScene(document.getElementById("fc-scene"));

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
    renderVocabularyTerm(front, frontEl, renderLatex);
    renderLatex(back,  backEl);
    frontAudioBtn.parentNode.style.visibility = "";
  } else if (card.format === "true-false") {
    front = card.data.statement;
    back  = card.data.correct === "true" ? t("common.true") : t("common.false");
    state.studyFrontText = front || "";
    state.studyBackText  = back  || "";
    frontEl.innerHTML = "";
    renderLatex(front, frontEl);
    backEl.innerHTML = "";
    backEl.textContent = back;
    frontAudioBtn.parentNode.style.visibility = "";
  } else if (card.format === "image-def") {
    state.studyFrontText = "";
    state.studyBackText  = card.data.def || "";
    frontEl.innerHTML = "";
    var fcImg = document.createElement("img");
    fcImg.src = card.data.imageUrl;
    fcImg.alt = t("card.imageAlt");
    fcImg.style.maxWidth  = "100%";
    fcImg.style.maxHeight = "240px";
    fcImg.style.objectFit = "contain";
    frontEl.appendChild(fcImg);
    renderLatex(card.data.def, backEl);
    frontAudioBtn.parentNode.style.visibility = "hidden";
  } else {
    front = card.data.question;
    back  = card.data.correct;
    state.studyFrontText = front || "";
    state.studyBackText  = back  || "";
    frontEl.innerHTML = "";
    renderLatex(front, frontEl);
    renderLatex(back,  backEl);
    frontAudioBtn.parentNode.style.visibility = "";
  }

  document.getElementById("fc-type-hint-row").classList.toggle("hidden",
    !state.typeToCompare || !hintAvailable(state.studyBackText));

  var expContainer = document.getElementById("fc-explanation");
  expContainer.innerHTML = "";
  expContainer.classList.add("hidden");
  if ((card.format === "mcq" || card.format === "true-false") && card.data.explanation) {
    var expEl = document.createElement("details");
    expEl.className = "explanation-panel";
    expEl.open = true;
    var sum = document.createElement("summary");
    sum.innerHTML = ICON_LIGHTBULB + " " + t("study.explanation");
    var body = document.createElement("div");
    body.className = "explanation-body";
    renderLatex(card.data.explanation, body);
    expEl.appendChild(sum);
    expEl.appendChild(body);
    expContainer.appendChild(expEl);
  }

  // Difficulty badge — read from the already-fetched studyStatsMap (server-backed accuracy
  // history), not localStorage's "fc-attempts" (only ever populated in local/offline mode).
  var badge = document.getElementById("fc-diff-badge");
  var stats = (state.studyStatsMap && state.studyStatsMap[card.id]) || { total: 0, correct: 0, blended: 0, level: "new" };
  badge.className = "fc-difficulty-badge badge-" + (stats.total === 0 ? "new" : stats.level);
  badge.textContent = stats.total === 0 ? t("difficulty.new") :
    difficultyLabel(stats.level) + " · " + stats.correct + "/" + stats.total;

  var upstreamBadge = document.getElementById("fc-upstream-badge");
  upstreamBadge.className = "fc-upstream-badge upstream-pill " + (card.upstream_change || "") + (card.upstream_change ? "" : " hidden");
  upstreamBadge.textContent = card.upstream_change ? t("upstream." + card.upstream_change) : "";

  // Dots
  renderFcDots();
  requestAnimationFrame(markFcOverflow);

  // Mark buttons reflect known state
  var known = state.studyKnownMap[card.id];
  document.getElementById("btn-fc-learning").classList.toggle("btn-danger-active", known === false);
  document.getElementById("btn-fc-known").classList.toggle("btn-success-active", known === true);

  // Interval preview: how long until the card comes back if graded this way. Precomputed
  // server-side (fsrs_preview_*, seconds-from-now) so this can never drift from the FSRS
  // scheduler's actual math — see server/fsrs.js. A not-yet-due card leaves its schedule
  // untouched regardless of grade (same server-side early-return), so showing a preview
  // there would promise a bump that doesn't actually happen.
  var stillNotDue = card.srs_due_at && card.srs_due_at > Math.floor(Date.now() / 1000);
  document.getElementById("fc-int-learning").textContent = stillNotDue ? "" : formatFsrsDuration(card.fsrs_preview_again);
  document.getElementById("fc-int-hard").textContent = stillNotDue ? "" : formatFsrsDuration(card.fsrs_preview_hard);
  document.getElementById("fc-int-known").textContent = stillNotDue ? "" : formatFsrsDuration(card.fsrs_preview_good);
  document.getElementById("fc-int-easy").textContent = stillNotDue ? "" : formatFsrsDuration(card.fsrs_preview_easy);

  // Prev/Next
  document.getElementById("btn-fc-prev").disabled = i === 0;
  document.getElementById("btn-fc-next").innerHTML = i === cards.length - 1 ? t("study.finish") : t("study.next") + " " + ICON_ARROW_RIGHT;
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
    if (known === true) {
      dot.classList.add("known");
    } else if (known === false) {
      dot.classList.add("learning");
    } else {
      // Not yet marked this session — preview the card's historical difficulty
      // (same level used for the on-card Easy/Medium/Hard/New badge) instead of
      // leaving every unmarked dot looking identical.
      var stats = state.studyStatsMap && state.studyStatsMap[card.id];
      var level = stats ? stats.level : "new";
      if (level === "easy") dot.classList.add("known");
      else if (level === "medium") dot.classList.add("medium");
      else if (level === "hard") dot.classList.add("learning");
    }
    (function(idx) {
      dot.addEventListener("click", function() {
        if (state.fcForcedRetype) return; // don't let the drill be skipped by jumping cards
        haptic("tick");
        state.studyIndex = idx;
        renderFlashcard();
      });
    })(i);
    dots.appendChild(dot);
  }
}

document.getElementById("fc-scene").addEventListener("click", function() {
  // Forced-retype drill pending — don't let the user flip away from the reinforcement step.
  if (state.fcForcedRetype) return;
  // A click still fires after a text-selection drag (mousedown+mouseup on the
  // same element) — skip the flip so selecting text to copy/translate doesn't flip the card.
  var sel = window.getSelection();
  if (sel && sel.toString().length > 0) return;
  haptic("tick");
  hideVocabularySelectionAction(true);
  clearFlashcardTranslation();
  state.studyFlipped = !state.studyFlipped;
  document.getElementById("fc-card").classList.toggle("flipped", state.studyFlipped);
  if (state.studyFlipped && !state.studyHasFlippedCard) {
    state.studyHasFlippedCard = true;
    setMarkButtonsEnabled(true);
    setAwaitingReveal(false);
    if (state.typeToCompare) {
      var typeInput = document.getElementById("fc-type-input");
      var guess = typeInput.value.trim();
      if (guess) {
        var guessEl = document.getElementById("fc-your-guess");
        guessEl.textContent = t("study.yourGuess", { text: guess });
        guessEl.classList.remove("hidden");
      }
      typeInput.disabled = true;
      document.getElementById("btn-fc-type-hint").disabled = true;
    }
  }
  var expContainer = document.getElementById("fc-explanation");
  expContainer.classList.toggle("hidden", !state.studyFlipped || expContainer.innerHTML === "");
});

document.getElementById("btn-fc-reveal").addEventListener("click", function() {
  document.getElementById("fc-scene").click();
});

document.getElementById("fc-type-input").addEventListener("click", function(e) {
  e.stopPropagation();
});
document.getElementById("fc-type-hint-row").addEventListener("click", function(e) {
  e.stopPropagation(); // a click on the hint row must not flip the card
});
document.getElementById("btn-fc-type-hint").addEventListener("click", function() {
  if (state.studyHasFlippedCard) return;
  var answer = state.studyBackText;
  var max = hintWords(answer).length;
  state.fcHintSteps = Math.min((state.fcHintSteps || 0) + 1, max);
  document.getElementById("fc-type-hint-text").innerHTML = hintRevealHtml(answer, state.fcHintSteps);
  var cap = document.getElementById("fc-hint-cap");
  cap.textContent = t("hint.cap");
  cap.classList.remove("hidden");
  this.textContent = t("hint.more");
  if (state.fcHintSteps >= max) this.disabled = true;
  haptic("tick");
  document.getElementById("fc-type-input").focus();
});
document.getElementById("fc-type-input").addEventListener("keydown", function(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    // Also stop propagation, not just the default action — the flip below disables (and
    // therefore blurs) this input mid-keydown, and the same keystroke would otherwise still
    // bubble to the document-level global handler, whose own Enter-to-flip shortcut no longer
    // sees an input focused and fires a second, undoing flip on the same keypress.
    e.stopPropagation();
    document.getElementById("fc-scene").click();
  }
});

document.getElementById("fc-retype-input").addEventListener("click", function(e) {
  e.stopPropagation(); // mirrors #fc-type-input: don't let a click into the input bubble to #fc-scene and flip
});
document.getElementById("fc-retype-input").addEventListener("keydown", function(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    submitForcedRetype();
  }
});

document.getElementById("btn-fc-latex-continue").addEventListener("click", function(e) {
  // stopPropagation matters here: confirmLatexRetype() clears state.fcForcedRetype
  // synchronously, so without this the same click would still bubble to #fc-scene and pass
  // its (now-false) guard, flipping the card back on the same click that just confirmed it.
  e.stopPropagation();
  confirmLatexRetype();
});
document.getElementById("btn-fc-latex-continue").addEventListener("keydown", function(e) {
  // Without this, Enter/Space on this focused button would first hit the global keydown
  // handler (isInputFocused() only exempts INPUT/TEXTAREA/SELECT, not BUTTON) — which
  // preventDefaults the native button activation and routes to #fc-scene's flip instead,
  // itself a no-op while the drill is active, leaving keyboard users with no way to continue.
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    e.stopPropagation();
    confirmLatexRetype();
  }
});

document.getElementById("btn-fc-audio-front").addEventListener("click", function(e) {
  e.stopPropagation();
  speakStudyFront();
});

document.getElementById("btn-quiz-audio").addEventListener("click", function(e) {
  e.stopPropagation();
  speakQuizTerm();
});

document.getElementById("btn-fc-audio-back").addEventListener("click", function(e) {
  e.stopPropagation();
  speakText(state.studyBackText);
});

document.getElementById("btn-fc-prev").addEventListener("click", function() {
  if (state.studyIndex > 0) { haptic("tick"); state.studyIndex--; renderFlashcard(); }
});

// Not inside advanceFlashcard(): the auto-advance timer calls it too, which would add a
// second buzz right after every grade.
document.getElementById("btn-fc-next").addEventListener("click", function() {
  haptic("tick");
  advanceFlashcard();
});

document.getElementById("btn-fc-shuffle").addEventListener("click", function() {
  haptic("tick");
  state.studyCards = shuffle(state.studyCards);
  state.studyIndex = 0;
  renderFlashcard();
});

document.getElementById("btn-fc-edit-card").addEventListener("click", function() {
  var card = state.studyCards[state.studyIndex];
  if (!card) return;
  openEditCard(card.id, card, true);
});

document.getElementById("btn-fc-delete-card").addEventListener("click", function() {
  var card = state.studyCards[state.studyIndex];
  if (!card) return;
  confirmDelete(t("confirm.deleteCard"), function() {
    store.deleteCard(card.id, card.lesson_id).then(function() {
      state.studyCards.splice(state.studyIndex, 1);
      if (state.studyCards.length === 0) {
        returnFromStudy();
        return;
      }
      if (state.studyIndex >= state.studyCards.length) {
        state.studyIndex = state.studyCards.length - 1;
      }
      renderFlashcard();
    });
  });
});


function normalizeAnswerText(str) {
  // NFC first: an IME/OS input path can emit a decomposed form (e.g. some Vietnamese/macOS
  // dead-key sequences produce "e" + a combining accent as two code points) even when the
  // stored card text is precomposed — without unifying to one form first, two code-point
  // arrays that are visually and semantically identical can come out different lengths,
  // which the fuzzy-match code-point comparison below relies on being consistent.
  return (str || "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

// Splits by Unicode code point rather than UTF-16 code unit — a plain .length/charCodeAt
// walk would see each half of a surrogate pair (any emoji or astral character) as its own
// unit, letting two unrelated emoji that happen to share one half measure as 1 edit apart.
function toCodePoints(str) {
  return Array.from(str);
}

// Checks whether two code-point arrays differ by at most one edit — a dropped, added, or
// substituted character, or one adjacent transposition (swap) — without a general
// Levenshtein/DP matrix: the only threshold this feature ever checks is "within 1 edit" (see
// fuzzyMatchType below — a wider tolerance for longer answers was tried and reverted, see
// docs/decisions.md), so the standard O(n) two-pointer/single-pass check for exactly that
// fixed question is enough. No quadratic blowup is possible regardless of input length —
// unlike an earlier version of this code, there's no need for any length cap: a huge pasted
// string just runs one O(n) scan and returns false. Character comparison is plain === (not
// accent-folding) deliberately — see fuzzyMatchType below.
function isWithinOneEdit(a, b) {
  var m = a.length, n = b.length;
  if (Math.abs(m - n) > 1) return false;
  if (m === n) {
    var diffCount = 0;
    var firstDiffIndex = -1;
    for (var i = 0; i < m; i++) {
      if (a[i] !== b[i]) {
        diffCount++;
        if (diffCount === 1) {
          firstDiffIndex = i;
        } else if (diffCount === 2) {
          var isTransposition = i === firstDiffIndex + 1 &&
            a[firstDiffIndex] === b[i] && a[i] === b[firstDiffIndex];
          if (!isTransposition) return false;
        } else {
          return false;
        }
      }
    }
    return true;
  }
  var longer = m > n ? a : b;
  var shorter = m > n ? b : a;
  var i = 0, j = 0, usedSkip = false;
  while (i < longer.length && j < shorter.length) {
    if (longer[i] === shorter[j]) {
      i++; j++;
    } else {
      if (usedSkip) return false;
      usedSkip = true;
      i++;
    }
  }
  return true;
}

// Tolerance kicks in only once the TRUE answer (expectedCP, not whatever the user typed) is
// long enough that one edit is a small fraction of it, not most of the word — a short answer
// still needs to be exact.
var MIN_LENGTH_FOR_EDIT_TOLERANCE = 4;

// Deliberately does NOT treat accented/unaccented letter pairs as free via a locale collator
// (e.g. Intl.Collator sensitivity:"base") — tried and reverted in code review: verified that
// with no explicit locale, Intl.Collator({sensitivity:"base"}).compare("do", "đo") returns 0,
// silently folding đ and d as equivalent. Those are separate letters in the Vietnamese
// alphabet (along with ă/â/ê/ô/ơ/ư), not a base letter and its accented form — this app ships
// a Vietnamese translation, so that folding would silently accept a different Vietnamese word
// as correct. Plain === means an accent difference just costs 1 edit like any other typo,
// governed by the same tolerance as everything else — see docs/decisions.md for the full
// iteration (including why a per-language collator locale isn't a fix: no per-card language
// metadata exists to pick one). Known, accepted limit either way (unrelated to this specific
// choice): a same-length wrong word exactly one edit from the correct one (e.g. "horse" vs
// "house") is indistinguishable from a real typo and will also pass.
//
// Returns "exact"/"fuzzy"/null so callers needing different feedback for the two success
// cases don't have to re-derive typed === expected themselves.
function fuzzyMatchType(typed, expected) {
  if (!typed) return null;
  if (typed === expected) return "exact";
  var expectedCP = toCodePoints(expected);
  if (expectedCP.length < MIN_LENGTH_FOR_EDIT_TOLERANCE) return null;
  var typedCP = toCodePoints(typed);
  return isWithinOneEdit(typedCP, expectedCP) ? "fuzzy" : null;
}

// Same delimiter pattern as splitLatex() — the retype drill compares against the raw,
// unrendered answer string, which would show the user rendered math but ask them to type
// back its $...$ source, so skip the drill entirely rather than trap them on an unwinnable card.
var LATEX_DELIMITER_RE = /\$\$[\s\S]+?\$\$|\$(?!\$)[\s\S]+?(?<!\$)\$/;
function containsLatex(str) {
  return LATEX_DELIMITER_RE.test(str || "");
}

// Finished — show the session summary rather than jumping straight back (an early Exit via
// btn-fc-back skips this, since bailing out mid-session isn't "completing" it). Shared by
// btn-fc-next and both auto-advance paths out of markCard() (immediate, and after a
// successful forced retype).
function advanceFlashcard() {
  if (state.studyIndex < state.studyCards.length - 1) {
    state.studyIndex++;
    renderFlashcard();
  } else {
    showFlashcardSummary();
  }
}

function scheduleFlashcardAdvance(delay) {
  state.fcAdvanceTimer = setTimeout(advanceFlashcard, delay);
}

function beginForcedRetype(advanceDelay) {
  // A swipe-graded card leaves #fc-scene translated off-screen after its fly-off animation
  // (see initSwipeGestures) — this is the other of the two moments (alongside
  // renderFlashcard()) that need the card visible again, since the retype/confirm UI the
  // user must interact with next lives inside #fc-scene, as a sibling of .fc-card. Reset
  // unconditionally, before any branching below, so it's never skipped on any path out of
  // this function — including a swipe-graded card with malformed/empty back text, which
  // would otherwise sit off-screen for the whole advanceDelay wait below.
  resetFlownOffScene(document.getElementById("fc-scene"));
  // Malformed/empty card data — nothing meaningful to retype or confirm; don't block on it.
  if (!normalizeAnswerText(state.studyBackText)) {
    scheduleFlashcardAdvance(advanceDelay);
    return;
  }
  haptic("warn");
  state.fcForcedRetype = true;
  state.fcRetypeAdvanceDelay = advanceDelay;
  setFlashcardNavLocked(true);
  // A disabled button gives no reason why on its own — a hover tooltip explaining it (desktop)
  // complements the scrollIntoView calls below (mobile/short viewports) so "Next is locked"
  // doesn't read as the app being stuck. Cleared in renderFlashcard()/completeForcedRetype().
  document.getElementById("btn-fc-next").title = t("study.retypeRequiredHint");
  if (containsLatex(state.studyBackText)) {
    // LaTeX source can't be typed back blind — renderFlashcard shows it rendered via KaTeX,
    // not as raw $...$ markup — so a manual confirm swaps in for the typed check, still
    // gating the advance the same way a correct retype would.
    var latexWrap = document.getElementById("fc-latex-confirm-wrap");
    latexWrap.classList.remove("hidden");
    // .focus() alone is not a reliable "scroll this into view" guarantee — a focused element
    // inside a 3D-transformed, backface-hidden face (.fc-back, mid- or just-post-flip) is a
    // documented WebKit trouble spot elsewhere in this file (see docs/decisions.md's Safari
    // face-bleed-through entry) — without an explicit scroll, a user on a short viewport can
    // end up with every grading/nav button correctly locked but no visible reason why, reading
    // as "the app just froze" rather than "type/confirm the answer to continue."
    latexWrap.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // preventScroll: a plain .focus() right after scrollIntoView's smooth animation starts
    // triggers the browser's OWN focus-scroll too, which jumps instantly and cancels the
    // smooth one mid-flight — most visible on exactly the short mobile viewports this is for.
    document.getElementById("btn-fc-latex-continue").focus({ preventScroll: true });
    return;
  }
  var wrap = document.getElementById("fc-retype-wrap");
  var input = document.getElementById("fc-retype-input");
  var feedback = document.getElementById("fc-retype-feedback");
  input.value = "";
  input.disabled = false;
  feedback.textContent = "";
  feedback.classList.add("hidden");
  wrap.classList.remove("hidden");
  wrap.scrollIntoView({ block: "nearest", behavior: "smooth" }); // see comment above
  input.focus({ preventScroll: true }); // see comment above
}

// Shared by a successful retype and the LaTeX manual-confirm button: re-lock grading only
// (Prev/Next/Shuffle/Edit/Delete stay unlocked — this card was already graded once), restore
// Prev's correct first-card state (setFlashcardNavLocked(false) re-enables it unconditionally,
// but renderFlashcard() disables it specifically on the first card), and queue the advance
// that was deferred when the drill began. Re-locking grading matters because the advance timer
// below is already queued — without it, clicking a grade button again during the countdown
// would record a duplicate attempt and queue a second, overlapping advance timer.
function completeForcedRetype() {
  state.fcForcedRetype = false;
  setFlashcardNavLocked(false);
  document.getElementById("btn-fc-next").title = "";
  document.getElementById("btn-fc-prev").disabled = state.studyIndex === 0;
  setMarkButtonsEnabled(false);
  scheduleFlashcardAdvance(state.fcRetypeAdvanceDelay);
}

function submitForcedRetype() {
  if (!state.fcForcedRetype) return; // guard against double-submit / stray events
  var input = document.getElementById("fc-retype-input");
  var feedback = document.getElementById("fc-retype-feedback");
  var typed = normalizeAnswerText(input.value);
  var expected = normalizeAnswerText(state.studyBackText);
  var matchType = fuzzyMatchType(typed, expected);
  if (matchType) {
    haptic("success");
    playSound("correct");
    input.disabled = true; // belt-and-suspenders: disabled inputs don't get further keydowns
    feedback.textContent = t(matchType === "exact" ? "study.retypeCorrect" : "study.retypeCloseEnough");
    feedback.className = "fc-retype-feedback fc-retype-feedback-success";
    feedback.classList.remove("hidden");
    completeForcedRetype();
  } else {
    haptic("error");
    playSound("wrong");
    feedback.textContent = t("study.retypeMismatch");
    feedback.className = "fc-retype-feedback fc-retype-feedback-error";
    feedback.classList.remove("hidden");
    input.select();
  }
}

function confirmLatexRetype() {
  if (!state.fcForcedRetype) return; // guard against double-click / stray events
  haptic("success");
  document.getElementById("fc-latex-confirm-wrap").classList.add("hidden");
  completeForcedRetype();
}

function markCard(known, grade, forceRetype) {
  var card = state.studyCards[state.studyIndex];
  if (!card || state.studyCardGraded) return;
  if (known && state.fcHintSteps > 0) grade = "hard";
  state.studyCardGraded = true;
  setMarkButtonsEnabled(false);
  haptic("select");
  var undo = { card: card, prevKnown: state.studyKnownMap[card.id], prevLog: state.studySessionLog[card.id],
               prevDue: card.srs_due_at, attemptId: store.newClientId ? store.newClientId() : genId("att") };
  state.studyKnownMap[card.id] = known;
  store.setCardKnown(card.id, known).catch(function() {});
  state.studySessionLog[card.id] = !known ? "learning" : grade === "hard" ? "hard" : grade === "easy" ? "confident" : "known";
  if (card.upstream_change === "updated") {
    card.upstream_change = null;
    setUpstreamCount((state.upstreamCount || 0) - 1);
  }
  var attemptFields = { cardId: card.id, correct: known, source: "flashcard", clientId: undo.attemptId };
  if (grade) attemptFields.grade = grade;
  if (state.studyCardShownAt) attemptFields.durationMs = Date.now() - state.studyCardShownAt;
  if (state.typeToCompare && document.getElementById("fc-type-input").value.trim()) attemptFields.typed = true;
  undo.sessionMs = addSessionTime(attemptFields.durationMs);
  store.recordAttempt(attemptFields).then(function(res) {
    if (res && res.srs_due_at != null && state.fcUndoneAttempt !== undo.attemptId) {
      card.srs_due_at = res.srs_due_at;
    }
  }).catch(function(err) {
    showToast(t("toast.saveFailed", { message: err.message }), "error");
  });
  renderFcDots();
  offerGradeUndo(undo, state.studySessionLog[card.id]);

  // Known client-side already (same check renderFlashcard() uses to blank the interval
  // preview) — shown synchronously rather than waiting on the network response, since the
  // normal 400ms auto-advance would otherwise hide it before most people could read it.
  var stillNotDue = card.srs_due_at && card.srs_due_at > Math.floor(Date.now() / 1000);
  if (stillNotDue) {
    var hintEl = document.getElementById("fc-notdue-hint");
    hintEl.textContent = t("study.notDueHint");
    hintEl.classList.remove("hidden");
  }

  // Auto-advance — extended when the not-due hint is showing so it's actually readable.
  // Grading the last card auto-finishes the session (shows the summary) instead of
  // sitting there waiting for a manual Finish click — the button stays as a fallback for
  // a last card the user navigated to without grading (skipped).
  var advanceDelay = stillNotDue ? 1200 : 400;
  // In Flashcard & Write mode, Learning/Hard triggers a forced retype of the answer before
  // advancing — the two grades signaling the card didn't stick, so it's worth reinforcing.
  if (forceRetype && state.typeToCompare) {
    beginForcedRetype(advanceDelay);
  } else {
    scheduleFlashcardAdvance(advanceDelay);
  }
}

// Undo for the last flashcard grade (Anki's Undo, Duolingo has none). Long enough to notice a
// misclick after the next card is already up; the server allows ten minutes, so the bar is
// what limits it, and a slow undo still lands.
var GRADE_UNDO_MS = 6000;
var GRADE_LABEL_KEYS = { learning: "study.learning", hard: "study.hard", known: "study.knowIt", confident: "study.confident" };

function offerGradeUndo(undo, log) {
  state.fcUndo = undo;
  showUndoBar(t("undo.graded", { grade: t(GRADE_LABEL_KEYS[log]) }));
  state.undoHandler = undoLastGrade;
  clearTimeout(state.fcUndoTimer);
  state.fcUndoTimer = setTimeout(dismissGradeUndo, GRADE_UNDO_MS);
}

function dismissGradeUndo() {
  clearTimeout(state.fcUndoTimer);
  state.fcUndo = null;
  if (state.undoHandler === undoLastGrade) hideUndoBar();
}

// Puts the session back as it was before the grade; returns the card's index to show again,
// or -1 when it has left the session (deleted meanwhile).
function restoreGradedCard(undo) {
  var id = undo.card.id;
  if (undo.prevKnown === undefined) delete state.studyKnownMap[id]; else state.studyKnownMap[id] = undo.prevKnown;
  if (undo.prevLog === undefined) delete state.studySessionLog[id]; else state.studySessionLog[id] = undo.prevLog;
  if (undo.sessionMs) {
    state.sessionMs = Math.max(0, (state.sessionMs || 0) - undo.sessionMs);
    var at = (state.sessionDurations || []).lastIndexOf(undo.sessionMs);
    if (at >= 0) state.sessionDurations.splice(at, 1);
  }
  undo.card.srs_due_at = undo.prevDue;
  return state.studyCards.indexOf(undo.card);
}

function undoLastGrade() {
  var undo = state.fcUndo;
  if (!undo) return;
  dismissGradeUndo();
  clearTimeout(state.fcAdvanceTimer);
  // Wait for the server before changing the screen: a refused undo (the answer is no longer
  // the card's latest) must leave everything as it is.
  store.undoAttempt(undo.attemptId).then(function() {
    state.fcUndoneAttempt = undo.attemptId;
    store.setCardKnown(undo.card.id, undo.prevKnown === undefined ? null : undo.prevKnown).catch(function() {});
    var index = restoreGradedCard(undo);
    if (index < 0) return;
    state.studyIndex = index;
    showScreen("flashcard");
    renderFlashcard();
    renderFcDots();
  }).catch(function() {
    showToast(t("undo.failed"), "error");
  });
}

document.getElementById("btn-grade-undo").addEventListener("click", function() {
  if (state.undoHandler) state.undoHandler();
});

document.getElementById("btn-fc-learning").addEventListener("click", function() { markCard(false, null, true); });
document.getElementById("btn-fc-hard").addEventListener("click", function()     { markCard(true, "hard", true); });
document.getElementById("btn-fc-known").addEventListener("click", function()    { markCard(true);  });
document.getElementById("btn-fc-easy").addEventListener("click", function()     { markCard(true, "easy"); });

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
  state.quizCompleteBuzzed = false;
  state.quizStreak = 0;
  state.quizBestStreak = 0;
  beginStudySession();
  renderQuizCard();
  showScreen("quiz");
}

// "✓ 3", not "3 / 4": beside the "4 / 10" progress, two x / y numbers read as one.
function setQuizScoreDisplay() {
  var el = document.getElementById("quiz-score-display");
  el.textContent = "✓ " + state.quizScore;
  el.title = t("quiz.scoreTitle", { n: state.quizScore, total: state.quizResults.length });
}

// Distractors come from the session and then the open lesson; with too few, the question
// shows fewer choices rather than "—" padding, which gave the answer away.
function quizDistractors(card, field) {
  var seen = {};
  seen[card.data[field]] = true;
  var pool = [];
  state.quizCards.concat(state.currentLessonCards || []).forEach(function(c) {
    if (c.id === card.id || c.format !== card.format || !c.data || !c.data[field]) return;
    if (seen[c.data[field]]) return;
    seen[c.data[field]] = true;
    pool.push(c.data[field]);
  });
  return shuffle(pool).slice(0, 3);
}

function buildQuizOptions(card) {
  if (card.format === "true-false") {
    return [t("common.true"), t("common.false")];
  }
  if (card.format === "mcq") {
    return shuffle([card.data.correct].concat(card.data.distractors));
  }
  // term-def and image-def: the other cards' definitions are the wrong answers.
  return shuffle([card.data.def].concat(quizDistractors(card, "def")));
}

// Tiles left-align their text once any answer is a sentence: centred paragraphs in narrow
// columns were hard to read, and on a phone such answers fall back to the list.
var QUIZ_LONG_OPTION = 80;

function quizLayout() {
  try { return localStorage.getItem("fc-quiz-layout") === "grid" ? "grid" : "list"; } catch (_) { return "list"; }
}

// The button shows the layout it switches TO, like the other header toggles. No aria-pressed:
// with a label that already flips, VoiceOver read "Show answers as a list, pressed".
function applyQuizLayout() {
  var grid = quizLayout() === "grid";
  document.getElementById("quiz-options").classList.toggle("grid-mode", grid);
  var btn = document.getElementById("btn-quiz-layout");
  var label = t(grid ? "quiz.layoutList" : "quiz.layoutGrid");
  btn.innerHTML = grid ? ICON_LAYOUT_LIST : ICON_LAYOUT_GRID;
  btn.title = label;
  btn.setAttribute("aria-label", label);
}

function findQuizResult(card) {
  return state.quizResults.find(function(r) { return r.card.id === card.id; });
}

function renderQuizCard() {
  var cards = state.quizCards;
  var i     = state.quizIndex;
  var total = cards.length;

  // Cancel any pending auto-advance from the previous answer — otherwise it fires
  // later against whatever card the user has since navigated to via Prev/Next/delete.
  clearTimeout(state.quizAdvanceTimer);
  state.quizAdvanceTimer = null;

  var prevExp = document.getElementById("quiz-explanation");
  if (prevExp) prevExp.remove();
  var prevNext = document.getElementById("quiz-next-btn");
  if (prevNext) prevNext.remove();
  hideQuizSheet();
  var prevCap = document.getElementById("quiz-cap-hint");
  if (prevCap) prevCap.remove();
  var prevNotDue = document.getElementById("quiz-notdue-hint");
  if (prevNotDue) prevNotDue.remove();
  hideVocabularySelectionAction(true);

  if (i >= total) { showQuizResults(); return; }

  var card = cards[i];
  var priorResult = findQuizResult(card);
  // Don't reset the timer on a read-only Prev/Next replay of an already-answered card.
  if (!priorResult) state.quizCardShownAt = Date.now();

  document.getElementById("quiz-progress-text").textContent = studyProgressText(i + 1, total,
    total - state.quizResults.length, "quiz");
  document.getElementById("quiz-progress-fill").style.transform = scaleXStyle((i + 1) / total);
  setQuizScoreDisplay();

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
    qImg.alt = t("card.imageAlt");
    qImg.style.maxWidth  = "100%";
    qImg.style.maxHeight = "200px";
    qImg.style.objectFit = "contain";
    qEl.appendChild(qImg);
  } else {
    renderLatex(card.data.term, qEl);
  }
  document.getElementById("btn-quiz-audio").classList.toggle("hidden", !window.speechSynthesis || !quizSpeechText(card));

  // Options — replay the exact shuffled set from when this card was first answered
  // (buildQuizOptions() re-shuffles on every call, so a reviewed card must reuse its saved opts)
  var opts = priorResult ? priorResult.opts : buildQuizOptions(card);
  state.quizOptions = opts;
  state.quizAnswered = !!priorResult;

  var optsEl = document.getElementById("quiz-options");
  optsEl.innerHTML = "";
  optsEl.classList.toggle("tf-mode", card.format === "true-false");
  optsEl.classList.toggle("long-opts", opts.some(function(o) { return String(o).length > QUIZ_LONG_OPTION; }));
  applyQuizLayout();
  opts.forEach(function(opt, idx) {
    var btn = document.createElement(priorResult ? "div" : "button");
    btn.className = "quiz-opt";
    btn.innerHTML = '<span class="opt-num">' + (idx + 1) + '</span><span class="opt-text"></span>';
    var textEl = btn.querySelector(".opt-text");
    renderLatex(opt, textEl);
    if (priorResult) {
      btn.classList.add("answered", quizOptionResultClass(opt, idx, priorResult.correctVal, priorResult.selectedIdx));
    } else {
      btn.addEventListener("click", function() { answerQuiz(idx); });
    }
    optsEl.appendChild(btn);
  });

  if (priorResult && (card.format === "mcq" || card.format === "true-false") && card.data.explanation) {
    var expEl  = document.createElement("details");
    expEl.id   = "quiz-explanation";
    expEl.className = "explanation-panel";
    var sumEl  = document.createElement("summary");
    sumEl.innerHTML = ICON_LIGHTBULB + " " + t("study.explanation");
    var bodyEl = document.createElement("div");
    bodyEl.className = "explanation-body";
    renderLatex(card.data.explanation, bodyEl);
    expEl.appendChild(sumEl);
    expEl.appendChild(bodyEl);
    optsEl.after(expEl);
  }

  if (priorResult && priorResult.capped) showQuizHint("quiz-cap-hint", "quiz.cappedHint");
  if (priorResult && priorResult.notDue) showQuizHint("quiz-notdue-hint", "study.notDueHint");

  document.getElementById("btn-quiz-prev").classList.toggle("hidden", i === 0);
  document.getElementById("btn-quiz-review-next").classList.toggle("hidden", !priorResult);
}

function showQuizHint(id, textKey) {
  var old = document.getElementById(id);
  if (old) old.remove();
  var hintEl = document.createElement("div");
  hintEl.id = id;
  hintEl.className = "quiz-cap-hint";
  hintEl.textContent = t(textKey);
  document.getElementById("quiz-nav").before(hintEl);
}

function answerQuiz(selectedIdx) {
  if (state.quizAnswered) return;
  state.quizAnswered = true;

  var card    = state.quizCards[state.quizIndex];
  var opts    = state.quizOptions;
  var correct = card.format === "mcq" ? card.data.correct :
    card.format === "true-false" ? (card.data.correct === "true" ? t("common.true") : t("common.false")) :
    card.format === "image-def" ? card.data.def :
    card.data.def;
  var selectedVal = opts[selectedIdx];
  var isCorrect   = selectedVal === correct;

  state.quizStreak = isCorrect ? (state.quizStreak || 0) + 1 : 0;
  state.quizBestStreak = Math.max(state.quizBestStreak || 0, state.quizStreak);
  var cheer = quizEncouragement(isCorrect, state.quizStreak, state.quizResults.length + 1,
    state.quizCards.length, state.quizLastPraise);
  if (cheer.praise) state.quizLastPraise = cheer.praise;
  haptic(isCorrect ? "success" : "error");
  playSound(cheer.tone === "combo" ? "combo" : isCorrect ? "correct" : "wrong", state.quizStreak - 1);
  if (isCorrect) state.quizScore++;

  // Save result (opts + correctVal preserved so a later review re-render shows the same shuffle;
  // selectedIdx — not just the value — is needed to mark "wrong" correctly when two options share text)
  var resultEntry = { card: card, correct: isCorrect, selected: selectedVal, selectedIdx: selectedIdx, opts: opts, correctVal: correct, capped: false, notDue: false };
  state.quizResults.push(resultEntry);

  if (card.upstream_change === "updated") {
    card.upstream_change = null;
    setUpstreamCount((state.upstreamCount || 0) - 1);
  }
  var quizAttemptFields = { cardId: card.id, correct: isCorrect, source: "quiz" };
  if (state.quizCountsAsKnown) {
    if (isCorrect) quizAttemptFields.grade = "medium";
    store.setCardKnown(card.id, isCorrect).catch(function() {});
  }
  if (state.quizCardShownAt) quizAttemptFields.durationMs = Date.now() - state.quizCardShownAt;
  addSessionTime(quizAttemptFields.durationMs);
  store.recordAttempt(quizAttemptFields).then(function(res) {
    if (res && res.capped) {
      resultEntry.capped = true;
      if (state.quizCards[state.quizIndex] === card) showQuizHint("quiz-cap-hint", "quiz.cappedHint");
    }
    if (res && res.notDue) {
      resultEntry.notDue = true;
      if (state.quizCards[state.quizIndex] === card) showQuizHint("quiz-notdue-hint", "study.notDueHint");
    }
  }).catch(function(err) {
    showToast(t("toast.saveFailed", { message: err.message }), "error");
  });

  // Visual feedback. Answered options become plain blocks: text inside a <button> can't be
  // drag-selected, and selecting a word to save as vocabulary is useful once the answer is known.
  var optsEl = document.getElementById("quiz-options");
  var btns = optsEl.querySelectorAll(".quiz-opt");
  btns.forEach(function(btn, idx) {
    var block = document.createElement("div");
    block.className = "quiz-opt answered " + quizOptionResultClass(opts[idx], idx, correct, selectedIdx);
    while (btn.firstChild) block.appendChild(btn.firstChild);
    btn.replaceWith(block);
  });

  setQuizScoreDisplay();

  var hasExplanation = (card.format === "mcq" || card.format === "true-false") && !!card.data.explanation;
  if (hasExplanation) {
    var expEl  = document.createElement("details");
    expEl.id   = "quiz-explanation";
    expEl.className = "explanation-panel";
    var sumEl  = document.createElement("summary");
    sumEl.innerHTML = ICON_LIGHTBULB + " " + t("study.explanation");
    var bodyEl = document.createElement("div");
    bodyEl.className = "explanation-body";
    renderLatex(card.data.explanation, bodyEl);
    expEl.appendChild(sumEl);
    expEl.appendChild(bodyEl);
    document.getElementById("quiz-options").after(expEl);
  }

  showQuizSheet(cheer);

  // Only a correct answer with nothing to read moves on by itself; after a wrong answer or with
  // an explanation, the user needs time to see the right option, so they press Next.
  if (isCorrect && !hasExplanation) {
    state.quizAdvanceTimer = setTimeout(function() {
      state.quizIndex++;
      renderQuizCard();
    }, 1200);
  } else {
    showQuizNextButton();
  }
}

var QUIZ_PRAISE_COUNT = 6, QUIZ_PRAISE_SUB_COUNT = 3, QUIZ_WRONG_COUNT = 3;

function randomPick(count, avoid) {
  var n;
  do { n = 1 + Math.floor(Math.random() * count); } while (count > 1 && n === avoid);
  return n;
}

// The words on the answer sheet. Praise never repeats the previous phrase, and a wrong answer
// gets a calm line rather than a verdict: the red option already says it was wrong. Progress
// notes replace the praise subtitle only, so a combo or a mistake is never talked over.
function quizEncouragement(isCorrect, streak, answered, total, lastPraise) {
  if (!isCorrect) {
    return { tone: "wrong", title: t("enc.wrong" + randomPick(QUIZ_WRONG_COUNT)), sub: t("enc.wrongSub") };
  }
  if (streak === 3 || streak === 5 || (streak >= 10 && streak % 10 === 0)) {
    return { tone: "combo", title: t("enc.combo" + Math.min(streak, 10), { n: streak }), sub: t("enc.comboSub") };
  }
  var praise = randomPick(QUIZ_PRAISE_COUNT, lastPraise);
  var sub = total >= 6 && answered === Math.ceil(total / 2) ? t("enc.half") :
    total >= 3 && answered === total - 1 ? t("enc.oneLeft") :
    t("enc.rightSub" + randomPick(QUIZ_PRAISE_SUB_COUNT));
  return { tone: "correct", title: t("enc.right" + praise), sub: sub, praise: praise };
}

function showQuizSheet(cheer) {
  var sheet = document.getElementById("quiz-sheet");
  sheet.className = "study-sheet study-sheet-" + cheer.tone;
  document.getElementById("quiz-sheet-title").textContent = cheer.title;
  document.getElementById("quiz-sheet-sub").textContent = cheer.sub;
  void sheet.offsetWidth; // restart the slide-up when the previous answer's sheet was still open
  sheet.classList.add("on");
  document.getElementById("screen-quiz").classList.add("sheet-open");
}

function hideQuizSheet() {
  document.getElementById("quiz-sheet").classList.remove("on");
  document.getElementById("screen-quiz").classList.remove("sheet-open");
}

function quizOptionResultClass(opt, idx, correctVal, selectedIdx) {
  if (opt === correctVal) return "correct";
  return idx === selectedIdx ? "wrong" : "dimmed";
}

// Replaces the post-answer auto-advance with a manual Next, for when the user stops to read
// the explanation or select a word.
function showQuizNextButton() {
  if (document.getElementById("quiz-next-btn")) return;
  var nextBtn = document.createElement("button");
  nextBtn.id = "quiz-next-btn";
  nextBtn.className = "btn btn-primary btn-full";
  nextBtn.innerHTML = t("study.next") + " " + ICON_ARROW_RIGHT;
  nextBtn.addEventListener("click", function() {
    haptic("tick");
    state.quizIndex++;
    renderQuizCard();
  });
  // Duolingo's placement: Continue lives on the feedback sheet, under the thumb, the same
  // spot after every answer.
  document.getElementById("quiz-sheet").appendChild(nextBtn);
}


document.getElementById("btn-quiz-back").addEventListener("click", function() {
  haptic("tick");
  returnFromStudy();
});

document.getElementById("btn-quiz-prev").addEventListener("click", function() {
  if (state.quizIndex === 0) return;
  haptic("tick");
  state.quizIndex--;
  renderQuizCard();
  noteQuizSecondLook();
});

document.getElementById("btn-quiz-review-next").addEventListener("click", function() {
  var card = state.quizCards[state.quizIndex];
  if (!card || !findQuizResult(card)) return;
  haptic("tick");
  state.quizIndex++;
  renderQuizCard();
  noteQuizSecondLook();
});

document.getElementById("btn-quiz-layout").addEventListener("click", function() {
  try { localStorage.setItem("fc-quiz-layout", quizLayout() === "grid" ? "list" : "grid"); } catch (_) {}
  applyQuizLayout();
});

document.getElementById("btn-quiz-edit-card").addEventListener("click", function() {
  var card = state.quizCards[state.quizIndex];
  if (!card) return;
  openEditCard(card.id, card, true);
});

document.getElementById("btn-quiz-delete-card").addEventListener("click", function() {
  var card = state.quizCards[state.quizIndex];
  if (!card) return;
  confirmDelete(t("confirm.deleteCard"), function() {
    store.deleteCard(card.id, card.lesson_id).then(function() {
      // Re-locate by reference rather than trusting state.quizIndex — it may have moved
      // (Prev/Next review, or the auto-advance timer) during the confirm-modal/network wait.
      var idx = state.quizCards.indexOf(card);
      if (idx !== -1) {
        state.quizCards.splice(idx, 1);
        if (idx < state.quizIndex) state.quizIndex--;
      }
      var resIdx = state.quizResults.findIndex(function(r) { return r.card.id === card.id; });
      if (resIdx !== -1) {
        if (state.quizResults[resIdx].correct) state.quizScore--;
        state.quizResults.splice(resIdx, 1);
      }
      renderQuizCard();
    });
  });
});

/* ============================
   QUIZ RESULTS
   ============================ */

function showQuizResults() {
  // renderQuizCard() lands here whenever the index runs past the end — including after the
  // last card is deleted, or Next from the last review card — so the session-over buzz is
  // gated on every card actually having been answered, and fires once per session.
  if (!state.quizCompleteBuzzed && state.quizResults.length === state.quizCards.length) {
    state.quizCompleteBuzzed = true;
    haptic("complete");
  }
  var score  = state.quizScore;
  var total  = state.quizCards.length;
  var pct    = total > 0 ? Math.round(score / total * 100) : 0;

  document.getElementById("results-pct").textContent = pct + "%";
  renderSessionDone("results-done", total > 0 ? score / total : 0, [
    { label: t("done.questions"), value: total, tone: "gold" },
    { label: t("done.bestRun"), value: state.quizBestStreak || 0, tone: "green" },
    { label: t("done.time"), value: formatSessionTime(state.sessionMs), tone: "blue" }
  ]);
  document.getElementById("results-detail").textContent = t("results.correctOutOf", { score: score, total: total });

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
    ? t("results.hintGreat")
    : pct >= 50
    ? t("results.hintOk")
    : t("results.hintKeepPracticing");
  document.getElementById("results-review-hint").textContent = reviewMsg;

  // Surface a summary of any cards that plateaued this session (quiz-correct but capped) —
  // per-question hints can be missed if the card was the last one answered (results screen
  // replaces the quiz screen before a slow network response lands).
  var cappedCount = state.quizResults.filter(function(r) { return r.capped; }).length;
  var capNote = document.getElementById("results-cap-note");
  if (cappedCount > 0) {
    capNote.textContent = t("results.cappedNote", { n: cappedCount });
    capNote.classList.remove("hidden");
  } else {
    capNote.classList.add("hidden");
  }

  // Save session so reminder badges update
  if (state.studyScope) {
    store.saveQuizSession(state.studyScope.lessonIds, score, total);
  }

  setStudyBackLabels();
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
  // Back returns to the screen Stats was opened from, at the same scroll position (the
  // Dashboard keeps its period and charts, since its DOM isn't re-rendered).
  state.statsFrom = { screen: getActiveScreen(), scrollY: window.scrollY };
  cardHistoryRequestId++;
  statsListRequestId++;
  var historyPanel = document.getElementById("stats-history-panel");
  if (historyPanel) historyPanel.remove();
  resetStatsPanel(document.getElementById("stats-hardest"));
  resetStatsPanel(document.getElementById("stats-all"));
  document.getElementById("stats-title").textContent = t("stats.titlePrefix", { title: title });
  // Reset tabs
  setStatsTab("overview");

  renderStatsOverview(type, id);
  renderStatsHardest(type, id);
  renderStatsAll(type, id);
  showScreen("stats");
}

var statsOverviewRequestId = 0;

function renderStatsOverview(type, id) {
  var panel = document.getElementById("stats-overview");
  var requestId = ++statsOverviewRequestId;

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
        statCard(totalCards, t("stats.totalCards")) +
        statCard(attempted, t("stats.attempted")) +
        statCard(totalAttempts > 0 ? accuracy + "%" : t("stats.noDataYet"), t("stats.accuracy")) +
        statCard(totalAttempts, t("stats.totalAttempts")) +
      '</div>' +
      '<div class="diff-bar-label">' + t("stats.difficultyBreakdown") + '</div>' +
      diffBar(t("difficulty.new"), diffCounts.new, totalCards, "#9ca3af") +
      diffBar(t("difficulty.easy"), diffCounts.easy, totalCards, "#16a34a") +
      diffBar(t("difficulty.medium"), diffCounts.medium, totalCards, "#d97706") +
      diffBar(t("difficulty.hard"), diffCounts.hard, totalCards, "#dc2626") +
      (IS_SERVER ? '<div class="diff-bar-label">' + t("stats.accuracyTrend") + '</div><div id="stats-trend-wrap"></div>' : "");

    // No server-side attempt history to bucket by week in local/offline mode.
    if (IS_SERVER) {
      store.getTrend(type, id).then(function(rows) {
        // Ignore if the user has since navigated to a different lesson/class's stats —
        // otherwise this stale response can render into the new panel's same-id element.
        if (requestId !== statsOverviewRequestId) return;
        var trendWrap = document.getElementById("stats-trend-wrap");
        if (trendWrap) renderAccuracyTrend(rows, trendWrap);
      });
    }
  });
}

function statCard(val, label, hint) {
  var titleAttr = hint ? ' title="' + escHtml(hint) + '"' : "";
  return '<div class="stat-card"' + titleAttr + '><div class="stat-value">' + val + '</div><div class="stat-label">' + label + '</div></div>';
}

function _formatHoursMinutes(totalMinutes) {
  var h = Math.floor(totalMinutes / 60);
  var m = totalMinutes % 60;
  if (!h) return t("unit.min", { n: m });
  return m ? t("unit.hMin", { h: h, m: m }) : t("unit.h", { n: h });
}

// Under a minute shows seconds, so a short study day doesn't read as "0 min".
function formatStudyDuration(ms) {
  var sec = Math.round((ms || 0) / 1000);
  if (sec > 0 && sec < 60) return t("unit.s", { n: sec });
  return _formatHoursMinutes(Math.round((ms || 0) / 60000));
}

// Streak/stats "today" is a UTC calendar date server-side (server/routes/stats.js
// groups by date(created_at, 'unixepoch'), which has no local-time offset applied).
// This countdown targets that same UTC midnight so it never disagrees with the
// moment the streak actually rolls over.
function _msUntilUtcMidnight() {
  var now = new Date();
  var next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
  return Math.max(0, next - now.getTime());
}

function _formatCountdownDuration(ms) {
  return _formatHoursMinutes(Math.max(0, Math.ceil(ms / 60000)));
}

function _streakResetCountdownText() {
  return t("stat.streakResetsIn", { time: _formatCountdownDuration(_msUntilUtcMidnight()) });
}




function _dashMetricHint(key, studyTime, newCardEstimate) {
  if (key === "sessions") return t("stat.sessionsHint");
  if (key === "studyTime" || key === "avgDaily" || key === "minDaily" || key === "maxDaily") {
    var st = studyTime || { trackedDays: 0, windowDays: null };
    var base = t("stat.studyTimeTrackedHint", { n: st.trackedDays });
    return st.windowDays ? base + " — " + t("stat.studyTimeWindowHint", { n: st.windowDays }) : base;
  }
  if (key === "newCardEstimate") {
    if (!newCardEstimate) return null;
    if (newCardEstimate.availableNewCards === 0) return t("setup.newCardEstimateNoneLeft");
    if (!newCardEstimate.personalized) return t("setup.newCardEstimateDefaultNote");
    if (newCardEstimate.estimatedNewCards === 0) return t("setup.newCardEstimateZeroNote");
    return t("setup.newCardEstimatePersonalizedNote");
  }
  return null;
}

// Three tiles, each answering one question: am I keeping my streak, how is today going, how
// has the study-time window gone. Chosen by the user from a preview over the old four
// stacked bands, where study time appeared five times without saying which was which. The
// gear still hides single numbers or a whole tile; the old "highlight" now reads as "show".
// dash: { due, futureDue } on the Dashboard, whose third tile is what is due now (study time
// moves to the Charts tab there). Home leaves it out and keeps the study-time tile.
function streakTimeHeroCard(streak, studyTime, summary, newCardEstimate, today, dash) {
  state._dashHeroData = { streak: streak, studyTime: studyTime, summary: summary, newCardEstimate: newCardEstimate, today: today };
  if (dash) state._dashHeroDash = dash;
  var config = Object.assign({}, DEFAULT_DASH_METRIC_CONFIG, state.dashMetricConfig);
  function on(key) { return config[key] !== "hidden"; }
  var gearBtn = '<button class="icon-btn dash-hero-settings-btn" title="' + escHtml(t("dashboard.configureMetrics")) + '">' + ICON_SETTINGS + '</button>';

  var tiles = [];
  var run = on("aboveAvg") && studyTime ? studyTime.aboveAvg : null;
  if (on("streak") || run) tiles.push(heroStreakTile(on("streak") ? streak : null, today, run, !!dash));
  if (today && today.activity) tiles.push(heroTodayTile(today, newCardEstimate, studyTime));
  if (dash) {
    tiles.push(heroDueTile(dash.due, dash.futureDue));
  } else {
    var timeTile = heroStudyTimeTile(studyTime, on);
    if (timeTile) tiles.push(timeTile);
  }

  var library = ["classes", "lessons", "cards", "attempts", "sessions"].filter(on).map(function(key) {
    var m = DASH_METRICS.filter(function(x) { return x.key === key; })[0];
    var n = key === "sessions" ? summary.quizSessions : summary[key];
    return '<span' + (key === "sessions" ? ' title="' + escHtml(t("stat.sessionsHint")) + '"' : '') + '><b>' + escHtml(String(n)) + '</b> ' + escHtml(t(m.labelKey)) + '</span>';
  });
  var libraryHtml = library.length ? '<div class="dash-hero-library">' + library.join('') + '</div>' : '';

  if (!tiles.length && !libraryHtml) {
    return '<div class="dash-hero-card dash-hero-empty">' + gearBtn +
      '<div class="dash-hero-empty-note">' + t("dashboard.allMetricsHidden") + '</div></div>';
  }
  // The gear sits in the last tile's corner, so all three tiles share the card's margins
  // instead of the row giving up a gutter on the right to clear it.
  if (tiles.length) tiles[tiles.length - 1] = tiles[tiles.length - 1].replace(/^(<section[^>]*>)/, "$1" + gearBtn);
  return '<div class="dash-hero-card">' + (tiles.length ? '' : gearBtn) +
    (tiles.length ? '<div class="dash-hero-tiles">' + tiles.join('') + '</div>' : '') +
    libraryHtml +
  '</div>';
}

function heroStreakTile(streak, today, run, withAchievements) {
  // Filled from the last fetch at once, then refreshed by renderDashAchievements().
  var ach = withAchievements ? '<div data-ach-mini>' + (state.achievements ? achMiniHtml(state.achievements) : '') + '</div>' : '';
  if (streak == null) {
    return '<section class="dash-tile"><h3 class="dash-tile-h">' + escHtml(t("hero.streak")) + '</h3>' + heroAboveAvgHtml(run) + ach + '</section>';
  }
  // With this week's rest day unused, missing today does not reset anything, so a
  // countdown would be a false alarm.
  var caption = streak > 0
    ? (today && today.restAvailableToday
      ? '<div class="dash-hero-countdown" title="' + escHtml(t("stat.restDayHint")) + '">' + escHtml(t("stat.restDayAvailable")) + '</div>'
      : '<div class="dash-hero-countdown" data-countdown="streak" title="' + escHtml(t("stat.streakResetsAtHint")) + '">' +
        escHtml(_streakResetCountdownText()) + '</div>')
    : '';
  return '<section class="dash-tile">' +
    '<h3 class="dash-tile-h">' + escHtml(t("hero.streak")) + '</h3>' +
    '<div class="dash-tile-big is-streak">' + ICON_FLAME + '<span class="dash-tile-num">' + escHtml(String(streak)) + '</span>' +
      '<span class="dash-tile-unit">' + escHtml(t("hero.days")) + '</span></div>' +
    heroWeekHtml(today) + heroAboveAvgHtml(run) + caption + ach +
  '</section>';
}

var DASH_DUE_SHOWN = 4;

// What can be reviewed right now, most due first; each row starts that lesson's due review.
function heroDueTile(due, futureDue) {
  var lessons = (due || []).slice().sort(function(a, b) { return (b.dueCount || 0) - (a.dueCount || 0); });
  var total = lessons.reduce(function(sum, l) { return sum + (l.dueCount || 0); }, 0);
  var shown = lessons.slice(0, DASH_DUE_SHOWN);
  var later = futureDue && futureDue.days
    ? futureDueBuckets(futureDue).reduce(function(sum, b) { return b.n > 0 ? sum + b.cnt : sum; }, 0) : null;
  return '<section class="dash-tile">' +
    '<h3 class="dash-tile-h">' + escHtml(t("dashboard.dueNow")) + '</h3>' +
    '<div class="dash-tile-big"><span class="dash-tile-num">' + total + '</span><span class="dash-tile-unit">' + escHtml(t("dashboard.cardsDue")) + '</span></div>' +
    (shown.length ? '<div class="dash-due-rows">' + shown.map(function(l) {
      return '<button type="button" class="dash-due-row" data-due-lesson="' + escHtml(l.id) + '" data-due-class="' + escHtml(l.class_id) + '" title="' + escHtml(t("study.reviewDueTitle")) + '">' +
        '<span class="dash-due-name"><b>' + escHtml(l.title) + '</b><small>' + escHtml(l.class_name) + '</small></span>' +
        '<span class="due-badge">' + escHtml(String(l.dueCount)) + '</span></button>';
    }).join('') + '</div>' : '<div class="dash-due-empty">' + escHtml(t("dashboard.allCaughtUp")) + '</div>') +
    (lessons.length > shown.length ? '<button type="button" class="dash-due-more" data-dash-tab="lessons">' + escHtml(t("dashboard.moreLessonsDue", { n: lessons.length - shown.length })) + '</button>' : '') +
    (later != null ? '<div class="dash-hero-countdown">' + escHtml(t("dashboard.dueLater", { n: later, days: futureDue.windowDays })) + '</div>' : '') +
  '</section>';
}

// The second streak: days in a row studied longer than the rolling 30-day mean (server/lib/aboveAvg.js).
// Before today passes its mean the run shown ends yesterday, and the line says what today still needs.
function heroAboveAvgHtml(run) {
  if (!run) return '';
  var label = run.current === 1 ? t("hero.aboveAvgRun1") : t("hero.aboveAvgRun", { n: run.current });
  var need = Math.max(60000, Math.ceil((run.todayAvgMs - run.todayMs + 1) / 60000) * 60000);
  // Once today counts, the run already includes it; a line saying so only repeats the pill.
  var sub = run.todayAbove ? ''
    : t(run.current > 0 ? "hero.aboveAvgKeep" : "hero.aboveAvgStart", { time: formatStudyDuration(need) });
  return '<div class="dash-run" title="' + escHtml(t("hero.aboveAvgHint")) + '">' +
    '<div class="dash-run-row"><span class="dash-run-pill">▲ ' + escHtml(label) + '</span>' +
    '<span class="dash-run-best">' + escHtml(t("hero.aboveAvgBest", { n: run.best })) + '</span></div>' +
    (sub ? '<div class="dash-run-sub">' + escHtml(sub) + '</div>' : '') +
  '</div>';
}

function heroTodayTile(today, newCardEstimate, studyTime) {
  var a = today.activity;
  var goal = state.dailyGoal;
  var head = goal > 0
    ? '<div class="dash-goal">' + dailyGoalRing(today.count, goal) +
        '<div><div class="dash-goal-title">' + escHtml(t("goal.progress", { done: today.count, goal: goal })) + '</div>' +
        '<div class="dash-goal-sub">' + escHtml(today.count >= goal ? t("goal.met") : t("goal.left", { n: goal - today.count })) + '</div></div>' +
      '</div>'
    : '<div class="dash-goal-title">' + escHtml(t("hero.cardsToday", { n: today.count })) + '</div>';
  var avgMs = studyTime && studyTime.avgDailyMs;
  var newGoal = newCardEstimate ? newCardEstimate.estimatedNewCards : null;
  var cap = state.maxReviewsPerDay;
  var hasCap = cap !== null && cap !== undefined;
  return '<section class="dash-tile">' +
    '<h3 class="dash-tile-h">' + escHtml(t("hero.today")) + '</h3>' + head +
    '<div class="dash-meters">' +
      heroMeter("time", ICON_TODAY_TIME, "hero.studied", formatStudyDuration(a.studyMs),
        avgMs > 0 ? a.studyMs / avgMs : null, avgMs > 0 ? t("hero.studiedHint", { time: formatStudyDuration(avgMs) }) : null) +
      heroMeter("new", ICON_TODAY_NEW, "hero.newCards", newGoal != null ? a.newCards + " / " + newGoal : String(a.newCards),
        newGoal ? a.newCards / newGoal : null, _dashMetricHint("newCardEstimate", studyTime, newCardEstimate)) +
      heroMeter("review", ICON_TODAY_REVIEW, "hero.reviews", hasCap ? a.reviews + " / " + cap : String(a.reviews),
        hasCap ? (cap > 0 ? a.reviews / cap : 1) : null, hasCap ? t("hero.reviewsHint") : null) +
    '</div>' +
  '</section>';
}

// A count with nothing to measure it against (no estimate, no cap, no study history yet)
// is shown without a bar, rather than a bar that means nothing.
function heroMeter(kind, icon, labelKey, value, ratio, hint) {
  return '<div class="dash-meter is-' + kind + '"' + (hint ? ' title="' + escHtml(hint) + '"' : '') + '>' +
    '<div class="dash-meter-top"><span class="dash-meter-label">' + icon + escHtml(t(labelKey)) + '</span><b>' + escHtml(value) + '</b></div>' +
    (ratio == null ? '' : '<div class="dash-meter-track"><i style="transform:scaleX(' + Math.max(0, Math.min(ratio, 1)).toFixed(3) + ')"></i></div>') +
  '</div>';
}

function heroStudyTimeTile(studyTime, on) {
  var st = studyTime || { totalMs: 0, avgDailyMs: 0, minDailyMs: 0, maxDailyMs: 0 };
  var trio = [["studyTime", st.totalMs, "hero.total"], ["minDaily", st.minDailyMs, "hero.shortest"], ["maxDaily", st.maxDailyMs, "hero.longest"]]
    .filter(function(x) { return on(x[0]); })
    .map(function(x) { return '<div><b>' + escHtml(formatStudyDuration(x[1])) + '</b><span>' + escHtml(t(x[2])) + '</span></div>'; });
  if (!on("avgDaily") && !trio.length) return null;
  var hint = _dashMetricHint("studyTime", studyTime, null);
  return '<section class="dash-tile" title="' + escHtml(hint) + '">' +
    '<h3 class="dash-tile-h">' + escHtml(st.windowDays ? t("hero.lastDays", { n: st.windowDays }) : t("stat.allTime")) + '</h3>' +
    (on("avgDaily") ? '<div class="dash-tile-big"><span class="dash-tile-num">' + escHtml(formatStudyDuration(st.avgDailyMs)) + '</span>' +
      '<span class="dash-tile-unit">' + escHtml(t("hero.perDay")) + '</span></div>' : '') +
    studySparkline(st.daily, st.avgDailyMs, !st.windowDays) +
    (trio.length ? '<div class="dash-trio">' + trio.join('') + '</div>' : '') +
  '</section>';
}

// Daily study minutes as a line over an area, today as a dot, and dashed the rolling 30-day
// mean each day was measured against (a flat average from an older server). Days without
// study are drawn at zero: the dips are the information.
function studySparkline(daily, avgMs, allTime) {
  if (!Array.isArray(daily) || daily.length < 2) return '';
  var w = 300, h = 56, pad = 4;
  var rolling = daily.every(function(d) { return typeof d.avgMs === "number"; });
  var max = Math.max.apply(null, daily.map(function(d) { return Math.max(d.ms, rolling ? d.avgMs : 0); }).concat([rolling ? 0 : avgMs || 0, 1]));
  function y(ms) { return (h - pad - (ms / max) * (h - 2 * pad)).toFixed(1); }
  var pts = daily.map(function(d, i) { return (i * w / (daily.length - 1)).toFixed(1) + " " + y(d.ms); });
  var line = "M" + pts.join(" L");
  var last = pts[pts.length - 1].split(" ");
  return '<svg class="dash-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="' +
      escHtml(t("hero.sparkLabel", { n: daily.length })) + '">' +
    '<path class="dash-spark-area" d="' + line + ' L' + w + ' ' + h + ' L0 ' + h + ' Z"/>' +
    (rolling
      ? '<path class="dash-spark-avg" d="M' + daily.map(function(d, i) { return (i * w / (daily.length - 1)).toFixed(1) + " " + y(d.avgMs); }).join(" L") + '"/>'
      : avgMs > 0 ? '<line class="dash-spark-avg" x1="0" x2="' + w + '" y1="' + y(avgMs) + '" y2="' + y(avgMs) + '"/>' : '') +
    '<path class="dash-spark-line" d="' + line + '"/>' +
    '<circle class="dash-spark-dot" cx="' + last[0] + '" cy="' + last[1] + '" r="3"/>' +
  '</svg>' +
  (allTime ? '<div class="dash-spark-note">' + escHtml(t("hero.sparkLabel", { n: daily.length })) + '</div>' : '');
}

var GOAL_RING_R = 22;

function dailyGoalRing(done, goal) {
  var c = 2 * Math.PI * GOAL_RING_R;
  var offset = c * (1 - Math.min(done / goal, 1));
  return '<svg class="goal-ring' + (done >= goal ? ' met' : '') + '" viewBox="0 0 56 56" aria-hidden="true">' +
    '<circle class="goal-ring-track" cx="28" cy="28" r="' + GOAL_RING_R + '"/>' +
    '<circle class="goal-ring-arc" cx="28" cy="28" r="' + GOAL_RING_R + '" style="stroke-dasharray:' + c.toFixed(2) +
      ';stroke-dashoffset:' + offset.toFixed(2) + '"/>' +
    '<text x="28" y="28">' + (done >= goal ? "✓" : done) + '</text>' +
  '</svg>';
}

function weekdayLabel(day) {
  try {
    return new Date(day + "T00:00:00Z").toLocaleDateString(state.language === "vi" ? "vi-VN" : "en-US",
      { weekday: "short", timeZone: "UTC" });
  } catch (_) { return day.slice(5); }
}

// This week's row, from GET /api/stats/today (also embedded in the dashboard response).
// Server mode only: the streak and the day boundary live there.
function heroWeekHtml(today) {
  if (!today || !Array.isArray(today.week)) return "";
  var hasRest = today.restAvailableToday || today.week.some(function(d) { return d.status === "rest"; });
  return '<div class="dash-week" role="list" aria-label="' + escHtml(t("week.label")) + '">' +
    today.week.map(function(d) {
      var mark = d.status === "done" ? "✓" : d.status === "rest" ? "❄" : "";
      var label = weekdayLabel(d.day);
      return '<div class="dash-week-day" role="listitem" aria-label="' + escHtml(label + ": " + t("week." + d.status)) + '" title="' + escHtml(t("week." + d.status)) + '">' +
        '<span class="dash-week-name">' + escHtml(label) + '</span>' +
        '<span class="dash-week-dot is-' + d.status + (d.isToday && d.status !== "today" ? ' is-today' : '') + '">' + mark + '</span>' +
      '</div>';
    }).join('') +
  '</div>' +
  (hasRest ? '<div class="dash-week-hint">' + escHtml(t("week.restHint")) + '</div>' : '');
}

var ICON_TODAY_TIME = svgIcon('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', 14);
var ICON_TODAY_NEW = svgIcon('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>', 14);
var ICON_TODAY_REVIEW = svgIcon('<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>', 14);

// Re-renders any already-rendered hero card(s) in place from the last data used to build
// them, so saving the metrics config updates the board immediately without a network refetch.
function _refreshDashHeroCards() {
  if (!state._dashHeroData) return;
  ["home-summary-grid", "dash-summary-grid"].forEach(function(gridId) {
    var grid = document.getElementById(gridId);
    if (!grid) return;
    var hero = grid.querySelector(".dash-hero-card");
    if (!hero) return;
    var wrap = document.createElement("div");
    wrap.innerHTML = streakTimeHeroCard(state._dashHeroData.streak, state._dashHeroData.studyTime, state._dashHeroData.summary, state._dashHeroData.newCardEstimate, state._dashHeroData.today,
      gridId === "dash-summary-grid" ? state._dashHeroDash : undefined);
    hero.replaceWith(wrap.firstElementChild);
  });
  renderDashStudyTime();
}

// The Dashboard's study-time tile lives in the Charts tab, under the same metric settings.
function renderDashStudyTime() {
  var card = document.getElementById("dash-studytime-card");
  if (!card || !state._dashStudyTime) return;
  var config = Object.assign({}, DEFAULT_DASH_METRIC_CONFIG, state.dashMetricConfig);
  var tile = heroStudyTimeTile(state._dashStudyTime, function(key) { return config[key] !== "hidden"; });
  card.innerHTML = tile || '';
  card.classList.toggle("hidden", !tile);
}

// Keeps any rendered streak countdown(s) fresh. A single interval started once at
// script load rather than per-render/per-navigation — screens here are shown via
// CSS class toggling (see getActiveScreen()), not mount/unmount, so there's no
// teardown hook to pair a start/stop with. Each tick just re-queries the DOM for
// whatever countdown element(s) currently exist and is a no-op when none are
// mounted, so it's safe to run indefinitely without ever leaking or duplicating.
function _updateStreakCountdowns() {
  var els = document.querySelectorAll('.dash-hero-countdown[data-countdown="streak"]');
  if (!els.length) return;
  var text = _streakResetCountdownText();
  els.forEach(function(el) { el.textContent = text; });
}
setInterval(_updateStreakCountdowns, 60000);


function diffBar(name, count, total, color) {
  var pct = total > 0 ? (count / total * 100) : 0;
  return '<div class="diff-bar-row">' +
    '<span class="diff-bar-name">' + name + '</span>' +
    '<div class="diff-bar-track"><div class="diff-bar-fill" style="transform:' + scaleXStyle(pct / 100) + ';background:' + color + '"></div></div>' +
    '<span class="diff-bar-count">' + count + '</span>' +
  '</div>';
}

function setStatsPanelContent(panel, html) {
  var historyPanel = document.getElementById("stats-history-panel");
  var keepHistory = historyPanel && historyPanel.parentElement === panel;
  if (keepHistory) historyPanel.remove();
  panel.innerHTML = html;
  if (keepHistory) panel.insertBefore(historyPanel, panel.firstChild);
}

function resetStatsPanel(panel) {
  setStatsPanelContent(panel, "");
}

var statsListRequestId = 0;
function renderStatsHardest(type, id) {
  var panel = document.getElementById("stats-hardest");
  var requestId = statsListRequestId;
  var scope = { type: type, id: id };
  store.getHardestCards({ scope: scope, limit: 30 }).then(function(items) {
    if (requestId !== statsListRequestId) return;
    if (items.length === 0) {
      setStatsPanelContent(panel, '<div class="empty-state"><p>' + t("stats.noAttemptedCards") + '</p></div>');
      return;
    }
    resetStatsPanel(panel);
    items.forEach(function(item) { panel.appendChild(buildStatsCardEl(item.card, item.stats)); });
  });
}

function renderStatsAll(type, id) {
  var panel = document.getElementById("stats-all");
  var requestId = statsListRequestId;

  if (IS_SERVER) {
    // Chronological (most-recently-attempted first) — distinct from the Hardest Cards
    // tab's difficulty sort, which this tab used to silently reuse.
    store.getHardestCards({ scope: { type: type, id: id }, limit: 9999, sort: "recent" }).then(function(items) {
      if (requestId !== statsListRequestId) return;
      if (items.length === 0) {
        setStatsPanelContent(panel, '<div class="empty-state"><p>' + t("stats.noAttemptedCards") + '</p></div>');
        return;
      }
      resetStatsPanel(panel);
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
    if (requestId !== statsListRequestId) return;
    var attempted = cards.filter(function(c) {
      return allAttempts.some(function(a) { return a.card_id === c.id; });
    });
    if (attempted.length === 0) {
      setStatsPanelContent(panel, '<div class="empty-state"><p>' + t("stats.noAttemptedCards") + '</p></div>');
      return;
    }
    resetStatsPanel(panel);
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
    aEl.textContent = card.data.correct === "true" ? t("common.true") : t("common.false");
  } else if (card.format === "image-def") {
    qEl.textContent = t("card.imagePlaceholder");
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
  pill.textContent = difficultyLabel(stats.level);
  header.appendChild(pill);
  item.appendChild(header);
  item.appendChild(aEl);
  var acc = document.createElement("div");
  acc.className = "stats-accuracy";
  acc.textContent = t("stats.correctOutOfPct", {
    correct: stats.correct, total: stats.total,
    pct: (stats.total > 0 ? Math.round(stats.correct / stats.total * 100) : 0)
  });
  item.appendChild(acc);
  if (IS_SERVER && card.id) {
    var historyBtn = document.createElement("button");
    historyBtn.type = "button";
    historyBtn.className = "btn btn-sm btn-ghost stats-history-btn";
    historyBtn.textContent = t("stats.reviewHistory");
    var cardId = card.id;
    historyBtn.addEventListener("click", function() { renderCardHistory(cardId); });
    item.appendChild(historyBtn);
  }
  return item;
}

var cardHistoryRequestId = 0;
function renderCardHistory(cardId) {
  var panel = document.getElementById("stats-hardest").classList.contains("active")
    ? document.getElementById("stats-hardest") : document.getElementById("stats-all");
  var requestId = ++cardHistoryRequestId;
  var historyPanel = document.getElementById("stats-history-panel");
  if (!historyPanel) {
    historyPanel = document.createElement("div");
    historyPanel.id = "stats-history-panel";
    historyPanel.className = "stats-history-panel";
  }
  if (historyPanel.parentElement !== panel) panel.insertBefore(historyPanel, panel.firstChild);
  historyPanel.textContent = t("common.loadingEllipsis");
  store.getCardHistory(cardId).then(function(result) {
    if (requestId !== cardHistoryRequestId) return;
    var card = result.card;
    var promptEl = document.createElement("div");
    promptEl.className = "stats-card-q";
    var data = typeof card.data === "string" ? JSON.parse(card.data) : card.data;
    if (card.format === "term-def") renderLatex(data.term, promptEl);
    else if (card.format === "true-false") renderLatex(data.statement, promptEl);
    else if (card.format === "image-def") promptEl.textContent = t("card.imagePlaceholder");
    else renderLatex(data.question || "", promptEl);
    historyPanel.innerHTML = "";
    var heading = document.createElement("div");
    heading.className = "stats-history-heading";
    heading.textContent = t("stats.reviewHistory");
    historyPanel.appendChild(heading);
    historyPanel.appendChild(promptEl);
    if (result.hasMore) {
      var omitted = document.createElement("div");
      omitted.className = "dash-empty-note";
      omitted.textContent = t("stats.historyOlderOmitted", { n: result.attempts.length });
      historyPanel.appendChild(omitted);
    }
    if (!result.attempts.length) {
      var empty = document.createElement("div");
      empty.className = "dash-empty-note";
      empty.textContent = t("stats.noReviewHistory");
      historyPanel.appendChild(empty);
      return;
    }
    var list = document.createElement("div");
    list.className = "stats-history-list";
    result.attempts.slice().reverse().forEach(function(attempt) {
      var row = document.createElement("div");
      row.className = "stats-history-row";
      var date = new Date(attempt.created_at * 1000);
      var grade = attempt.grade === "hard" ? t("dashboard.gradeHard")
        : attempt.grade === "medium" ? t("dashboard.gradeMedium")
        : attempt.grade === "easy" ? t("dashboard.gradeEasy")
        : attempt.grade == null && attempt.source !== "quiz" ? (attempt.correct ? "—" : t("dashboard.gradeAgain"))
        : attempt.grade == null ? t("stats.notApplicable")
        : t("dashboard.gradeUngraded");
      var duration = attempt.duration_ms == null ? "—" : attempt.duration_ms < 60000
        ? t("unit.s", { n: Math.round(attempt.duration_ms / 1000) }) : formatStudyDuration(attempt.duration_ms);
      row.textContent = date.toLocaleString() + " · " +
        (attempt.correct ? t("stats.correct") : t("stats.incorrect")) + " · " +
        t("stats.mode." + attempt.source) + " · " + grade + " · " + duration;
      list.appendChild(row);
    });
    historyPanel.appendChild(list);
  }).catch(function() {
    if (requestId === cardHistoryRequestId) historyPanel.textContent = t("common.networkError");
  });
}

// Stats tab switching
function setStatsTab(name) {
  document.querySelectorAll(".stats-tabs .tab").forEach(function(t) {
    t.classList.toggle("active", t.dataset.tab === name);
    t.setAttribute("aria-selected", String(t.dataset.tab === name));
  });
  document.querySelectorAll(".stats-panel").forEach(function(p) { p.classList.toggle("active", p.id === "stats-" + name); });
}
document.querySelectorAll(".stats-tabs .tab").forEach(function(tab) {
  tab.addEventListener("click", function() { setStatsTab(this.dataset.tab); });
});

document.getElementById("btn-stats-back").addEventListener("click", function() {
  var from = state.statsFrom;
  state.statsFrom = null;
  if (from && from.screen && from.screen !== "stats") {
    showScreen(from.screen);
    window.scrollTo(0, from.scrollY);
    return;
  }
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
  return store.getClass(classId).then(function(cls) {
    if (!cls) return;
    state.currentClass = cls;
    return store.getLessons(classId).then(function(lessons) {
      state.currentClassLessons = lessons;
      var lesson = lessons.find(function(l) { return l.id === lessonId; });
      if (!lesson) return;
      state.currentLesson = lesson;
      document.getElementById("lesson-detail-title").textContent = lesson.title;
      return store.getCards(lessonId).then(function(cards) {
        state.currentLessonCards = cards;
        var nowSec = Math.floor(Date.now() / 1000);
        var dueCards = cards.filter(function(c) { return c.srs_due_at && c.srs_due_at <= nowSec; });
        if (!dueCards.length) { renderCards(); showScreen("lesson"); return; }
        return startDueQuiz(lesson, dueCards, "dashboard");
      });
    });
  });
}

var dashboardAnalyticsRequestId = 0;
var dashboardPeriodRequestId = 0;
function renderDashboard() {
  dashboardAnalyticsRequestId++;
  dashboardPeriodRequestId++;
  var requestId = dashboardAnalyticsRequestId;
  var periodRequestId = dashboardPeriodRequestId;
  var loadEl  = document.getElementById("dash-loading");
  var errEl   = document.getElementById("dash-error");
  loadEl.classList.remove("hidden");
  errEl.classList.add("hidden");
  var exportBtn = document.getElementById("btn-dashboard-export");
  if (exportBtn) exportBtn.disabled = true;
  ["dash-summary-grid",
   "dash-chart-kpis","dash-heatmap-wrap","dash-trend-wrap","dash-newcards-trend-wrap","dash-srs-wrap","dash-future-due-wrap","dash-retention-wrap","dash-grade-wrap","dash-reviewtime-wrap",
   "dash-studytime-card","dash-attn-list","dash-lesson-table"].forEach(function(id) {
    document.getElementById(id).innerHTML = "";
  });

  // Isolated .catch so a new-card-estimate failure can't blank out the rest of the dashboard.
  var newCardEstimatePromise = store.getNewCardEstimate().catch(function() { return null; });
  Promise.all([store.getDashboard(state.studyTimeWindowDays), store.getAnalytics(state.dashPeriod), store.getSrsDistribution(state.dashPeriod), store.getFutureDue(), newCardEstimatePromise]).then(function(results) {
    if (requestId !== dashboardAnalyticsRequestId) return;
    if (periodRequestId !== dashboardPeriodRequestId) { renderDashboard(); return; }
    var d = results[0], analytics = results[1], srs = results[2], futureDue = results[3], newCardEstimate = results[4];
    var days = analytics.days || state.dashPeriod || 60;
    loadEl.classList.add("hidden");

    // Summary stat cards with streak first
    var summaryGrid = document.getElementById("dash-summary-grid");
    summaryGrid.innerHTML = streakTimeHeroCard(d.streak, d.studyTime, d.summary, newCardEstimate, d.today, { due: d.dueForReview || [], futureDue: futureDue });
    renderDashAchievements();
    state._dashStudyTime = d.studyTime;
    renderDashStudyTime();

    // Charts (from analytics)
    state.dashFutureDue = futureDue;
    state.dashSrs = srs;
    renderStudyCharts(analytics);
    renderSrsDistribution(srs, document.getElementById("dash-srs-wrap"));
    var futureDueTitle = document.getElementById("dash-future-due-title");
    if (futureDueTitle) futureDueTitle.textContent = t("dashboard.futureDue", { n: futureDue.windowDays });
    renderFutureDue(futureDue, document.getElementById("dash-future-due-wrap"));

    // Enable export if there's data
    var totalAttempts = (analytics.lessonBreakdown || []).reduce(function(sum, l) { return sum + (l.total_attempts || 0); }, 0);
    if (exportBtn) exportBtn.disabled = totalAttempts === 0;

    state.dashLessonData = { lessons: d.lessons || [], due: d.dueForReview || [], breakdown: analytics.lessonBreakdown || [],
      struggling: analytics.strugglingLessons || [], days: days };
    renderDashLessons();

  }).catch(function() {
    if (requestId !== dashboardAnalyticsRequestId) return;
    if (periodRequestId !== dashboardPeriodRequestId) { renderDashboard(); return; }
    loadEl.classList.add("hidden");
    errEl.classList.remove("hidden");
  });
}

var DASH_ATTENTION_SHOWN = 5;
var DASH_TABS = ["overview", "charts", "lessons"];

// One row per lesson of a live class. Accuracy and answers are all time (lessonBreakdown),
// mastered and due are now, struggling is the chart period's window.
function dashLessonTableRows(lessons, breakdown, due, struggling) {
  var byId = {};
  var rows = (lessons || []).map(function(l) {
    var r = { id: l.id, class_id: l.class_id, title: l.title, class_name: l.class_name, cards: l.cards || 0,
      mastered: l.mastered || 0, attempts: 0, accuracy: null, due: 0, hardRatio: null };
    byId[l.id] = r;
    return r;
  });
  (breakdown || []).forEach(function(b) {
    var r = byId[b.id];
    if (!r) return;
    r.attempts = b.total_attempts || 0;
    r.accuracy = r.attempts ? Math.round((b.correct_attempts || 0) / r.attempts * 100) : null;
  });
  (due || []).forEach(function(d) { if (byId[d.id]) byId[d.id].due = d.dueCount || 0; });
  (struggling || []).forEach(function(x) { if (byId[x.id]) byId[x.id].hardRatio = x.hardRatio; });
  return rows;
}

function dashNeedsAttention(r) {
  return r.due > 0 || r.hardRatio != null;
}

// "attention": most due first, then struggling, then weakest. Other keys sort one column; a
// lesson with no value there (never answered, no cards) goes last whichever way it runs.
function sortDashLessons(rows, key, dir) {
  var sign = dir === "asc" ? 1 : -1;
  function val(r) {
    if (key === "accuracy") return r.accuracy;
    if (key === "answers") return r.attempts;
    if (key === "mastered") return r.cards ? r.mastered / r.cards : null;
    if (key === "due") return r.due;
    return null;
  }
  return rows.slice().sort(function(a, b) {
    if (key === "attention") {
      return (b.due - a.due) || ((b.hardRatio != null) - (a.hardRatio != null)) ||
        ((a.accuracy == null ? 101 : a.accuracy) - (b.accuracy == null ? 101 : b.accuracy)) || a.title.localeCompare(b.title);
    }
    if (key === "name") return sign * a.title.localeCompare(b.title);
    var va = val(a), vb = val(b);
    if (va == null && vb == null) return a.title.localeCompare(b.title);
    if (va == null) return 1;
    if (vb == null) return -1;
    return sign * (va - vb) || a.title.localeCompare(b.title);
  });
}

function dashLessonTableHtml(rows, opts) {
  opts = opts || {};
  var cols = [["name", "dashboard.colLesson"], ["accuracy", "dashboard.colAccuracy"], ["answers", "dashboard.colAnswers"],
    ["mastered", "dashboard.colMastered"], ["due", "dashboard.colDue"]];
  var head = '<div class="dash-lrow dash-lhead" role="row">' + cols.map(function(c) {
    var label = escHtml(t(c[1]));
    if (!opts.sortable) return '<span role="columnheader">' + label + '</span>';
    var on = opts.sortKey === c[0];
    return '<button type="button" role="columnheader" class="dash-lsort' + (on ? ' is-on' : '') + '" data-sort="' + c[0] + '" aria-sort="' +
      (on ? (opts.sortDir === "asc" ? "ascending" : "descending") : "none") + '">' + label + (on ? (opts.sortDir === "asc" ? ' ↑' : ' ↓') : '') + '</button>';
  }).join('') + '<span role="columnheader"></span></div>';
  var body = rows.map(function(r) {
    var mastered = r.cards ? Math.round(r.mastered / r.cards * 100) : null;
    var acc = r.accuracy == null ? '' : r.accuracy >= 70 ? ' is-good' : r.accuracy >= 40 ? ' is-mid' : ' is-bad';
    return '<div class="dash-lrow" role="row" tabindex="0" data-lesson="' + escHtml(r.id) + '" data-title="' + escHtml(r.title) + '">' +
      '<span class="dash-lname" role="cell"><b>' + escHtml(r.title) + '</b><small>' + escHtml(r.class_name) + '</small></span>' +
      '<span class="dash-lnum dash-lacc' + acc + '" role="cell" data-label="' + escHtml(t("dashboard.colAccuracy")) + '">' + (r.accuracy == null ? '—' : r.accuracy + '%') + '</span>' +
      '<span class="dash-lnum" role="cell" data-label="' + escHtml(t("dashboard.colAnswers")) + '">' + r.attempts + '</span>' +
      '<span class="dash-lnum" role="cell" data-label="' + escHtml(t("dashboard.colMastered")) + '">' + (mastered == null ? '—' : mastered + '%') + '</span>' +
      '<span class="dash-lnum" role="cell">' + (r.due
        ? '<button type="button" class="due-badge dash-ldue" data-due-lesson="' + escHtml(r.id) + '" data-due-class="' + escHtml(r.class_id) + '" title="' + escHtml(t("study.reviewDueTitle")) + '">' + escHtml(t("count.due", { n: r.due })) + '</button>'
        : '<span class="dash-lnone">—</span>') + '</span>' +
      '<span class="dash-lflag" role="cell">' + (r.hardRatio != null
        ? '<span class="diff-pill hard" title="' + escHtml(t("dashboard.strugglingHint", { pct: Math.round(r.hardRatio * 100), n: opts.days })) + '">' + escHtml(t("dashboard.struggling")) + '</span>'
        : '') + '</span>' +
    '</div>';
  }).join('');
  return '<div class="dash-ltable" role="table">' + head + body + '</div>';
}

function renderDashLessons() {
  var data = state.dashLessonData;
  if (!data) return;
  var rows = dashLessonTableRows(data.lessons, data.breakdown, data.due, data.struggling);
  var attention = sortDashLessons(rows.filter(dashNeedsAttention), "attention");
  document.getElementById("dash-attn-badge").textContent = attention.length || "";
  document.getElementById("dash-attn-list").innerHTML = attention.length
    ? dashLessonTableHtml(attention.slice(0, DASH_ATTENTION_SHOWN), { days: data.days })
    : '<div class="dash-empty-note">' + escHtml(t("dashboard.nothingNeedsAttention")) + '</div>';
  var filter = state.dashLessonFilter || "all";
  document.querySelectorAll("#dash-lesson-filter .pill").forEach(function(p) {
    var on = p.dataset.filter === filter;
    p.classList.toggle("active", on);
    p.setAttribute("aria-pressed", on);
  });
  document.getElementById("dash-lesson-note").textContent = t("dashboard.lessonsNote", { n: data.days });
  var shown = filter === "attention" ? rows.filter(dashNeedsAttention) : rows;
  var key = state.dashLessonSort || "attention", dir = state.dashLessonSortDir || "desc";
  document.getElementById("dash-lesson-table").innerHTML = shown.length
    ? dashLessonTableHtml(sortDashLessons(shown, key, dir), { sortable: true, sortKey: key, sortDir: dir, days: data.days })
    : '<div class="dash-empty-note">' + escHtml(t(rows.length ? "dashboard.nothingNeedsAttention" : "dashboard.noLessons")) + '</div>';
}

function setDashTab(tab) {
  if (DASH_TABS.indexOf(tab) === -1) tab = "overview";
  state.dashTab = tab;
  try { localStorage.setItem("fc-dash-tab", tab); } catch (_) {}
  DASH_TABS.forEach(function(name) {
    var on = name === tab;
    var btn = document.getElementById("dash-tab-" + name);
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on);
    btn.tabIndex = on ? 0 : -1;
    document.getElementById("dash-panel-" + name).classList.toggle("hidden", !on);
  });
  // Charts drawn while their tab was hidden were sized to a guess; draw them at the real width.
  if (tab === "charts") redrawDashCharts();
}

function redrawDashCharts() {
  if (state.dashAnalytics) renderStudyCharts(state.dashAnalytics);
  if (state.dashSrs) renderSrsDistribution(state.dashSrs, document.getElementById("dash-srs-wrap"));
  if (state.dashFutureDue) renderFutureDue(state.dashFutureDue, document.getElementById("dash-future-due-wrap"));
}

setDashTab((function() { try { return localStorage.getItem("fc-dash-tab"); } catch (_) { return null; } })());

document.getElementById("dash-tabs").addEventListener("click", function(e) {
  var btn = e.target.closest("[data-tab]");
  if (btn) setDashTab(btn.dataset.tab);
});
document.getElementById("dash-tabs").addEventListener("keydown", function(e) {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  var i = DASH_TABS.indexOf(state.dashTab) + (e.key === "ArrowRight" ? 1 : -1);
  setDashTab(DASH_TABS[(i + DASH_TABS.length) % DASH_TABS.length]);
  document.getElementById("dash-tab-" + state.dashTab).focus();
  e.preventDefault();
});

function openDashLessonRow(row) {
  openStats("lesson", row.dataset.lesson, row.dataset.title);
}

document.getElementById("screen-dashboard").addEventListener("click", function(e) {
  var dueBtn = e.target.closest("[data-due-lesson]");
  if (dueBtn) {
    if (dueBtn.classList.contains("is-loading")) return;
    dueBtn.classList.add("is-loading");
    openDueReview(dueBtn.dataset.dueLesson, dueBtn.dataset.dueClass).catch(function() {
      showToast(t("setup.loadFailed"), "error");
    }).then(function() { dueBtn.classList.remove("is-loading"); });
    return;
  }
  if (e.target.closest("[data-open-achievements]")) { openAchievementsScreen(); return; }
  var tabLink = e.target.closest("[data-dash-tab]");
  if (tabLink) { setDashTab(tabLink.dataset.dashTab); return; }
  var sortBtn = e.target.closest(".dash-lsort");
  if (sortBtn) {
    var key = sortBtn.dataset.sort;
    // Weakest first and A to Z are the useful first clicks; a second click reverses.
    state.dashLessonSortDir = state.dashLessonSort === key
      ? (state.dashLessonSortDir === "asc" ? "desc" : "asc")
      : (key === "accuracy" || key === "name" ? "asc" : "desc");
    state.dashLessonSort = key;
    renderDashLessons();
    return;
  }
  var pill = e.target.closest("#dash-lesson-filter .pill");
  if (pill) { state.dashLessonFilter = pill.dataset.filter; renderDashLessons(); return; }
  var row = e.target.closest(".dash-lrow[data-lesson]");
  if (row) openDashLessonRow(row);
});
document.getElementById("screen-dashboard").addEventListener("keydown", function(e) {
  if (e.key !== "Enter" || !e.target.matches(".dash-lrow[data-lesson]")) return;
  openDashLessonRow(e.target);
});

function openDashboard() {
  renderDashboard();
  showScreen("dashboard");
}

document.getElementById("btn-dashboard-back").addEventListener("click", function() {
  dashboardAnalyticsRequestId++;
  dashboardPeriodRequestId++;
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
    var requestId = ++dashboardPeriodRequestId;
    try { localStorage.setItem("fc-dash-period", state.dashPeriod); } catch (_) {}
    updatePills();
    document.getElementById("dash-heatmap-wrap").innerHTML = "";
    document.getElementById("dash-trend-wrap").innerHTML = "";
    document.getElementById("dash-newcards-trend-wrap").innerHTML = "";
    document.getElementById("dash-srs-wrap").innerHTML = "";
    document.getElementById("dash-retention-wrap").innerHTML = "";
    document.getElementById("dash-grade-wrap").innerHTML = "";
    document.getElementById("dash-reviewtime-wrap").innerHTML = "";
    store.getSrsDistribution(state.dashPeriod).then(function(srs) {
      if (requestId !== dashboardPeriodRequestId) return;
      state.dashSrs = srs;
      renderSrsDistribution(srs, document.getElementById("dash-srs-wrap"));
    }).catch(function() {
      if (requestId !== dashboardPeriodRequestId) return;
      document.getElementById("dash-srs-wrap").textContent = t("common.networkError");
    });
    store.getAnalytics(state.dashPeriod).then(function(analytics) {
      if (requestId !== dashboardPeriodRequestId) return;
      var days = analytics.days || state.dashPeriod;
      renderStudyCharts(analytics);
      if (state.dashLessonData) {
        state.dashLessonData.breakdown = analytics.lessonBreakdown || [];
        state.dashLessonData.struggling = analytics.strugglingLessons || [];
        state.dashLessonData.days = days;
        renderDashLessons();
      }
    }).catch(function() {
      if (requestId !== dashboardPeriodRequestId) return;
      ["dash-heatmap-wrap", "dash-trend-wrap", "dash-newcards-trend-wrap", "dash-retention-wrap", "dash-grade-wrap", "dash-reviewtime-wrap"].forEach(function(id) {
        document.getElementById(id).textContent = t("common.networkError");
      });
    });
  });
}());

// Dashboard accuracy per week, as a line: accuracy is a rate, so a bar's length would claim
// a quantity. The Stats screen's lesson/class trend keeps renderAccuracyTrend's rows.
function renderRetentionTrend(rows, wrap, maxWeeksAgo) {
  if (!wrap) return;
  var map = {};
  (rows || []).forEach(function(r) { map[r.weeks_ago] = r; });
  var weeks = chartWeeks(maxWeeksAgo);
  var pcts = weeks.map(function(w) { var r = map[w]; return r && r.total > 0 ? Math.round((r.correct || 0) / r.total * 100) : null; });
  var known = pcts.filter(function(p) { return p != null; });
  if (!known.length) {
    wrap.innerHTML = '<div class="dash-empty-note">' + t("stats.noAttemptedCards") + '</div>';
    return;
  }
  var lo = Math.max(0, Math.min(90, Math.floor((Math.min.apply(null, known) - 5) / 10) * 10));
  wrap.innerHTML = chartLineSvg({
    width: chartWidth(wrap), labels: weeks.map(chartWeekLabel), values: pcts, min: lo, max: 100, cls: "accuracy",
    ticks: [lo, (lo + 100) / 2, 100], fmt: function(v) { return Math.round(v) + "%"; },
    titles: weeks.map(function(w, i) { var r = map[w]; return chartWeekTitle(w) + ": " + (r && r.total > 0 ? pcts[i] + "% (" + r.correct + "/" + r.total + ")" : "—"); })
  });
}

// Answers in the window grouped the way the grade split reads: Again first, then the
// flashcard grades in order, then quiz answers and answers marked known without a grade.
function gradeSegments(rows) {
  var counts = {};
  (rows || []).forEach(function(r) {
    var key;
    if (r.source === "quiz") key = r.correct ? "quiz:correct" : "quiz:incorrect";
    else if (!r.correct) key = "again";
    else if (r.grade === "hard" || r.grade === "medium" || r.grade === "easy") key = r.grade;
    else key = "ungraded";
    counts[key] = (counts[key] || 0) + r.cnt;
  });
  return ["again", "hard", "medium", "easy", "quiz:correct", "quiz:incorrect", "ungraded"].filter(function(k) { return counts[k] > 0; }).map(function(key) {
    var label = key === "again" ? t("dashboard.gradeAgain")
      : key === "hard" ? t("dashboard.gradeHard")
      : key === "medium" ? t("dashboard.gradeMedium")
      : key === "easy" ? t("dashboard.gradeEasy")
      : key === "ungraded" ? t("dashboard.gradeUngraded")
      : t("dashboard.gradeQuiz") + " · " + (key.slice(5) === "correct" ? t("stats.correct") : t("stats.incorrect"));
    return { key: key, cls: key.replace(":", "-"), label: label, cnt: counts[key] };
  });
}

// Bucket 0 is today: the server groups cards due later today and cards already due or
// overdue under today's date.
function futureDueBuckets(data) {
  var map = {};
  (data.days || []).forEach(function(r) { map[r.day] = r.cnt; });
  var now = new Date();
  var buckets = [];
  for (var i = 0; i <= data.windowDays; i++) {
    var d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
    buckets.push({ n: i, cnt: map[d.toISOString().slice(0, 10)] || 0 });
  }
  return buckets;
}

var studyChartResizeTimer = null;
window.addEventListener("resize", function() {
  clearTimeout(studyChartResizeTimer);
  studyChartResizeTimer = setTimeout(function() {
    var wrap = document.getElementById("dash-trend-wrap");
    if (!wrap || !wrap.clientWidth || !state.dashAnalytics) return;
    if (Math.abs(wrap.clientWidth - (state.dashChartWidth || 0)) < 24) return;
    redrawDashCharts();
  }, 200);
});

// ── Study charts: shared drawing ─────────────────────────────────────────────
// Time runs left to right, oldest first. Each chart is drawn at its container's pixel
// width (1 SVG unit = 1px) so its 10px labels stay 10px in a quarter-width card and a
// phone-width one alike; a resize redraws them (see the dashboard's resize handler).

// weeks_ago values for a window, oldest first. A 90-day window reaches back 12 full weeks
// plus six days, so weeks_ago 13 can never hold an answer and is not drawn.
function chartWeeks(maxWeeksAgo) {
  var out = [];
  for (var w = Math.max(0, maxWeeksAgo); w >= 0; w--) out.push(w);
  return out;
}

function chartWeekLabel(weeksAgo) {
  return weeksAgo === 0 ? t("chart.thisWeekShort") : weeksAgo === 1 ? t("chart.lastWeekShort") : t("chart.weeksAgoShort", { n: weeksAgo });
}

function chartWeekTitle(weeksAgo) {
  return weeksAgo === 0 ? t("dashboard.thisWeek") : weeksAgo === 1 ? t("dashboard.lastWeek") : t("time.weeksAgo", { n: weeksAgo });
}

function chartWidth(wrap) {
  var w = wrap && wrap.clientWidth;
  return w > 0 ? w : 300;
}

// A round top for the y axis with at most four steps of 1, 2, 2.5 or 5 times a power of ten.
function chartScale(max) {
  if (!(max > 0)) return { top: 1, step: 1 };
  var mag = Math.pow(10, Math.floor(Math.log10(max)));
  var mults = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10];
  for (var i = 0; i < mults.length; i++) {
    var step = Math.max(1, mults[i] * mag);
    if (Math.ceil(max / step) <= 4) return { top: Math.ceil(max / step) * step, step: step };
  }
  return { top: Math.ceil(max / (10 * mag)) * 10 * mag, step: 10 * mag };
}

function chartTick(v) {
  return v >= 1000 ? (Math.round(v / 100) / 10) + "k" : String(v);
}

// Which x labels fit: every k-th, always the last, and none crowding the last.
function chartLabelIndices(n, width) {
  var fit = Math.max(2, Math.floor(width / 40));
  var k = Math.max(1, Math.ceil(n / fit));
  var out = [];
  for (var i = 0; i < n; i++) {
    if (i === n - 1 || (i % k === 0 && n - 1 - i >= k)) out.push(i);
  }
  return out;
}

var CHART_PAD = { l: 34, r: 6, t: 8, b: 18 };

function chartXAxis(labels, w, h) {
  var cw = (w - CHART_PAD.l - CHART_PAD.r) / labels.length;
  return chartLabelIndices(labels.length, w - CHART_PAD.l).map(function(i) {
    var x = CHART_PAD.l + cw * i + cw / 2;
    var anchor = i === labels.length - 1 && labels.length > 1 ? "end" : "middle";
    if (anchor === "end") x = Math.min(x + cw / 2, w);
    return '<text class="chart-x" x="' + x.toFixed(1) + '" y="' + (h - 4) + '" text-anchor="' + anchor + '">' + escHtml(labels[i]) + '</text>';
  }).join('');
}

function chartColumnsSvg(o) {
  var w = Math.max(160, Math.round(o.width)), h = o.height || 150;
  var n = o.values.length, cw = (w - CHART_PAD.l - CHART_PAD.r) / n, bw = Math.max(2, Math.min(cw * 0.66, 28));
  var scale = chartScale(Math.max.apply(null, o.values.concat([0])));
  var plotH = h - CHART_PAD.t - CHART_PAD.b;
  function y(v) { return CHART_PAD.t + plotH * (1 - v / scale.top); }
  var out = '<svg class="chart-svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img">';
  for (var tv = 0; tv <= scale.top + 1e-9; tv += scale.step) {
    out += '<line class="chart-grid" x1="' + CHART_PAD.l + '" x2="' + (w - CHART_PAD.r) + '" y1="' + y(tv).toFixed(1) + '" y2="' + y(tv).toFixed(1) + '"/>' +
      '<text class="chart-y" x="' + (CHART_PAD.l - 6) + '" y="' + (y(tv) + 3).toFixed(1) + '" text-anchor="end">' + escHtml(chartTick(tv)) + '</text>';
  }
  o.values.forEach(function(v, i) {
    if (!v) return;
    var bh = plotH * v / scale.top;
    out += '<rect class="chart-bar chart-bar-' + o.cls + (i === o.hot ? ' is-hot' : '') + '" x="' + (CHART_PAD.l + cw * i + (cw - bw) / 2).toFixed(1) +
      '" y="' + (h - CHART_PAD.b - bh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="2">' +
      '<title>' + escHtml(o.titles ? o.titles[i] : o.labels[i] + ": " + v) + '</title></rect>';
  });
  return out + chartXAxis(o.labels, w, h) + '</svg>';
}

// A line through the weeks that have a value; weeks without one leave a gap in the dots
// and the line runs straight across it.
function chartLineSvg(o) {
  var w = Math.max(160, Math.round(o.width)), h = o.height || 150;
  var n = o.values.length, cw = (w - CHART_PAD.l - CHART_PAD.r) / n, plotH = h - CHART_PAD.t - CHART_PAD.b;
  function x(i) { return CHART_PAD.l + cw * i + cw / 2; }
  function y(v) { return CHART_PAD.t + plotH * (1 - (v - o.min) / (o.max - o.min)); }
  var out = '<svg class="chart-svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img">';
  o.ticks.forEach(function(tv) {
    out += '<line class="chart-grid" x1="' + CHART_PAD.l + '" x2="' + (w - CHART_PAD.r) + '" y1="' + y(tv).toFixed(1) + '" y2="' + y(tv).toFixed(1) + '"/>' +
      '<text class="chart-y" x="' + (CHART_PAD.l - 6) + '" y="' + (y(tv) + 3).toFixed(1) + '" text-anchor="end">' + escHtml(o.fmt(tv)) + '</text>';
  });
  var pts = [];
  o.values.forEach(function(v, i) { if (v != null) pts.push({ x: x(i), y: y(v), i: i }); });
  if (pts.length) {
    var d = pts.map(function(p) { return p.x.toFixed(1) + " " + p.y.toFixed(1); }).join(" L");
    var floor = (h - CHART_PAD.b).toFixed(1);
    out += '<path class="chart-area chart-area-' + o.cls + '" d="M' + d + ' L' + pts[pts.length - 1].x.toFixed(1) + ' ' + floor + ' L' + pts[0].x.toFixed(1) + ' ' + floor + ' Z"/>' +
      '<path class="chart-line chart-line-' + o.cls + '" d="M' + d + '"/>';
    pts.forEach(function(p) {
      out += '<circle class="chart-dot chart-dot-' + o.cls + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3"><title>' +
        escHtml(o.titles ? o.titles[p.i] : o.labels[p.i]) + '</title></circle>';
    });
  }
  return out + chartXAxis(o.labels, w, h) + '</svg>';
}

// The headline row: this week against last week, then what is coming due. "This week" is
// the last seven days, the same rolling bucket the charts below call This.
function chartKpisHtml(analytics, futureDue) {
  function byWeek(rows) { var m = {}; (rows || []).forEach(function(r) { m[r.weeks_ago] = r; }); return m; }
  var wk = byWeek(analytics && analytics.weeklyTrend), nw = byWeek(analytics && analytics.newCardsWeeklyTrend), tm = byWeek(analytics && analytics.reviewTimeTrend);
  function delta(now, prev, fmt, tone) {
    if (prev == null) return escHtml(t("chart.noLastWeek"));
    var diff = now - prev;
    var cls = diff === 0 || !tone ? "flat" : diff > 0 ? "up" : "down";
    var arrow = diff > 0 ? "▲ " : diff < 0 ? "▼ " : "";
    return '<span class="chart-delta ' + cls + '">' + arrow + escHtml(diff === 0 ? t("chart.same") : fmt(Math.abs(diff))) + '</span> ' + escHtml(t("chart.vsLastWeek"));
  }
  function kpi(label, value, sub) {
    return '<div class="stat-card chart-kpi"><span class="chart-kpi-label">' + escHtml(label) + '</span>' +
      '<span class="chart-kpi-value">' + escHtml(value) + '</span><span class="chart-kpi-sub">' + sub + '</span></div>';
  }
  var a0 = wk[0] ? wk[0].cnt : 0, a1 = wk[1] ? wk[1].cnt : 0;
  var acc0 = wk[0] && wk[0].cnt ? Math.round((wk[0].correct || 0) / wk[0].cnt * 100) : null;
  var acc1 = wk[1] && wk[1].cnt ? Math.round((wk[1].correct || 0) / wk[1].cnt * 100) : null;
  var n0 = nw[0] ? nw[0].cnt : 0, n1 = nw[1] ? nw[1].cnt : 0;
  var s0 = tm[0] && tm[0].samples ? Math.round(tm[0].avg_ms / 1000) : null;
  var s1 = tm[1] && tm[1].samples ? Math.round(tm[1].avg_ms / 1000) : null;
  var out = [
    // Answers compare as a percentage: 300 more means little against 3,000 and a lot against 100.
    kpi(t("chart.kpiAnswers"), a0.toLocaleString(), a1 ? delta(Math.round(a0 / a1 * 100), 100, function(d) { return d + "%"; }, true) : delta(0, null)),
    kpi(t("chart.kpiAccuracy"), acc0 == null ? "—" : acc0 + "%", acc0 != null && acc1 != null ? delta(acc0, acc1, function(d) { return t(d === 1 ? "chart.point" : "chart.points", { n: d }); }, true) : delta(0, null)),
    kpi(t("chart.kpiNewCards"), n0.toLocaleString(), wk[1] ? delta(n0, n1, function(d) { return d.toLocaleString(); }, false) : delta(0, null)),
    kpi(t("chart.kpiAnswerTime"), s0 == null ? "—" : t("unit.s", { n: s0 }), s0 != null && s1 != null ? delta(s0, s1, function(d) { return t("unit.s", { n: d }); }, false) : delta(0, null))
  ];
  if (futureDue && futureDue.days) {
    var buckets = futureDueBuckets(futureDue);
    var total = buckets.reduce(function(s, b) { return s + b.cnt; }, 0);
    var busiest = buckets.reduce(function(m, b) { return b.cnt > m.cnt ? b : m; }, buckets[0]);
    out.push(kpi(t("chart.kpiDue", { n: futureDue.windowDays }), total.toLocaleString(),
      total ? escHtml(t("chart.busiest", { n: busiest.cnt, when: busiest.n === 0 ? t("time.today").toLowerCase() : t("time.inDays", { n: busiest.n }) })) : ''));
  }
  return out.join('');
}

// Everything in Study charts that comes from /analytics, drawn together so the first load
// and a period change cannot drift apart. The forecast and intervals have their own fetches.
function renderStudyCharts(analytics) {
  state.dashAnalytics = analytics;
  var days = analytics.days || state.dashPeriod || 60;
  var weeksBack = Math.floor((days - 1) / 7);
  var heatmapTitle = document.getElementById("dash-heatmap-title");
  if (heatmapTitle) heatmapTitle.textContent = t("dashboard.heatmapTitle", { n: days });
  renderHeatmap(analytics.heatmap, document.getElementById("dash-heatmap-wrap"), days);
  renderWeeklyTrend(analytics.weeklyTrend, document.getElementById("dash-trend-wrap"), weeksBack);
  renderNewCardsTrend(analytics.newCardsWeeklyTrend, document.getElementById("dash-newcards-trend-wrap"), weeksBack);
  renderRetentionTrend(analytics.weeklyTrend.map(function(r) { return { weeks_ago: r.weeks_ago, total: r.cnt, correct: r.correct }; }),
    document.getElementById("dash-retention-wrap"), weeksBack);
  renderGradeDistribution(analytics.gradeDistribution, document.getElementById("dash-grade-wrap"));
  renderReviewTimeTrend(analytics.reviewTimeTrend, document.getElementById("dash-reviewtime-wrap"), weeksBack);
  var kpis = document.getElementById("dash-chart-kpis");
  if (kpis) kpis.innerHTML = chartKpisHtml(analytics, state.dashFutureDue);
  var trend = document.getElementById("dash-trend-wrap");
  state.dashChartWidth = trend ? trend.clientWidth : 0;
}

function renderGradeDistribution(rows, wrap) {
  if (!wrap) return;
  var segs = gradeSegments(rows);
  var total = segs.reduce(function(sum, s) { return sum + s.cnt; }, 0);
  if (!total) {
    wrap.innerHTML = '<div class="dash-empty-note">' + t("dashboard.noReviewGrades") + '</div>';
    return;
  }
  wrap.innerHTML = '<div class="chart-stack" role="img" aria-label="' + escHtml(t("chart.howYouAnswered")) + '">' +
    segs.map(function(s) {
      return '<div class="chart-stack-seg grade-' + s.cls + '" style="flex:' + s.cnt + '" title="' + escHtml(s.label + ": " + s.cnt) + '"></div>';
    }).join('') + '</div>' +
    '<div class="chart-legend">' + segs.map(function(s) {
      return '<span><i class="grade-' + s.cls + '"></i>' + escHtml(s.label) + ' · ' + s.cnt.toLocaleString() +
        ' (' + Math.round(s.cnt / total * 100) + '%)</span>';
    }).join('') + '</div>';
}

function renderReviewTimeTrend(rows, wrap, maxWeeksAgo) {
  if (!wrap) return;
  var map = {};
  (rows || []).forEach(function(r) { map[r.weeks_ago] = r; });
  var weeks = chartWeeks(maxWeeksAgo);
  var secs = weeks.map(function(w) { var r = map[w]; return r && r.samples > 0 ? Math.round(r.avg_ms / 1000) : null; });
  var known = secs.filter(function(s) { return s != null; });
  if (!known.length) {
    wrap.innerHTML = '<div class="dash-empty-note">' + t("dashboard.noReviewTime") + '</div>';
    return;
  }
  var lo = Math.max(0, Math.floor(Math.min.apply(null, known) / 10) * 10);
  var hi = Math.ceil(Math.max.apply(null, known) / 10) * 10;
  if (hi <= lo) hi = lo + 10;
  wrap.innerHTML = chartLineSvg({
    width: chartWidth(wrap), labels: weeks.map(chartWeekLabel), values: secs, min: lo, max: hi, cls: "time",
    ticks: [lo, (lo + hi) / 2, hi], fmt: function(v) { return t("unit.s", { n: Math.round(v) }); },
    titles: weeks.map(function(w, i) {
      return chartWeekTitle(w) + ": " + (map[w] && map[w].samples > 0 ? t("dashboard.avgReviewDuration", { duration: t("unit.s", { n: secs[i] }), n: map[w].samples }) : "—");
    })
  });
}

function renderHeatmap(rows, wrap, days) {
  if (!days) days = 60;
  if (!rows.length) {
    wrap.innerHTML = '<div class="dash-empty-note">' + t("dashboard.noStudyData") + '</div>';
    return;
  }
  var map = {};
  var msMap = {};
  rows.forEach(function(r) { map[r.day] = r.cnt; msMap[r.day] = r.ms || 0; });

  var today = new Date();
  var cells = [];
  for (var i = days - 1; i >= 0; i--) {
    // Use UTC date arithmetic to match server's date(created_at,'unixepoch') which returns UTC dates
    var d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    var key = d.toISOString().slice(0, 10);
    cells.push({ key: key, cnt: map[key] || 0, ms: msMap[key] || 0, month: d.getUTCMonth(), day: d.getUTCDate(), dayOfWeek: d.getUTCDay() });
  }

  var maxCnt = rows.reduce(function(m, r) { return Math.max(m, r.cnt); }, 1);
  function intensity(cnt) {
    if (cnt === 0) return "heat-0";
    if (cnt <= maxCnt * 0.25) return "heat-1";
    if (cnt <= maxCnt * 0.60) return "heat-2";
    return "heat-3";
  }

  var MONTHS = t("dashboard.monthAbbrevs").split(",");
  var DAYS = t("dashboard.dayAbbrevs").split(",");
  var padded = [];
  for (var p = 0; p < cells[0].dayOfWeek; p++) padded.push(null);
  padded = padded.concat(cells);
  while (padded.length % 7 !== 0) padded.push(null);
  var numCols = padded.length / 7;

  // One grid, day names in the first column, so the cells can grow to fill the card (up to
  // 22px) and every row label still lines up with its row whatever the cell size.
  var html = '<div class="heatmap" style="grid-template-columns:auto repeat(' + numCols + ', minmax(0, 22px))"><span></span>';
  var lastMonth = null;
  for (var col = 0; col < numCols; col++) {
    var first = null;
    for (var r = 0; r < 7 && !first; r++) first = padded[col * 7 + r];
    var label = first && first.month !== lastMonth ? MONTHS[first.month] : "";
    if (first) lastMonth = first.month;
    html += '<span class="heatmap-month-label">' + escHtml(label) + '</span>';
  }
  for (var row = 0; row < 7; row++) {
    html += '<span class="heatmap-day-label">' + (row % 2 ? escHtml(DAYS[row]) : "") + '</span>';
    for (var c = 0; c < numCols; c++) {
      var cell = padded[c * 7 + row];
      html += cell
        ? '<i class="heatmap-cell ' + intensity(cell.cnt) + '" title="' + escHtml(t("dashboard.heatmapCellTooltip", {
            date: MONTHS[cell.month] + " " + cell.day, duration: formatStudyDuration(cell.ms), n: cell.cnt })) + '"></i>'
        : '<i class="heatmap-cell heat-empty"></i>';
    }
  }
  wrap.innerHTML = html + '</div>';
}

function renderWeeklyTrend(rows, wrap, maxWeeksAgo) {
  if (maxWeeksAgo === undefined) maxWeeksAgo = 11;
  if (!rows.length) {
    wrap.innerHTML = '<div class="dash-empty-note">' + t("dashboard.noStudyData") + '</div>';
    return;
  }
  var map = {};
  rows.forEach(function(r) { map[r.weeks_ago] = r; });
  var weeks = chartWeeks(maxWeeksAgo);
  wrap.innerHTML = chartColumnsSvg({
    width: chartWidth(wrap), labels: weeks.map(chartWeekLabel), cls: "answers", hot: weeks.length - 1,
    values: weeks.map(function(w) { return map[w] ? map[w].cnt : 0; }),
    titles: weeks.map(function(w) {
      var r = map[w];
      return chartWeekTitle(w) + ": " + (r ? t("chart.answersTitle", { n: r.cnt, pct: Math.round((r.correct || 0) / r.cnt * 100) }) : "0");
    })
  });
}

function renderNewCardsTrend(rows, wrap, maxWeeksAgo) {
  if (maxWeeksAgo === undefined) maxWeeksAgo = 11;
  if (!rows.length) {
    wrap.innerHTML = '<div class="dash-empty-note">' + t("dashboard.noStudyData") + '</div>';
    return;
  }
  var map = {};
  rows.forEach(function(r) { map[r.weeks_ago] = r.cnt; });
  var weeks = chartWeeks(maxWeeksAgo);
  wrap.innerHTML = chartColumnsSvg({
    width: chartWidth(wrap), labels: weeks.map(chartWeekLabel), cls: "new", hot: weeks.length - 1,
    values: weeks.map(function(w) { return map[w] || 0; }),
    titles: weeks.map(function(w) { return chartWeekTitle(w) + ": " + (map[w] || 0); })
  });
}

// Generic seconds → short duration string, replacing the old fixed-step lookup table now
// that FSRS produces a continuous interval rather than an index into a fixed ladder.
function formatFsrsDuration(seconds) {
  if (seconds == null) return "";
  if (seconds < 60) return t("unit.lessThanMin");
  if (seconds < 3600) return t("unit.min", { n: Math.round(seconds / 60) });
  if (seconds < 86400) return t("unit.h", { n: Math.round(seconds / 3600) });
  var days = Math.round(seconds / 86400);
  if (days < 30) return t("unit.d", { n: days });
  if (days < 365) return t("unit.mo", { n: Math.round(days / 30) });
  return t("unit.y", { n: Math.round(days / 365) });
}

// Same perceptual bucket boundaries the old step ladder used, so the distribution chart's
// shape stays familiar even though the underlying scheduler is now continuous. "learning"
// (FSRS Learning/Relearning state) is a distinct bucket, not a duration — sorted first.
var FSRS_BUCKET_ORDER = ["learning","b_10m","b_1h","b_4h","b_1d","b_3d","b_7d","b_21d","b_42d","b_84d","b_168d","b_336d","b_1yr"];
var FSRS_BUCKET_LABELS = {
  learning: null, // resolved via t("srsBucket.learning") at render time (locale-aware)
  b_10m: ["min", 10], b_1h: ["h", 1], b_4h: ["h", 4], b_1d: ["d", 1], b_3d: ["d", 3], b_7d: ["d", 7],
  b_21d: ["d", 21], b_42d: ["d", 42], b_84d: ["d", 84], b_168d: ["d", 168], b_336d: ["d", 336], b_1yr: ["y", 1]
};

function renderSrsDistribution(rows, wrap) {
  if (!rows || !rows.length) {
    wrap.innerHTML = '<div class="dash-empty-note">' + t("dashboard.noCardsInSrs") + '</div>';
    return;
  }
  var sorted = rows.slice().sort(function(a, b) {
    return FSRS_BUCKET_ORDER.indexOf(a.bucket) - FSRS_BUCKET_ORDER.indexOf(b.bucket);
  });
  var total = sorted.reduce(function(s, r) { return s + r.cnt; }, 0);
  var labels = sorted.map(function(r) {
    var unit = FSRS_BUCKET_LABELS[r.bucket];
    return r.bucket === "learning" ? t("srsBucket.learning") : unit ? t("unit." + unit[0], { n: unit[1] }) : r.bucket;
  });
  wrap.innerHTML = chartColumnsSvg({
    width: chartWidth(wrap), labels: labels, cls: "srs", values: sorted.map(function(r) { return r.cnt; }),
    titles: sorted.map(function(r, i) { return labels[i] + ": " + r.cnt; })
  }) + '<div class="srs-total-note">' + escHtml(t("dashboard.cardsInSrs", { n: total })) + '</div>';
}

function renderFutureDue(data, wrap) {
  if (!data || !data.days) return;
  var buckets = futureDueBuckets(data);
  if (buckets.every(function(b) { return b.cnt === 0; })) {
    wrap.innerHTML = '<div class="dash-empty-note">' + t("dashboard.noCardsDueSoon", { n: data.windowDays }) + '</div>';
    return;
  }
  wrap.innerHTML = chartColumnsSvg({
    width: chartWidth(wrap), cls: "due", hot: 0,
    labels: buckets.map(function(b) { return b.n === 0 ? t("time.today") : t("chart.dayShort", { n: b.n }); }),
    values: buckets.map(function(b) { return b.cnt; }),
    titles: buckets.map(function(b) { return (b.n === 0 ? t("dashboard.futureDueTodayHint") : t("time.inDays", { n: b.n })) + ": " + b.cnt; })
  });
}

// Lesson/class-scoped weekly accuracy trend (Stats screen) — same trend-row visual
// language as renderWeeklyTrend/renderSrsDistribution, but bar width = accuracy %.
function renderAccuracyTrend(rows, wrap, maxWeeksAgo) {
  if (maxWeeksAgo === undefined) maxWeeksAgo = 7;
  var map = {};
  rows.forEach(function(r) { map[r.weeks_ago] = { total: r.total, correct: r.correct || 0 }; });

  var weeks = [];
  for (var w = maxWeeksAgo; w >= 0; w--) {
    var wk = map[w] || { total: 0, correct: 0 };
    weeks.push({ weeksAgo: w, total: wk.total, correct: wk.correct });
  }

  if (!weeks.some(function(wk) { return wk.total > 0; })) {
    wrap.innerHTML = '<div class="dash-empty-note">' + t("stats.noAttemptedCards") + '</div>';
    return;
  }

  wrap.innerHTML = "";
  weeks.forEach(function(week) {
    var pct = week.total > 0 ? Math.round(week.correct / week.total * 100) : 0;
    var label = week.weeksAgo === 0 ? t("dashboard.thisWeek") :
                week.weeksAgo === 1 ? t("dashboard.lastWeek") :
                t("time.weeksAgo", { n: week.weeksAgo });
    var rowEl = document.createElement("div");
    rowEl.className = "trend-row";
    rowEl.innerHTML =
      '<span class="trend-label">' + escHtml(label) + '</span>' +
      '<div class="trend-bar-track"><div class="trend-bar-fill" style="transform:' + scaleXStyle(pct / 100) + '"></div></div>' +
      '<span class="trend-count">' + (week.total > 0 ? week.correct + "/" + week.total : "—") + '</span>';
    wrap.appendChild(rowEl);
  });
}

document.getElementById("btn-dashboard-export").addEventListener("click", function() {
  window.location.href = "/api/stats/analytics/export";
});

/* ============================
   BULK LESSON + CARD IMPORT
   ============================ */

function parseBulkImport(raw, rejected) {
  var sections = [];
  var current = null;
  raw.split("\n").forEach(function(line, i) {
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
      current.lines.push({ text: trimmed, n: i + 1 });
    } else {
      rejectBulkLine(rejected, i, "bulk.errNoLesson");
    }
  });
  return sections.map(function(s) {
    var text = s.lines.map(function(l) { return l.text; }).join("\n");
    var local = [];
    var cards = s.format === "term-def" ? parseBulkTermDef(text, local)
      : s.format === "true-false" ? parseBulkTF(text, local)
      : parseBulkMCQ(text, local);
    // The section parser numbers lines within the section; map back to the pasted text.
    if (rejected) local.forEach(function(r) { rejected.push({ line: s.lines[r.line - 1].n, reason: r.reason }); });
    return { title: s.title, format: s.format, cards: cards };
  }).filter(function(s) { return s.title; });
}

function renderBulkImportPreview(raw) {
  var preview = document.getElementById("bulk-import-preview");
  preview.innerHTML = "";
  var rejected = [];
  var sections = parseBulkImport(raw, rejected);
  if (sections.length === 0) { renderBulkRejected(preview, rejected); return; }

  sections.forEach(function(section) {
    var block = document.createElement("div");
    block.className = "bi-lesson-block";

    var header = document.createElement("div");
    header.className = "bi-lesson-header";
    var badge = '<span class="format-badge ' + section.format + '" style="margin-left:6px">' + formatLabel(section.format) + '</span>';
    header.innerHTML = escHtml(section.title) + badge +
      '<span class="bi-lesson-count">' + t("count.cards", { n: section.cards.length }) + '</span>';
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
      more.textContent = t("bulk.andMore", { n: section.cards.length - 3 });
      block.appendChild(more);
    }
    preview.appendChild(block);
  });

  var total = sections.reduce(function(n, s) { return n + s.cards.length; }, 0);
  var summary = document.createElement("div");
  summary.className = "bulk-preview-count";
  summary.textContent = t("bulk.summary", { lessons: t("count.lessons", { n: sections.length }), cards: t("count.cards", { n: total }) });
  preview.insertBefore(summary, preview.firstChild);
  renderBulkRejected(preview, rejected);
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
- Keep stems and options under ~25 words — split a compound condition ("X and Y") into separate cards rather than packing it into one stem.
- Restate the concept name in the stem instead of pronouns like "it" or "this" — a card must stand alone without the source text in view.
- Use one term per concept throughout a lesson; do not alternate between synonyms for the same thing across cards.
- Prefer simple present tense and active voice in stems that describe a mechanism or process.
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
  showLayer(document.getElementById("modal-prompt-guide"));
});

document.getElementById("btn-prompt-guide-close").addEventListener("click", function() {
  hideLayer(document.getElementById("modal-prompt-guide"));
});

document.getElementById("modal-prompt-guide").addEventListener("click", function(e) {
  if (e.target === this) hideLayer(this);
});

// Shared by every "flash a confirmation on this button, then revert" moment (copy prompt,
// copy share link, update preset) — three independent copies of this exact shape had drifted
// (one used textContent for the revert instead of innerHTML, delays ranged 1500-2000ms)
// before being collapsed into this one place.
function flashButtonFeedback(btn, flashHtml, revertHtml, delayMs) {
  btn.innerHTML = flashHtml;
  setTimeout(function() { btn.innerHTML = revertHtml; }, delayMs);
}

document.getElementById("btn-copy-prompt").addEventListener("click", function() {
  navigator.clipboard.writeText(AI_EXTRACTION_PROMPT).then(function() {
    var btn = document.getElementById("btn-copy-prompt");
    flashButtonFeedback(btn, ICON_CHECK + " " + t("common.copied"), ICON_COPY + " " + t("promptGuide.copyPrompt"), 2000);
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
  if (sections.length === 0) { showFieldError(document.getElementById("bulk-import-input"), t("validate.noLessonsFound")); return; }

  var classId = state.currentClass.id;
  var cardTotal = sections.reduce(function(n, s) { return n + s.cards.length; }, 0);
  // Create lessons sequentially, then their cards
  withBusy(this, function() { return sections.reduce(function(chain, section) {
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
    showToast(t("toast.lessonsImported", { lessons: t("count.lessons", { n: sections.length }), cards: t("count.cards", { n: cardTotal }) }));
  }); });
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

var HAPTIC_PATTERNS = {
  tick:     10,
  select:   18,
  success:  24,
  warn:     30,
  error:    [12, 70, 12],
  danger:   [24, 50, 24],
  complete: [18, 60, 18, 60, 36]
};

// Android only in practice: iOS Safari exposes no Vibration API at all, and desktop browsers
// that do expose it have no vibrator — both end up a no-op, so no pointer/mobile gate on top.
function haptic(name) {
  if (!state.haptics || !navigator.vibrate) return;
  var pattern = HAPTIC_PATTERNS[name];
  if (!pattern) return;
  // Spec'd to return false rather than throw, but it fronts per-OEM Android implementations
  // and a user-activation rule — feedback must never break the interaction that caused it.
  try { navigator.vibrate(pattern); } catch (_) {}
}

// Answer sounds: the Marimba set the user picked from five previews. Synthesized with Web
// Audio, so there is nothing to download and nothing to cache offline. Only answers the app
// checks get a sound (quiz options, the retype drill); a self-grade on a flashcard is the
// user's own judgement, and a "wrong" sound on it would read as the app disagreeing.
var soundCtx = null;
var SOUND_VOLUME = 0.6;

function soundContext() {
  if (!soundCtx) {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    // Safari 17+: "ambient" makes Web Audio obey the iPhone's silent switch, like other
    // interface sounds. Older iOS has no audioSession and plays through silent mode.
    try { if (navigator.audioSession) navigator.audioSession.type = "ambient"; } catch (_) {}
    soundCtx = new Ctx();
  }
  if (soundCtx.state === "suspended") soundCtx.resume().catch(function() {});
  return soundCtx;
}

function soundTone(c, freq, start, dur, gain, attack) {
  var t0 = c.currentTime + start;
  var o = c.createOscillator(), g = c.createGain();
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain * SOUND_VOLUME, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(c.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

// Each mallet strike is a short fundamental plus a faint, very short fourth harmonic: the
// harmonic is the "wood" click.
function soundStrike(c, f, start) {
  soundTone(c, f, start, 0.25, 0.3, 0.003);
  soundTone(c, f * 4, start, 0.06, 0.06, 0.002);
}

// step = right answers in a row before this one. Each raises the pair a whole tone, so a run
// is heard climbing; capped at six steps (an octave less a tone) before it turns shrill.
var SOUNDS = {
  correct: function(c, step) {
    var k = Math.pow(2, Math.min(Math.max(step || 0, 0), 6) * 2 / 12);
    [523.25, 659.25].forEach(function(f, i) { soundStrike(c, f * k, i * 0.08); });
  },
  combo: function(c) {
    [523.25, 659.25, 783.99, 1046.5].forEach(function(f, i) { soundStrike(c, f, i * 0.07); });
  },
  wrong: function(c) {
    soundTone(c, 196, 0, 0.22, 0.35, 0.003);
    soundTone(c, 784, 0, 0.04, 0.05, 0.002);
  }
};

function playSound(name, step) {
  if (!state.sounds || !SOUNDS[name]) return;
  // Like haptic(): feedback must never break the answer that triggered it.
  try {
    var c = soundContext();
    if (c) SOUNDS[name](c, step);
  } catch (_) {}
}

function relativeTime(unixSec) {
  if (!unixSec) return t("time.never");
  var diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60)          return t("time.justNow");
  if (diff < 3600)        return t("time.minutesAgo", { n: Math.floor(diff / 60) });
  if (diff < 86400)       return t("time.hoursAgo", { n: Math.floor(diff / 3600) });
  if (diff < 7 * 86400)   return t("time.daysAgo", { n: Math.floor(diff / 86400) });
  return t("time.weeksAgo", { n: Math.floor(diff / (7 * 86400)) });
}

function futureRelativeTime(unixSec) {
  if (!unixSec) return t("time.notScheduled");
  var diff = unixSec - Math.floor(Date.now() / 1000);
  if (diff <= 0)    return t("time.now");
  if (diff < 3600)  return t("time.inMinutes", { n: Math.floor(diff / 60) });
  if (diff < 86400) return t("time.inHours", { n: Math.floor(diff / 3600) });
  return t("time.inDays", { n: Math.floor(diff / 86400) });
}

/* ============================
   SERVER ADAPTER (Phase 2)
   ============================ */

var SQLiteAdapter = (function() {
  var BASE = "/api";

  function req(method, path, body, timeoutMs) {
    var opts = { method: method, credentials: "same-origin", headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    if (timeoutMs) {
      var controller = new AbortController();
      opts.signal = controller.signal;
      setTimeout(function() { controller.abort(); }, timeoutMs);
    }
    // No status on this error, so the offline queue still treats it as retryable.
    return fetch(BASE + path, opts).catch(function() {
      throw new Error(t("common.networkError"));
    }).then(function(r) {
      if (r.status === 401) {
        showAuthScreen();
        var authErr = new Error("Unauthorized");
        authErr.status = 401;
        return Promise.reject(authErr);
      }
      if (r.status === 204) return null;
      // A proxy error page (e.g. a 502) is HTML, not JSON — keep the status. A 200 that isn't
      // JSON (a captive portal) still fails, so it can't pass for a saved write.
      return r.json().catch(function(parseErr) {
        if (r.ok) throw parseErr;
        return {};
      }).then(function(data) {
        if (!r.ok) {
          var err = new Error(serverError(data, t("error.requestFailed", { status: r.status })));
          err.status = r.status;
          err.code = data.code;
          return Promise.reject(err);
        }
        return data;
      });
    });
  }

  // Answers and known-state writes that couldn't reach the server (offline, a dropped
  // connection, a gateway error, an expired session) are kept per user in localStorage and
  // replayed in order — otherwise a grade on flaky mobile data is silently lost and the SRS
  // schedule drifts. Every such write goes through one promise chain so a replay and a new
  // answer can never interleave. Replayed answers are scheduled at replay time.
  var writeChain = Promise.resolve();
  var offlineNotified = false;
  // A hung request would otherwise hold every later answer in memory only, lost on reload.
  var WRITE_TIMEOUT_MS = 15000;
  // A 500 is usually a brief server hiccup, but one that repeats must not block the queue.
  var MAX_SERVER_ERROR_TRIES = 5;

  function pendingKey() {
    return "fc-pending-writes:" + (currentUser && currentUser.id ? currentUser.id : "");
  }

  function readPending(key) {
    try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch (_) { return []; }
  }

  function keepForRetry(err) {
    return !err.status || [401, 408, 429, 500, 502, 503, 504].indexOf(err.status) !== -1;
  }

  function enqueue(key, item) {
    var list = readPending(key);
    list.push(item);
    localStorage.setItem(key, JSON.stringify(list));
    if (!offlineNotified) {
      offlineNotified = true;
      showToast(t("toast.offlineQueued"));
    }
    return { queued: true };
  }

  // Sends queued writes oldest first; resolves true once the queue is empty, false if it
  // stopped at a write that should be retried later.
  function drain(key, synced, processed) {
    synced = synced || 0;
    processed = processed || 0;
    var list = readPending(key);
    if (!list.length) {
      if (processed) offlineNotified = false;
      if (synced) showToast(t("toast.synced", { n: synced }));
      return Promise.resolve(true);
    }
    var item = list[0];
    return req(item.method, item.path, item.body, WRITE_TIMEOUT_MS).then(function() { return "sent"; }, function(err) {
      if (!keepForRetry(err)) return "dropped";
      if (err.status !== 500) return "keep";
      item.serverErrors = (item.serverErrors || 0) + 1;
      return item.serverErrors >= MAX_SERVER_ERROR_TRIES ? "dropped" : "retry-later";
    }).then(function(outcome) {
      var current = readPending(key);
      var isHead = current.length && current[0].body && item.body &&
        JSON.stringify(current[0].path) === JSON.stringify(item.path) &&
        JSON.stringify(current[0].body) === JSON.stringify(item.body);
      if (outcome === "keep") return false;
      if (outcome === "retry-later") {
        if (isHead) {
          current[0].serverErrors = item.serverErrors;
          try { localStorage.setItem(key, JSON.stringify(current)); } catch (_) {}
        }
        return false;
      }
      if (isHead) {
        current.shift();
        try { localStorage.setItem(key, JSON.stringify(current)); } catch (_) {}
      }
      return drain(key, synced + (outcome === "sent" && item.path === "/attempts" ? 1 : 0), processed + 1);
    });
  }

  function queuedWrite(item) {
    // Chosen now: a 401 signs the user out (currentUser = null) before the failure comes back.
    var key = pendingKey();
    var run = writeChain.then(function() { return drain(key); }).then(function(emptied) {
      if (!emptied) return enqueue(key, item);
      return req(item.method, item.path, item.body, WRITE_TIMEOUT_MS).catch(function(err) {
        if (keepForRetry(err)) return enqueue(key, item);
        throw err;
      });
    });
    writeChain = run.catch(function() {});
    return run;
  }

  function flushPending() {
    if (!currentUser) return;
    var key = pendingKey();
    writeChain = writeChain.then(function() { return drain(key); }).catch(function() {});
  }

  function newClientId() {
    var id = "";
    while (id.length < 20) id += Math.random().toString(36).slice(2);
    return "c" + id.slice(0, 20);
  }

  return {
    getClasses:  function()     { return req("GET",    "/classes"); },
    getClass:    function(id)   { return req("GET",    "/classes/" + id); },
    createClass: function(f)    { return req("POST",   "/classes", f); },
    updateClass: function(id,f) { return req("PUT",    "/classes/" + id, f); },
    deleteClass: function(id)   { return req("DELETE", "/classes/" + id); },
    suggestClassTags: function(id) { return req("POST", "/classes/" + id + "/suggest-tags"); },
    translateText: function(text, language) { return req("POST", "/translation", { text: text, language: language }); },
    saveVocabulary: function(payload) { return req("POST", "/vocabulary", payload); },
    getVocabularyRequests: function() { return req("GET", "/vocabulary"); },
    deleteVocabularyRequest: function(id) { return req("DELETE", "/vocabulary/" + encodeURIComponent(id)); },
    importFlashcards: function(payload) { return req("POST", "/import/flashcards", payload); },

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
      var body = { cardId: f.cardId, correct: f.correct, source: f.source, clientId: f.clientId || newClientId() };
      if (f.grade) body.grade = f.grade;
      if (f.durationMs != null) body.durationMs = f.durationMs;
      if (f.typed) body.typed = true;
      return queuedWrite({ method: "POST", path: "/attempts", body: body });
    },
    // Queued behind the answer it undoes, so offline the two replay in order. The empty body
    // matters: drain() matches a queued item by path and body.
    undoAttempt: function(id) {
      return queuedWrite({ method: "DELETE", path: "/attempts/" + encodeURIComponent(id), body: {} });
    },
    newClientId: newClientId,
    flushPending: flushPending,
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
      if (opts.sort) qs += "&sort=" + opts.sort;
      return req("GET", "/stats/hardest?" + qs);
    },

    setCardKnown: function(cardId, known) {
      return queuedWrite({ method: "PUT", path: "/cards/states/" + cardId, body: { known: known } });
    },
    getKnownMap: function(lessonId) {
      return req("GET", "/lessons/" + lessonId + "/states");
    },

    getProgress: function(type, id) { return req("GET", "/stats/progress/" + type + "/" + id); },
    getDashboard: function(days) { return req("GET", "/stats/dashboard" + (days ? "?days=" + days : "")); },
    getAnalytics: function(days) { return req("GET", "/stats/analytics?days=" + (days || 60)); },
    getCardHistory: function(cardId) { return req("GET", "/stats/card-history/" + encodeURIComponent(cardId)); },
    getSrsDistribution: function(days) { return req("GET", "/stats/srs-distribution" + (days ? "?days=" + days : "")); },
    getFutureDue: function() { return req("GET", "/stats/future-due"); },
    getAchievements: function() { return req("GET", "/achievements"); },
    recordStudyEvent: function(kind, ref) { return req("POST", "/achievements/events", { kind: kind, ref: ref }); },
    getToday: function() { return req("GET", "/stats/today"); },
    writesSettled: function() { return writeChain; },
    getReviewsToday: function() { return req("GET", "/stats/reviews-today"); },
    getNewCardEstimate: function() { return req("GET", "/stats/new-card-estimate"); },
    getTrend: function(type, id) { return req("GET", "/stats/trend?scope=" + type + "&id=" + id); },
    getClassAccuracy: function() { return req("GET", "/stats/accuracy/classes"); },
    getLessonAccuracy: function(classId) { return req("GET", "/stats/accuracy/lessons?classId=" + classId); },

    acknowledgeCardUpdate: function(id) { return req("POST", "/cards/" + id + "/acknowledge-update"); },
    // The server caps each request at 1000 ids, so larger selections go in sequential batches.
    acknowledgeCardUpdates: function(ids) {
      var p = Promise.resolve();
      for (var i = 0; i < ids.length; i += 1000) {
        (function(chunk) {
          p = p.then(function() { return req("POST", "/cards/acknowledge-updates", { cardIds: chunk }); });
        })(ids.slice(i, i + 1000));
      }
      return p;
    },
    getUpstreamChanges: function() { return req("GET", "/upstream-changes"); },
    listApiTokens:  function()     { return req("GET",    "/tokens"); },
    createApiToken: function(name) { return req("POST",   "/tokens", { name: name }); },
    revokeApiToken: function(id)   { return req("DELETE", "/tokens/" + id); },

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
    if (open) return;
    menu.classList.remove("hidden");
    // Menus hang right-aligned from their button; on a phone the header wraps its actions to
    // the left edge, which pushes the menu off-screen, so flip it to left-aligned there.
    menu.style.left = menu.style.right = "";
    if (menu.getBoundingClientRect().left < 8) {
      menu.style.left = "0";
      menu.style.right = "auto";
    }
  });
}

function closeAllDropdowns() {
  document.querySelectorAll(".dropdown-menu").forEach(function(m) { m.classList.add("hidden"); });
}

document.addEventListener("click", closeAllDropdowns);

registerDropdown("btn-class-menu",  "class-dropdown-menu");
registerDropdown("btn-lesson-menu", "lesson-dropdown-menu");
registerDropdown("btn-user-menu",   "user-dropdown-menu");

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
  syncThemeColor();
}

// The browser bar takes the page background, which now depends on both palette and mode.
function syncThemeColor() {
  var bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (bg) document.querySelector('meta[name="theme-color"]').content = bg;
}

// Palette is independent of light/dark: each one defines both modes in style.css.
// "parchment" is the default and has no attribute, so an unknown stored value falls back to it.
var PALETTES = ["parchment", "sage", "slate", "sepia", "plum", "harbour", "serika", "nord", "gruvbox", "solarized", "catppuccin", "rosepine", "everforest", "tokyonight", "dracula"];

function paletteFromPrefs(prefs) {
  return PALETTES.indexOf(prefs.palette) >= 0 ? prefs.palette : "parchment";
}

function applyPalette(palette) {
  state.palette = PALETTES.indexOf(palette) >= 0 ? palette : "parchment";
  if (state.palette === "parchment") document.documentElement.removeAttribute("data-palette");
  else document.documentElement.setAttribute("data-palette", state.palette);
  syncThemeColor();
}

// Off by default, following Material/Apple/GitHub: the plain dark theme is muted and the
// neon set is opt-in. The attribute is harmless in light mode; style.css only reads it
// alongside data-theme="dark".
function applyContrast(high) {
  state.highContrast = high === true;
  if (state.highContrast) document.documentElement.setAttribute("data-contrast", "high");
  else document.documentElement.removeAttribute("data-contrast");
}

function applyLanguage(lang) {
  var previousLanguage = state.language;
  state.language = (lang === "vi") ? "vi" : "en";
  if (previousLanguage && previousLanguage !== state.language) clearFlashcardTranslation();
  document.documentElement.setAttribute("lang", state.language);
  applyI18n();
  if (typeof renderTutorialStep === "function" && !document.getElementById("modal-tutorial").classList.contains("hidden")) renderTutorialStep();
  // Static chrome updates everywhere via applyI18n(); refresh the most
  // commonly-visible dynamic list (home) so it doesn't show stale text
  // until the next navigation re-renders it anyway.
  if (state.homeClasses && state.homeClasses.length && document.getElementById("screen-home").classList.contains("active")) {
    renderHome();
  }
}

var TTS_RATE_MIN = 0.5, TTS_RATE_MAX = 1.5, TTS_RATE_STEP = 0.1;
var FONT_SCALE_MIN = 0.7, FONT_SCALE_MAX = 1.5, FONT_SCALE_STEP = 0.1;
function applyFontScale(scale) {
  scale = Math.round(Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, scale)) * 10) / 10;
  state.fontScale = scale;
  document.documentElement.style.setProperty("--font-scale", scale);
}

// theme is "light", "dark" or "system" (follow the phone/OS). Older accounts only have the
// darkMode boolean, and every Preferences save used to write it, so a stored false doesn't
// mean the user chose light; only true is read as a choice.
var systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function themeFromPrefs(prefs) {
  if (prefs.theme === "light" || prefs.theme === "dark" || prefs.theme === "system") return prefs.theme;
  return prefs.darkMode === true ? "dark" : "system";
}

function applyThemePref(theme) {
  state.themePref = theme;
  applyDarkMode(theme === "dark" || (theme === "system" && systemDark.matches));
}

function onSystemThemeChange() {
  if (state.themePref === "system") applyDarkMode(systemDark.matches);
}
// Safari before 14 only has the older addListener.
if (systemDark.addEventListener) systemDark.addEventListener("change", onSystemThemeChange);
else systemDark.addListener(onSystemThemeChange);

function applyPrefs(prefs) {
  applyPalette(paletteFromPrefs(prefs));
  applyContrast(prefs.highContrast);
  applyThemePref(themeFromPrefs(prefs));
  if (typeof prefs.sounds === "boolean") {
    state.sounds = prefs.sounds;
  }
  if (typeof prefs.haptics === "boolean") {
    state.haptics = prefs.haptics;
  }
  if (typeof prefs.fontScale === "number") {
    applyFontScale(prefs.fontScale);
  }
  if (typeof prefs.ttsRate === "number") {
    state.ttsRate = prefs.ttsRate;
  }
  if (typeof prefs.language === "string") {
    applyLanguage(prefs.language);
  }
  if (Array.isArray(prefs.studyPresets)) {
    state.studyPresets = prefs.studyPresets;
  }
  if (typeof prefs.maxReviewsPerDay === "number") {
    state.maxReviewsPerDay = prefs.maxReviewsPerDay;
  }
  if (typeof prefs.dailyGoal === "number") {
    state.dailyGoal = prefs.dailyGoal;
  }
  if (typeof prefs.quizCountsAsKnown === "boolean") {
    state.quizCountsAsKnown = prefs.quizCountsAsKnown;
  }
  if (prefs.dashMetricConfig && typeof prefs.dashMetricConfig === "object") {
    state.dashMetricConfig = Object.assign({}, DEFAULT_DASH_METRIC_CONFIG, prefs.dashMetricConfig);
  }
}

var _tutorialSteps = [
  { title: "tutorial.step1Title", body: "tutorial.step1Body" },
  { title: "tutorial.step2Title", body: "tutorial.step2Body" },
  { title: "tutorial.step3Title", body: "tutorial.step3Body" },
  { title: "tutorial.step4Title", body: "tutorial.step4Body" },
  { title: "tutorial.step5Title", body: "tutorial.step5Body" }
];
var _tutorialStep = 0;

function tutorialFallbackKey() {
  return "fc-tutorial-seen-" + (currentUser && currentUser.id ? currentUser.id : "");
}

function tutorialWasSeenLocally() {
  if (!currentUser || !currentUser.id) return false;
  try { return localStorage.getItem(tutorialFallbackKey()) === "1"; } catch (_) { return false; }
}

function markTutorialSeen() {
  if (!IS_SERVER || !currentUser) return;
  try { localStorage.setItem(tutorialFallbackKey(), "1"); } catch (_) {}
  var prefs = {};
  try { prefs = JSON.parse(localStorage.getItem("fc-preferences") || "{}"); } catch (_) {}
  prefs.tutorialCompleted = true;
  try { localStorage.setItem("fc-preferences", JSON.stringify(prefs)); } catch (_) {}
  return fetch("/api/auth/preferences", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tutorialCompleted: true })
  }).then(function(r) {
    if (!r.ok) return;
    try { localStorage.removeItem(tutorialFallbackKey()); } catch (_) {}
  }).catch(function() {});
}

function renderTutorialStep() {
  var step = _tutorialSteps[_tutorialStep];
  document.getElementById("tutorial-progress").textContent = t("tutorial.stepCount", {
    step: _tutorialStep + 1, total: _tutorialSteps.length
  });
  document.getElementById("tutorial-step-title").textContent = t(step.title);
  document.getElementById("tutorial-step-description").textContent = t(step.body);
  document.getElementById("tutorial-back").disabled = _tutorialStep === 0;
  var next = document.getElementById("tutorial-next");
  next.textContent = t(_tutorialStep === _tutorialSteps.length - 1 ? "tutorial.finish" : "tutorial.next");
  next.setAttribute("data-i18n", _tutorialStep === _tutorialSteps.length - 1 ? "tutorial.finish" : "tutorial.next");
}

function openTutorial() {
  _tutorialStep = 0;
  renderTutorialStep();
  openModal("tutorial");
  document.getElementById("tutorial-next").focus();
}

function closeTutorial() {
  closeModal("tutorial");
}

document.getElementById("tutorial-back").addEventListener("click", function() {
  if (_tutorialStep <= 0) return;
  _tutorialStep--;
  renderTutorialStep();
});
document.getElementById("tutorial-next").addEventListener("click", function() {
  if (_tutorialStep >= _tutorialSteps.length - 1) { closeTutorial(); return; }
  _tutorialStep++;
  renderTutorialStep();
});
document.getElementById("tutorial-skip").addEventListener("click", closeTutorial);
document.getElementById("btn-replay-tutorial").addEventListener("click", function() {
  closeModal("preferences");
  openTutorial();
});

function maybeShowFirstRunTutorial(prefs) {
  var cachedPrefs = {};
  try { cachedPrefs = JSON.parse(localStorage.getItem("fc-preferences") || "{}"); } catch (_) {}
  if (!IS_SERVER || !currentUser || !prefs || prefs.tutorialCompleted === true || cachedPrefs.tutorialCompleted === true || tutorialWasSeenLocally()) return;
  setTimeout(function() {
    if (!currentUser || (window.APP_CONFIG && window.APP_CONFIG.shareToken) || tutorialWasSeenLocally()) return;
    if (fcAnyOverlayOpen()) {
      setTimeout(function() { maybeShowFirstRunTutorial(prefs); }, 500);
      return;
    }
    openTutorial();
  }, 150);
}

function loadUserPreferences() {
  if (!IS_SERVER) return;
  // Apply cached prefs immediately so openSetup() sees the right value even before the fetch resolves
  try {
    var cached = localStorage.getItem("fc-preferences");
    if (cached) applyPrefs(JSON.parse(cached));
  } catch (_) {}
  fetch("/api/auth/preferences", { credentials: "same-origin" })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(new Error("Preferences unavailable")); })
    .then(function(prefs) {
      applyPrefs(prefs);
      try { localStorage.setItem("fc-preferences", JSON.stringify(prefs)); } catch (_) {}
      if (prefs.tutorialCompleted === true && currentUser && currentUser.id) {
        try { localStorage.removeItem(tutorialFallbackKey()); } catch (_) {}
      }
      maybeShowFirstRunTutorial(prefs);
    })
    .catch(function() {
      if (!tutorialWasSeenLocally()) maybeShowFirstRunTutorial({});
    });
}

function initUserNav() {
  var nav = document.getElementById("user-nav");
  if (!IS_SERVER || !currentUser) { nav.classList.add("hidden"); return; }
  nav.classList.remove("hidden");
  document.getElementById("user-name-display").textContent = currentUser.name;
  document.getElementById("user-dropdown-email").textContent = currentUser.email || "";
  var circle = document.getElementById("user-initial-circle");
  if (circle) circle.textContent = (currentUser.name || "?")[0].toUpperCase();
  // Sidebar items
  document.getElementById("sidebar-dashboard-link").classList.remove("hidden");
  document.getElementById("sidebar-achievements-link").classList.remove("hidden");
  document.getElementById("sidebar-upstream-link").classList.remove("hidden");
  document.getElementById("sidebar-vocabulary-link").classList.remove("hidden");
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
  refreshVocabularyQueue(false);
  refreshAchievements().catch(function() {});
  SQLiteAdapter.flushPending();
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
      '<span class="sidebar-class-icon">' + classIconHtml(cls.icon, 14) + '</span>' +
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
    openDashboard();
  });
  document.getElementById("sidebar-achievements-link").addEventListener("click", function() {
    closeSidebar();
    openAchievementsScreen();
  });
  document.getElementById("sidebar-upstream-link").addEventListener("click", function() {
    closeSidebar();
    openUpstreamScreen();
  });
  document.getElementById("sidebar-vocabulary-link").addEventListener("click", function() {
    closeSidebar();
    openVocabularyScreen();
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
    if (!res.ok) { showAuthError("login", serverError(res.d, t("auth.loginFailed"))); return; }
    currentUser = res.d;
    initUserNav();
    renderSharedWithMe();
    restoreLastScreen();
  }).catch(function() { showAuthError("login", t("common.networkError")); });
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
    if (!res.ok) { showAuthError("register", serverError(res.d, t("auth.registrationFailed"))); return; }
    currentUser = res.d;
    initUserNav();
    try { localStorage.removeItem("fc-last-screen"); } catch (_) {}
    renderSharedWithMe();
    restoreLastScreen();
  }).catch(function() { showAuthError("register", t("common.networkError")); });
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
  if (!email) { showAuthError("forgot", t("auth.enterEmail")); return; }
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
      successEl.textContent = t("auth.devResetLink", { url: d._devResetUrl });
    } else {
      successEl.textContent = t("auth.resetLinkSent");
    }
  }).catch(function() { showAuthError("forgot", t("common.networkError")); });
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
    if (pw.length < 6) { showAuthError("reset", t("auth.minCharsError")); return; }
    if (pw !== pw2)    { showAuthError("reset", t("auth.passwordsNoMatch")); return; }
    fetch("/api/auth/reset-password", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: resetToken, password: pw })
    }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); })
    .then(function(res) {
      if (!res.ok) { showAuthError("reset", serverError(res.d, t("auth.resetFailed"))); return; }
      currentUser = res.d;
      initUserNav();
      try { localStorage.removeItem("fc-last-screen"); } catch (_) {}
      renderSharedWithMe();
      history.replaceState({}, "", "/");
      restoreLastScreen();
    }).catch(function() { showAuthError("reset", t("common.networkError")); });
  });
})();

// Check URL params for Google auth errors/success
(function() {
  var params = new URLSearchParams(window.location.search);
  if (params.get("auth_error")) {
    var msgs = {
      google_cancelled: t("auth.googleCancelled"),
      google_failed: t("auth.googleFailed"),
      google_already_linked: t("auth.googleAlreadyLinked")
    };
    var msg = msgs[params.get("auth_error")] || t("auth.genericError");
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
  showToast(t("toast.signingOut"));
  fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
    .then(function() { showAuthScreen(); }, function() { showToast(t("common.networkError"), "error"); });
});

function prefFontLabel() {
  document.getElementById("pref-font-label").textContent = Math.round(state.fontScale * 100) + "%";
}

function prefRateLabel(rate) {
  var el = document.getElementById("pref-rate-label");
  el.textContent = rate.toFixed(1) + "x";
  el.dataset.rate = rate;
}

// Dark mode and text size preview live while Preferences is open; closing it any way other
// than Save puts back what was there when it opened.
var prefsSnapshot = null;

function revertPrefsPreview() {
  if (!prefsSnapshot) return;
  applyThemePref(prefsSnapshot.theme);
  applyPalette(prefsSnapshot.palette);
  applyContrast(prefsSnapshot.highContrast);
  applyFontScale(prefsSnapshot.fontScale);
  prefsSnapshot = null;
}

document.getElementById("btn-open-preferences").addEventListener("click", function() {
  closeAllDropdowns();
  prefsSnapshot = { theme: state.themePref, palette: state.palette, highContrast: state.highContrast, fontScale: state.fontScale };
  setPillGroup("pref-theme", state.themePref);
  setPillGroup("pref-daily-goal", String(state.dailyGoal));
  document.getElementById("pref-contrast").checked = state.highContrast;
  setPillGroup("pref-palette", state.palette);
  document.getElementById("pref-haptics").checked = state.haptics;
  document.getElementById("pref-sounds").checked = state.sounds;
  document.getElementById("pref-quiz-known").checked = state.quizCountsAsKnown;
  document.getElementById("pref-haptics-hint").classList.toggle("hidden", !!navigator.vibrate);
  prefFontLabel();
  prefRateLabel(state.ttsRate);
  setPrefLang(state.language === "vi" ? "vi" : "en");
  var ttsSupported = !!window.speechSynthesis;
  document.getElementById("pref-rate-decrease").disabled = !ttsSupported;
  document.getElementById("pref-rate-increase").disabled = !ttsSupported;
  document.getElementById("pref-tts-test").disabled = !ttsSupported;
  document.getElementById("pref-max-reviews").value =
    (state.maxReviewsPerDay === null || state.maxReviewsPerDay === undefined) ? "" : state.maxReviewsPerDay;
  if (IS_SERVER) {
    document.getElementById("pref-token-reveal").classList.add("hidden");
    document.getElementById("pref-token-value").value = "";
    renderApiTokens();
  }
  openModal("preferences");
});

// Token create/revoke take effect immediately rather than on Save — a created token
// already exists server-side, so tying it to the modal's Cancel would be misleading.
function renderApiTokens() {
  var list = document.getElementById("pref-token-list");
  store.listApiTokens().then(function(tokens) {
    list.innerHTML = "";
    if (!tokens.length) {
      var none = document.createElement("li");
      none.className = "pref-token-empty";
      none.textContent = t("pref.noTokens");
      list.appendChild(none);
      return;
    }
    tokens.forEach(function(tok) {
      var li = document.createElement("li");
      li.className = "pref-token-item";
      var info = document.createElement("span");
      info.className = "pref-token-info";
      info.textContent = tok.name + " · " + tok.prefix + "… · " +
        (tok.last_used_at ? t("pref.lastUsed", { date: relativeTime(tok.last_used_at) }) : t("pref.neverUsed"));
      var revoke = document.createElement("button");
      revoke.type = "button";
      revoke.className = "btn btn-sm btn-ghost btn-toolbar-danger";
      revoke.textContent = t("pref.revoke");
      revoke.addEventListener("click", function() {
        revoke.disabled = true;
        store.revokeApiToken(tok.id).then(renderApiTokens, function(err) {
          revoke.disabled = false;
          showToast(err.message, "error");
        });
      });
      li.appendChild(info);
      li.appendChild(revoke);
      list.appendChild(li);
    });
  }).catch(function(err) { list.textContent = err.message; });
}

document.getElementById("pref-token-create").addEventListener("click", function() {
  var btn = this;
  var nameEl = document.getElementById("pref-token-name");
  btn.disabled = true;
  store.createApiToken(nameEl.value).then(function(tok) {
    btn.disabled = false;
    nameEl.value = "";
    document.getElementById("pref-token-value").value = tok.token;
    document.getElementById("pref-token-copy").textContent = t("pref.copy");
    document.getElementById("pref-token-reveal").classList.remove("hidden");
    renderApiTokens();
  }, function(err) {
    btn.disabled = false;
    showToast(err.message, "error");
  });
});

document.getElementById("btn-download-backup").addEventListener("click", function() {
  downloadFromApi("/api/export");
});

document.getElementById("pref-token-copy").addEventListener("click", function() {
  var btn = this;
  var input = document.getElementById("pref-token-value");
  var done = function() { btn.textContent = t("pref.copied"); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(input.value).then(done, function() { input.select(); });
  } else {
    input.select();
  }
});

function setPrefLang(lang) {
  ["en", "vi"].forEach(function(l) {
    var pill = document.getElementById("pref-lang-" + l);
    pill.classList.toggle("active", l === lang);
    pill.setAttribute("aria-pressed", String(l === lang));
  });
}
document.getElementById("pref-lang-en").addEventListener("click", function() { setPrefLang("en"); });
document.getElementById("pref-lang-vi").addEventListener("click", function() { setPrefLang("vi"); });

// Live preview, same as font-scale/TTS-rate below; not persisted until Save.
document.getElementById("pref-theme").addEventListener("click", function(e) {
  var pill = e.target.closest(".pill");
  if (!pill) return;
  setPillGroup("pref-theme", pill.dataset.value);
  applyThemePref(pill.dataset.value);
});

document.getElementById("pref-daily-goal").addEventListener("click", function(e) {
  var pill = e.target.closest(".pill");
  if (!pill) return;
  setPillGroup("pref-daily-goal", pill.dataset.value);
});

document.getElementById("pref-palette").addEventListener("click", function(e) {
  var pill = e.target.closest(".pill");
  if (!pill) return;
  setPillGroup("pref-palette", pill.dataset.value);
  applyPalette(pill.dataset.value);
});

document.getElementById("pref-contrast").addEventListener("change", function() {
  applyContrast(this.checked);
});

// Sample buzz only — unlike dark mode, this preview deliberately doesn't write state:
// vibration is invisible, so a preview left behind by Cancel would silently disagree with
// the saved setting.
// Same rule as vibration below: play a sample, but leave state alone until Save.
document.getElementById("pref-sounds").addEventListener("change", function() {
  if (!this.checked) return;
  try { var c = soundContext(); if (c) SOUNDS.correct(c); } catch (_) {}
});

document.getElementById("pref-haptics").addEventListener("change", function() {
  if (!this.checked || !navigator.vibrate) return;
  try { navigator.vibrate(HAPTIC_PATTERNS.select); } catch (_) {}
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
  speakWith(t("tts.testPhrase"), rate);
});

document.getElementById("btn-save-preferences").addEventListener("click", function() {
  // Empty = no limit (null); 0 is a real "study nothing today" cap, so anything else that isn't
  // a whole number is rejected rather than quietly becoming 0.
  var maxField = document.getElementById("pref-max-reviews");
  var maxReviewsRaw = maxField.value.trim();
  if (maxField.validity.badInput || (maxReviewsRaw !== "" && !/^\d+$/.test(maxReviewsRaw))) {
    showFieldError(maxField, t("pref.maxReviewsInvalid"));
    return;
  }
  prefsSnapshot = null;
  var theme = document.querySelector("#pref-theme .pill.active").dataset.value;
  applyThemePref(theme);
  var palette = document.querySelector("#pref-palette .pill.active").dataset.value;
  applyPalette(palette);
  var highContrast = document.getElementById("pref-contrast").checked;
  applyContrast(highContrast);
  var haptics = document.getElementById("pref-haptics").checked;
  state.haptics = haptics;
  var sounds = document.getElementById("pref-sounds").checked;
  state.sounds = sounds;
  var quizCountsAsKnown = document.getElementById("pref-quiz-known").checked;
  state.quizCountsAsKnown = quizCountsAsKnown;
  var rate = parseFloat(document.getElementById("pref-rate-label").dataset.rate) || 0.9;
  state.ttsRate = rate;
  var lang = document.getElementById("pref-lang-vi").classList.contains("active") ? "vi" : "en";
  applyLanguage(lang);
  var maxReviews = maxReviewsRaw === "" ? null : parseInt(maxReviewsRaw, 10);
  state.maxReviewsPerDay = maxReviews;
  var goalPill = document.querySelector("#pref-daily-goal .pill.active");
  var dailyGoal = goalPill ? parseInt(goalPill.dataset.value, 10) : state.dailyGoal;
  state.dailyGoal = dailyGoal;
  _refreshDashHeroCards();
  // A changed review cap changes what Study Setup matches (and whether Start is enabled).
  if (getActiveScreen() === "setup" && state.setupDataPromise) state.setupDataPromise.then(updateSetupMatchCount);
  var prefs = { theme: theme, palette: palette, highContrast: highContrast, haptics: haptics, sounds: sounds, fontScale: state.fontScale, ttsRate: rate, language: lang, maxReviewsPerDay: maxReviews, dailyGoal: dailyGoal, quizCountsAsKnown: quizCountsAsKnown };
  // Merge into the cached blob rather than overwriting it — a plain overwrite would drop
  // studyPresets (and any other field this handler doesn't know about) from the local cache
  // until the next server fetch re-syncs it.
  try {
    var cachedPrefs = JSON.parse(localStorage.getItem("fc-preferences") || "{}");
    localStorage.setItem("fc-preferences", JSON.stringify(Object.assign({}, cachedPrefs, prefs)));
  } catch (_) {}
  fetch("/api/auth/preferences", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs)
  }).catch(function() {});
  closeModal("preferences");
});

/* ============================
   DASHBOARD METRICS MODAL
   ============================ */
var _dashMetricDraft = null;
var _studyTimeWindowDraft = null;

function _renderDashMetricsModalRows() {
  var list = document.getElementById("dash-metrics-list");
  if (!list) return;
  list.innerHTML = DASH_METRICS.map(function(m) {
    var mode = _dashMetricDraft[m.key] === "hidden" ? "hidden" : "show";
    var pills = ["hidden", "show"].map(function(opt) {
      var labelKey = "dashboard.metric" + opt.charAt(0).toUpperCase() + opt.slice(1);
      return '<button type="button" class="pill' + (mode === opt ? " active" : "") + '" data-mode="' + opt + '">' + t(labelKey) + "</button>";
    }).join("");
    return '<div class="dash-metric-row">' +
      '<span class="dash-metric-row-label">' + t(m.labelKey) + "</span>" +
      '<div class="dash-metric-mode-group" data-metric="' + m.key + '">' + pills + "</div>" +
    "</div>";
  }).join("");
}

var STUDY_TIME_WINDOW_OPTIONS = [
  { days: null, labelKey: "stat.allTime" },
  { days: 7,    labelKey: "dashboard.days7" },
  { days: 30,   labelKey: "dashboard.days30" },
  { days: 60,   labelKey: "dashboard.days60" },
  { days: 90,   labelKey: "dashboard.days90" }
];

function _renderStudyTimeWindowBar() {
  var bar = document.getElementById("dash-studytime-window-bar");
  if (!bar) return;
  bar.innerHTML = STUDY_TIME_WINDOW_OPTIONS.map(function(o) {
    var isActive = o.days === _studyTimeWindowDraft;
    return '<button type="button" class="pill' + (isActive ? " active" : "") + '" data-window="' + (o.days || "") + '">' +
      escHtml(t(o.labelKey)) + '</button>';
  }).join("");
}

["home-summary-grid", "dash-summary-grid"].forEach(function(gridId) {
  var grid = document.getElementById(gridId);
  if (!grid) return;
  grid.addEventListener("click", function(e) {
    if (!e.target.closest(".dash-hero-settings-btn")) return;
    _dashMetricDraft = Object.assign({}, DEFAULT_DASH_METRIC_CONFIG, state.dashMetricConfig);
    _studyTimeWindowDraft = state.studyTimeWindowDays;
    _renderDashMetricsModalRows();
    _renderStudyTimeWindowBar();
    openModal("dash-metrics");
  });
});

document.getElementById("dash-metrics-list").addEventListener("click", function(e) {
  var modeBtn = e.target.closest(".pill");
  if (!modeBtn) return;
  var group = modeBtn.closest(".dash-metric-mode-group");
  _dashMetricDraft[group.dataset.metric] = modeBtn.dataset.mode;
  group.querySelectorAll(".pill").forEach(function(p) { p.classList.toggle("active", p === modeBtn); });
});

document.getElementById("dash-studytime-window-bar").addEventListener("click", function(e) {
  var winBtn = e.target.closest(".pill");
  if (!winBtn) return;
  _studyTimeWindowDraft = winBtn.dataset.window ? parseInt(winBtn.dataset.window, 10) : null;
  this.querySelectorAll(".pill").forEach(function(p) { p.classList.toggle("active", p === winBtn); });
});

document.getElementById("btn-save-dash-metrics").addEventListener("click", function() {
  state.dashMetricConfig = Object.assign({}, DEFAULT_DASH_METRIC_CONFIG, _dashMetricDraft);
  var windowChanged = _studyTimeWindowDraft !== state.studyTimeWindowDays;
  state.studyTimeWindowDays = _studyTimeWindowDraft;
  var prefs = { dashMetricConfig: state.dashMetricConfig };
  try {
    var cachedPrefs = JSON.parse(localStorage.getItem("fc-preferences") || "{}");
    localStorage.setItem("fc-preferences", JSON.stringify(Object.assign({}, cachedPrefs, prefs)));
  } catch (_) {}
  try {
    localStorage.setItem("fc-studytime-window", state.studyTimeWindowDays == null ? "" : String(state.studyTimeWindowDays));
  } catch (_) {}
  fetch("/api/auth/preferences", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs)
  }).catch(function() {});
  if (windowChanged) {
    store.getDashboard(state.studyTimeWindowDays).then(function(dash) {
      if (state._dashHeroData) state._dashHeroData.studyTime = dash.studyTime;
      _refreshDashHeroCards();
    });
  } else {
    _refreshDashHeroCards();
  }
  closeModal("dash-metrics");
});

/* ============================
   INIT
   ============================ */

// Choose adapter
var store = IS_SERVER ? SQLiteAdapter : LocalStorageAdapter;
if (IS_SERVER) window.addEventListener("online", SQLiteAdapter.flushPending);
try {
  var flashToast = sessionStorage.getItem("fc-flash-toast");
  if (flashToast) { sessionStorage.removeItem("fc-flash-toast"); showToast(flashToast); }
} catch (_) {}
["btn-fc-translate-front", "btn-fc-translate-back"].forEach(function(id) {
  var button = document.getElementById(id);
  button.classList.toggle("hidden", !(IS_SERVER && window.APP_CONFIG.translationEnabled));
  button.addEventListener("click", function(e) {
    // The card itself flips (and clears the translation) on click.
    e.stopPropagation();
    translateVisibleFlashcardSide();
  });
});

document.documentElement.setAttribute("lang", state.language);
applyI18n();
try {
  var cachedStartPrefs = JSON.parse(localStorage.getItem("fc-preferences") || "{}");
  applyPalette(paletteFromPrefs(cachedStartPrefs));
  applyThemePref(themeFromPrefs(cachedStartPrefs));
} catch (_) { applyPalette("parchment"); applyThemePref("system"); }

if (IS_SERVER && !currentUser) {
  showScreen("auth");
} else {
  initUserNav();
  // Export/import both hit server routes (GET /api/export/flashcards, POST
  // /api/import/flashcards) with no local/offline equivalent — hidden outright rather than
  // shown-then-erroring, same treatment as the image-def format pill and other server-only
  // affordances.
  if (!IS_SERVER) {
    ["btn-export-class", "btn-export-lesson", "btn-export-classes", "btn-import-flashcards", "setup-filter-updated", "pref-api-tokens", "pref-backup", "sidebar-upstream-link", "sidebar-vocabulary-link", "sidebar-achievements-link"].forEach(function(id) {
      document.getElementById(id).classList.add("hidden");
    });
  }
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
          '<span class="class-icon">' + classIconHtml(cls.icon, 28) + '</span>' +
          '<div class="class-name">' + escHtml(cls.name) + '</div>' +
          '<div class="class-meta">by ' + escHtml(cls.owner_name) + '</div>' +
          '<div class="class-card-actions">' +
            '<button class="btn btn-sm btn-outline" data-clone-invite="' + cls.id + '">' + ICON_SAVE + ' Save Copy</button>' +
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
        showToast(t("share.savedToClasses", { name: name }));
      }
    });
}

function openSharedClassStudy(cls) {
  // Open the class detail but in read-only view (just lessons list)
  state.currentClass = cls;
  state.lessonFilter = "all";
  state._lessonAccuracyMap = {};
  state.sharedViewMode = true;
  document.getElementById("class-detail-name").innerHTML = classIconHtml(cls.icon) + " " + escHtml(cls.name);
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
  document.getElementById("share-class-name").innerHTML = classIconHtml(data.cls.icon) + " " + escHtml(data.cls.name);
  document.getElementById("share-owner-label").textContent = t("share.byOwner", { name: data.ownerName });

  var lessonList = document.getElementById("share-lesson-list");
  lessonList.innerHTML = "";
  data.lessons.forEach(function(lesson) {
    var cards = data.cards.filter(function(c) { return c.lesson_id === lesson.id; });
    var item = document.createElement("div");
    item.className = "lesson-item";
    item.innerHTML =
      '<div class="lesson-item-info">' +
        '<div class="lesson-title">' + escHtml(lesson.title) + '</div>' +
        '<div class="lesson-meta">' + t("count.cards", { n: cards.length }) + '</div>' +
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
            // The toast is shown by the page we navigate to.
            try { sessionStorage.setItem("fc-flash-toast", t("share.savedToClasses", { name: data.cls.name })); } catch (_) {}
            window.location.href = "/";
          } else {
            showToast(serverError(d, t("common.failedToSave")), "error");
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
  showLayer(document.getElementById("modal-share"));

  // Load existing share link
  loadShareLink(classId);
  // Load invited users
  loadInviteList(classId);
}

function closeShareModal() {
  hideLayer(document.getElementById("modal-share"));
}

function loadShareLink(classId) {
  var linkRow  = document.getElementById("share-link-row");
  var genBtn   = document.getElementById("btn-generate-share-link");
  var input    = document.getElementById("share-link-input");

  linkRow.classList.add("hidden");
  genBtn.classList.add("hidden");
  fetch("/api/share/link/" + classId, { credentials: "same-origin" })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (classId !== shareModalClassId) return;
      if (d.token) showShareLinkRow(d.token);
      else genBtn.classList.remove("hidden");
    }, function() {
      if (classId === shareModalClassId) genBtn.classList.remove("hidden");
    });
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
      showShareLinkRow(d.token);
    });
});

document.getElementById("btn-copy-share-link").addEventListener("click", function() {
  var input = document.getElementById("share-link-input");
  navigator.clipboard.writeText(input.value).then(function() {
    var btn = document.getElementById("btn-copy-share-link");
    flashButtonFeedback(btn, ICON_CHECK + " " + t("common.copied"), t("common.copy"), 2000);
  });
});

document.getElementById("btn-revoke-share-link").addEventListener("click", function() {
  var classId = shareModalClassId;
  if (!classId) return;
  confirmAction(t("share.disableLinkConfirm"), function() {
    fetch("/api/share/link/" + classId, { method: "DELETE", credentials: "same-origin" })
      .then(function(r) {
        if (!r.ok) throw new Error(t("error.requestFailed", { status: r.status }));
        document.getElementById("share-link-row").classList.add("hidden");
        document.getElementById("btn-generate-share-link").classList.remove("hidden");
      })
      .catch(function(err) {
        showToast(err instanceof TypeError ? t("common.networkError") : err.message, "error");
      });
  }, "disableLink");
});

function loadInviteList(classId) {
  fetch("/api/share/invites/" + classId, { credentials: "same-origin" })
    .then(function(r) { return r.json(); })
    .then(function(users) {
      var list = document.getElementById("share-invite-list");
      if (!users.length) {
        list.innerHTML = '<p class="share-empty-text">' + t("share.noOneInvited") + '</p>';
        return;
      }
      list.innerHTML = "";
      users.forEach(function(u) {
        var row = document.createElement("div");
        row.className = "share-user-row";
        row.innerHTML =
          '<span class="share-user-name">' + escHtml(u.name) + '</span>' +
          '<span class="share-user-email">' + escHtml(u.email) + '</span>' +
          '<button class="btn btn-danger btn-sm" data-remove-user="' + u.id + '">' + t("common.remove") + '</button>';
        row.querySelector("[data-remove-user]").addEventListener("click", function() {
          fetch("/api/share/invite/" + classId + "/" + u.id, { method: "DELETE", credentials: "same-origin" })
            .then(function() { loadInviteList(classId); });
        });
        list.appendChild(row);
      });
    });
}

document.getElementById("share-invite-input").addEventListener("keydown", function(e) {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  document.getElementById("btn-send-invite").click();
});

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
      errEl.textContent = serverError(res.d, t("share.failedToInvite"));
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
// Each search gets a number so a slow earlier reply can't overwrite newer results, and Enter
// only opens a result that belongs to the text currently typed.
var _searchSeq           = 0;
var _searchRenderedQ     = null;

function openSearchModal() {
  var modalEl = document.getElementById("modal-search");
  var inputEl = document.getElementById("search-input");
  showLayer(modalEl);
  inputEl.value = "";
  _searchActiveIdx   = -1;
  _searchResultItems = [];
  document.getElementById("search-results").innerHTML = "";
  document.getElementById("search-empty").classList.add("hidden");
  _searchSeq++;
  _searchRenderedQ = null;
  // Focus now, not after a delay: keys typed right after Ctrl/Cmd+K would otherwise be lost,
  // and iOS only raises the keyboard for focus inside the tap.
  inputEl.focus();
}

function closeSearchModal() {
  _searchSeq++;
  hideLayer(document.getElementById("modal-search"));
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
  _searchRenderedQ   = q;

  var total = results.classes.length + results.lessons.length + results.cards.length;
  if (total === 0) { emptyEl.textContent = t("search.noResults"); emptyEl.classList.remove("hidden"); return; }
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

  makeSection(t("stat.classes"), results.classes, "class", function(cls) {
    var el = document.createElement("div");
    el.className = "search-result-item";
    el.innerHTML =
      '<span class="search-result-icon">' + classIconHtml(cls.icon, 14) + '</span>' +
      '<div class="search-result-main">' +
        '<div class="search-result-title">' + highlightMatch(cls.name, q) + '</div>' +
      '</div>' +
      '<span class="search-result-type">' + t("common.classSingular") + '</span>';
    return el;
  });

  makeSection(t("stat.lessons"), results.lessons, "lesson", function(lesson) {
    var el = document.createElement("div");
    el.className = "search-result-item";
    el.innerHTML =
      '<span class="search-result-icon">' + classIconHtml(lesson.class_icon, 14) + '</span>' +
      '<div class="search-result-main">' +
        '<div class="search-result-title">' + highlightMatch(lesson.title, q) + '</div>' +
        '<div class="search-result-breadcrumb">' + escHtml(lesson.class_name) + '</div>' +
      '</div>' +
      '<span class="search-result-type">' + t("common.lessonSingular") + '</span>';
    return el;
  });

  makeSection(t("stat.cards"), results.cards, "card", function(card) {
    var el = document.createElement("div");
    el.className = "search-result-item";
    el.innerHTML =
      '<span class="search-result-icon">' + classIconHtml(card.class_icon, 14) + '</span>' +
      '<div class="search-result-main">' +
        '<div class="search-result-title">' + highlightMatch(card.display_text || "", q) + '</div>' +
        '<div class="search-result-breadcrumb">' +
          escHtml(card.class_name) + ' › ' + escHtml(card.lesson_title) +
        '</div>' +
      '</div>' +
      '<span class="search-result-type">' + t("common.cardSingular") + '</span>';
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
  openLessonFromAnywhere(data.class_id, type === "lesson" ? data.id : data.lesson_id);
}

// openLesson() only works once the class and its lesson list are in state.
function openLessonFromAnywhere(classId, lessonId) {
  store.getClass(classId).then(function(cls) {
    if (!cls) return;
    state.currentClass = cls;
    state.lessonFilter = "all";
    state._lessonAccuracyMap = {};
    store.getLessons(classId).then(function(lessons) {
      state.currentClassLessons = lessons;
      openLesson(lessonId);
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
      _searchSeq++;
      document.getElementById("search-results").innerHTML = "";
      document.getElementById("search-empty").classList.add("hidden");
      _searchResultItems = [];
      _searchActiveIdx   = -1;
      return;
    }
    var seq = ++_searchSeq;
    _searchDebounceTimer = setTimeout(function() {
      store.search(q).then(function(results) {
        if (seq === _searchSeq) renderSearchResults(results, q);
      }, function() {
        if (seq !== _searchSeq) return;
        var emptyEl = document.getElementById("search-empty");
        document.getElementById("search-results").innerHTML = "";
        _searchResultItems = [];
        _searchActiveIdx   = -1;
        _searchRenderedQ   = null;
        emptyEl.textContent = t("search.failed");
        emptyEl.classList.remove("hidden");
      });
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
    // Enter opens the highlighted result, or the first one when none is highlighted.
    if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {
      var hit = _searchResultItems[Math.max(_searchActiveIdx, 0)];
      if (hit && _searchRenderedQ === inputEl.value.trim()) {
        e.preventDefault();
        selectSearchResult(hit.type, hit.data);
      }
    }
  });
}());

function toggleKeymapModal() {
  var km = document.getElementById("modal-keymap");
  if (km.classList.contains("hidden")) showLayer(km);
  else hideLayer(km);
}

document.getElementById("btn-keymap-close").addEventListener("click", function() {
  hideLayer(document.getElementById("modal-keymap"));
});
document.getElementById("modal-keymap").addEventListener("click", function(e) {
  if (e.target === this) hideLayer(this);
});
document.getElementById("btn-show-keymap").addEventListener("click", toggleKeymapModal);

// Number of columns a responsive CSS grid (auto-fill/auto-fit) is actually rendering right
// now — read off the computed style, since it resolves the repeat()/minmax() shorthand into
// the real track count for the current viewport, unlike counting DOM children.
function _gridColumnCount(container) {
  if (!container) return 1;
  var cols = getComputedStyle(container).gridTemplateColumns.split(" ").filter(Boolean).length;
  return cols || 1;
}

function moveFocus(selector, dir) {
  var items = Array.from(document.querySelectorAll(selector));
  if (!items.length) return;
  var focused = document.activeElement;
  var idx = items.indexOf(focused);
  if (idx === -1) idx = dir > 0 ? -1 : items.length;
  var next = items[Math.max(0, Math.min(items.length - 1, idx + dir))];
  next.focus();
}

// The 4 card-format modals (Add and Edit Card both reuse these, retitled) — their term/def/etc.
// fields are <textarea>s, where plain Enter has to stay a newline (a LaTeX answer can be
// multi-line), so saving needs an explicit modifier rather than plain Enter.
var CARD_SAVE_MODALS = [
  { modal: "modal-card-termdef",  btn: "btn-save-card-termdef" },
  { modal: "modal-card-mcq",      btn: "btn-save-card-mcq" },
  { modal: "modal-card-tf",       btn: "btn-save-card-tf" },
  { modal: "modal-card-imagedef", btn: "btn-save-card-imagedef" }
];

document.addEventListener("keydown", function(e) {
  var screen = getActiveScreen();
  if (!screen) return;

  // Ctrl/Cmd+Z → undo the last grade while its bar is up. Not from a field with text in it,
  // where it is the field's own undo; the Write-mode input is empty on the next card.
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z") && state.fcUndo &&
      !(isInputFocused() && document.activeElement.value)) {
    e.preventDefault();
    undoLastGrade();
    return;
  }

  // Ctrl/Cmd+K → open search
  if ((e.ctrlKey || e.metaKey) && e.key === "k") {
    e.preventDefault();
    openSearchModal();
    return;
  }

  // Ctrl/Cmd+Enter → save, from inside any Add/Edit Card modal's fields. Checked before the
  // isInputFocused()/anyModalOpen guard below (which exists specifically to block *other*
  // shortcuts while typing) since this one is meant to fire from inside a focused textarea.
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    // Only the top dialog: a confirm open over the editor must not save underneath it.
    var top = modalStack[modalStack.length - 1];
    var openCardModal = top && CARD_SAVE_MODALS.filter(function(m) { return m.modal === "modal-" + top.id; })[0];
    if (openCardModal) {
      e.preventDefault();
      document.getElementById(openCardModal.btn).click();
      return;
    }
  }

  // Escape closes any open modal (search first, then keymap, then overlay, then share/prompt-guide)
  if (e.key === "Escape" && fcAnyOverlayOpen()) {
    fcCloseTopModal();
    return;
  }

  // Alt+T is explicit so it remains available in Flashcard & Write while its answer input has focus.
  var flashcardModalOpen = !document.getElementById("modal-keymap").classList.contains("hidden") ||
    !document.getElementById("modal-overlay").classList.contains("hidden") ||
    !document.getElementById("modal-share").classList.contains("hidden") ||
    !document.getElementById("modal-prompt-guide").classList.contains("hidden") ||
    !document.getElementById("modal-search").classList.contains("hidden");
  if (screen === "flashcard" && e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat && !e.isComposing &&
      (e.key === "t" || e.key === "T") && !flashcardModalOpen) {
    e.preventDefault();
    translateVisibleFlashcardSide();
    return;
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

  // Global: H = home (any screen except mid-study, where a stray key would end the session)
  if ((e.key === "h" || e.key === "H") && screen !== "flashcard" && screen !== "quiz") {
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
    else if (e.key === "n" || e.key === "N") { e.preventDefault(); openNewClass(); }
    else if ((e.key === "a" || e.key === "A") && IS_SERVER) openDashboard();
    else if (e.key === "ArrowRight") { e.preventDefault(); moveFocus("#class-list [data-class-id]", 1); }
    else if (e.key === "ArrowLeft")  { e.preventDefault(); moveFocus("#class-list [data-class-id]", -1); }
    else if (e.key === "ArrowDown")  { e.preventDefault(); moveFocus("#class-list [data-class-id]", _gridColumnCount(document.getElementById("class-list"))); }
    else if (e.key === "ArrowUp")    { e.preventDefault(); moveFocus("#class-list [data-class-id]", -_gridColumnCount(document.getElementById("class-list"))); }
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
    else if ((e.key === "d" || e.key === "D") && state.selectMode) document.getElementById("btn-delete-selected-lessons").click();
    else if (e.key === "Escape" && state.selectMode) setSelectMode(false);
    else if (e.key === "n" || e.key === "N") { e.preventDefault(); openNewLesson(); }
    else if (e.key === "e" || e.key === "E") { e.preventDefault(); if (state.currentClass) openEditClass(state.currentClass.id); }
    else if (e.key === "Backspace") { e.preventDefault(); document.getElementById("btn-class-back").click(); }
  }

  else if (screen === "lesson") {
    if (e.key === "n" || e.key === "N") { e.preventDefault(); openAddCard(); }
    else if (e.key === "b" || e.key === "B") { e.preventDefault(); openBulkAdd(); }
    else if (e.key === "s" || e.key === "S") { if (state.currentLesson) openSetup(); }
    else if ((e.key === "d" || e.key === "D") && state.cardSelectMode) document.getElementById("btn-delete-selected-cards").click();
    else if (e.key === "Backspace") { e.preventDefault(); document.getElementById("btn-lesson-back").click(); }
  }

  else if (screen === "setup") {
    // Enter starts the session so the S→Enter path (open setup, then begin) is fully keyboard-driven;
    // preventDefault stops a focused pill's native Enter-click from also firing.
    // A pill focused with Tab takes Enter as "select this"; Enter anywhere else starts the session.
    if (e.key === "Enter" && !e.target.closest(".pill")) { e.preventDefault(); document.getElementById("btn-start-study").click(); }
    else if (e.key === "Escape" || e.key === "Backspace") { e.preventDefault(); document.getElementById("btn-setup-back").click(); }
    else {
      var presetNum = parseInt(e.key, 10);
      if (presetNum >= 1 && presetNum <= 9 && presetNum <= state.studyPresets.length) {
        e.preventDefault();
        applyStudyPreset(state.studyPresets[presetNum - 1]);
      }
    }
  }

  else if (screen === "flashcard") {
    if (e.key === "ArrowLeft")  document.getElementById("btn-fc-prev").click();
    else if (e.key === "ArrowRight") document.getElementById("btn-fc-next").click();
    // A focused speak/translate button on the card handles Enter/Space itself.
    else if ((e.key === " " || e.key === "Enter") && !e.target.closest(".fc-face-actions")) { e.preventDefault(); document.getElementById("fc-scene").click(); }
    // preventDefault matters here specifically for Learning/Hard: grading those in Flashcard &
    // Write mode synchronously focuses #fc-retype-input (markCard -> beginForcedRetype ->
    // input.focus()) within this same keydown's dispatch, before the browser's own default
    // keydown handling runs — without it, the digit that triggered the shortcut gets typed
    // into the just-focused retype box as its default action. Applied to all four grading
    // keys for consistency, though only 1/2 can currently reach a focused input this way.
    else if (e.key === "1") { e.preventDefault(); document.getElementById("btn-fc-learning").click(); }
    else if (e.key === "2") { e.preventDefault(); document.getElementById("btn-fc-hard").click(); }
    else if (e.key === "3") { e.preventDefault(); document.getElementById("btn-fc-known").click(); }
    else if (e.key === "4") { e.preventDefault(); document.getElementById("btn-fc-easy").click(); }
    else if (e.key === "s" || e.key === "S") document.getElementById("btn-fc-shuffle").click();
    else if ((e.key === "t" || e.key === "T") && !e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing) {
      e.preventDefault();
      translateVisibleFlashcardSide();
    }
    else if (e.key === "p" || e.key === "P") {
      if (state.studyFlipped) speakText(state.studyBackText);
      else speakStudyFront();
    }
    else if (e.key === "Escape") confirmLeaveStudy(function() { document.getElementById("btn-fc-back").click(); });
  }

  else if (screen === "quiz") {
    var num = parseInt(e.key, 10);
    var quizNextBtn = document.getElementById("quiz-next-btn");
    if (num >= 1 && num <= 5 && num <= state.quizOptions.length) answerQuiz(num - 1);
    // A focused button or explanation summary handles Enter/Space itself.
    else if ((e.key === "Enter" || e.key === " ") && quizNextBtn && !e.target.closest("button, summary, a") &&
             document.getElementById("modal-keymap").classList.contains("hidden")) {
      e.preventDefault();
      quizNextBtn.click();
    }
    else if (e.key === "Escape") confirmLeaveStudy(returnFromStudy);
    else if (e.key === "ArrowLeft") document.getElementById("btn-quiz-prev").click();
    else if (e.key === "ArrowRight") document.getElementById("btn-quiz-review-next").click();
    else if ((e.key === "p" || e.key === "P") && !e.ctrlKey && !e.metaKey && !e.altKey) speakQuizTerm();
  }

  else if (screen === "results") {
    if (e.key === "r" || e.key === "R") document.getElementById("btn-results-retry").click();
    else if (e.key === "Escape") returnFromStudy();
  }

  else if (screen === "flashcard-summary") {
    if (e.key === "Escape") returnFromStudy();
  }

  else if (screen === "stats") {
    if (e.key === "Escape") document.getElementById("btn-stats-back").click();
  }

  else if (screen === "dashboard") {
    if (e.key === "Escape") document.getElementById("btn-dashboard-back").click();
  }
  else if (screen === "upstream") {
    if (e.key === "Escape") document.getElementById("btn-upstream-back").click();
  }
  else if (screen === "vocabulary") {
    if (e.key === "Escape") document.getElementById("btn-vocabulary-back").click();
  }
  else if (screen === "achievements") {
    if (e.key === "Escape") document.getElementById("btn-achievements-back").click();
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
    ["btn-results-retry",  "[R]"],
    ["btn-results-back",   "[Esc]"],
    ["btn-summary-back",   "[Esc]"],
    ["btn-stats-back",     "[Esc]"],
    ["btn-dashboard-back", "[Esc]"],
    ["btn-upstream-back",  "[Esc]"],
    ["btn-vocabulary-back", "[Esc]"],
    ["btn-achievements-back", "[Esc]"],
    ["btn-quiz-back",      "[Esc]"],
    ["btn-fc-reveal",      "[Space]"],
    ["btn-fc-learning",    "[1]"],
    ["btn-fc-hard",        "[2]"],
    ["btn-fc-known",       "[3]"],
    ["btn-fc-easy",        "[4]"],
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
   BROWSER BACK BUTTON
   The app is a single URL ("/") with no router, so a native Back press used to leave
   the app entirely. Trap it: navigate one screen back in-app instead, re-arming each
   time so Back stays inside the app. Back also closes an open modal first.
   ============================ */
var SCREEN_BACK_BTN = {
  class:     "btn-class-back",
  lesson:    "btn-lesson-back",
  setup:     "btn-setup-back",
  flashcard: "btn-fc-back",
  quiz:      "btn-quiz-back",
  results:   "btn-results-back",
  stats:     "btn-stats-back",
  dashboard: "btn-dashboard-back",
  upstream:  "btn-upstream-back",
  vocabulary: "btn-vocabulary-back",
  achievements: "btn-achievements-back",
  "flashcard-summary": "btn-summary-back"
};

function fcAnyOverlayOpen() {
  return ["modal-search", "modal-keymap", "modal-overlay", "modal-share", "modal-prompt-guide"]
    .some(function(id) { var m = document.getElementById(id); return m && !m.classList.contains("hidden"); });
}

function fcCloseTopModal() {
  var m = document.getElementById("modal-search");
  if (m && !m.classList.contains("hidden")) { closeSearchModal(); return; }
  m = document.getElementById("modal-keymap");
  if (m && !m.classList.contains("hidden")) { hideLayer(m); return; }
  m = document.getElementById("modal-overlay");
  if (m && !m.classList.contains("hidden")) { requestCloseTopModal(); return; }
  m = document.getElementById("modal-share");
  if (m && !m.classList.contains("hidden")) { closeShareModal(); return; }
  m = document.getElementById("modal-prompt-guide");
  if (m && !m.classList.contains("hidden")) { hideLayer(m); return; }
}

history.pushState({ fc: true }, "");
window.addEventListener("popstate", function() {
  history.pushState({ fc: true }, "");  // re-arm so the next Back is also trapped
  if (fcAnyOverlayOpen()) { fcCloseTopModal(); return; }
  var screen = getActiveScreen();
  var backId = SCREEN_BACK_BTN[screen];
  var b = backId && document.getElementById(backId);
  // On home/auth (no back button) there's nothing to go back to in-app — stay put.
  if (!b) return;
  // iPhone's edge swipe is the easy way to leave a session by accident.
  if (screen === "flashcard" || screen === "quiz") confirmLeaveStudy(function() { b.click(); });
  else b.click();
});

/* ============================
   PULL-TO-REFRESH (mobile)
   ============================ */
(function() {
  var ind    = document.getElementById("ptr-indicator");
  var circle = ind.querySelector(".ptr-circle");
  var label  = ind.querySelector(".ptr-label");
  var THRESHOLD = 72;
  var startX = 0, startY = 0, lastDy = 0, pulling = false, busy = false, armed = false;

  function setHeight(px) { ind.style.height = px + "px"; }

  // Only a pull that starts on the bare Home screen counts: not under an open dialog or the
  // sidebar, where a downward swipe means something else.
  document.addEventListener("touchstart", function(e) {
    armed = !(busy || getActiveScreen() !== "home" || window.scrollY > 4 || fcAnyOverlayOpen() ||
      document.getElementById("sidebar").classList.contains("sidebar-open"));
    if (!armed) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    lastDy = 0;
    pulling = false;
    ind.style.transition = "none";
  }, { passive: true });

  document.addEventListener("touchmove", function(e) {
    if (!armed || busy) return;
    if (window.scrollY > 4) { if (pulling) { setHeight(0); pulling = false; } return; }
    var dy = e.touches[0].clientY - startY;
    if (dy <= 0) { if (pulling) { setHeight(0); pulling = false; } return; }
    // A diagonal gesture (e.g. the edge-swipe that opens the sidebar) can otherwise
    // satisfy this threshold too, firing a spurious refresh on top of the sidebar animation.
    var dx = Math.abs(e.touches[0].clientX - startX);
    if (dx > dy) { if (pulling) { setHeight(0); pulling = false; } return; }
    lastDy = dy;
    pulling = true;
    // Rubber-band: full speed until threshold, slow beyond
    var h = dy < THRESHOLD ? dy * 0.6 : THRESHOLD * 0.6 + (dy - THRESHOLD) * 0.15;
    setHeight(Math.min(Math.round(h), 64));
    var ready = dy >= THRESHOLD;
    circle.style.transform = "rotate(" + Math.min(dy / THRESHOLD, 1) * 320 + "deg)";
    label.textContent = ready ? t("common.releaseToRefresh") : t("common.pullToRefresh");
  }, { passive: true });

  document.addEventListener("touchend", function() {
    if (!pulling || busy) { pulling = false; return; }
    pulling = false;
    ind.style.transition = "";
    if (lastDy >= THRESHOLD) {
      haptic("tick");
      busy = true;
      setHeight(56);
      circle.style.transform = "";
      ind.classList.add("ptr-spinning");
      label.textContent = t("common.refreshing");
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
  // Shared "scene returns to its resting transform" motion — used for both the
  // text-selection-interrupt cancel and the under-threshold release snap-back, so the two
  // conceptually similar moments (drag released without a grade) share one feel instead of
  // two different curves/durations. Deliberately NOT reused for the fly-off exit below —
  // that's a distinct "leaving" motion, not a "returning to rest" one.
  var SCENE_SNAP_TRANSITION = "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)";

  // ─── 1. Flashcard: right = known, left = learning ─────────────────────
  var scene = document.getElementById("fc-scene");
  var fcStartX, fcStartY, fcDragging = false, fcDx = 0, fcArmed = false;

  var knownHint = document.createElement("div");
  knownHint.className = "fc-swipe-hint fc-swipe-known";
  knownHint.setAttribute("data-i18n", "study.knowIt");
  knownHint.innerHTML = ICON_CHECK + " " + t("study.knowIt");

  var learnHint = document.createElement("div");
  learnHint.className = "fc-swipe-hint fc-swipe-learning";
  learnHint.setAttribute("data-i18n", "study.learning");
  learnHint.innerHTML = ICON_X + " " + t("study.learning");

  scene.appendChild(knownHint);
  scene.appendChild(learnHint);

  scene.addEventListener("touchstart", function(e) {
    fcStartX = e.touches[0].clientX;
    fcStartY = e.touches[0].clientY;
    fcDragging = false;
    fcDx = 0;
    fcArmed = false;
  }, { passive: true });

  scene.addEventListener("touchmove", function(e) {
    // A long-press-to-copy gesture also reports touch coordinate movement (the OS's
    // selection handles / loupe being dragged) — without this check, that movement gets
    // misread as a swipe-to-grade, since the two look identical from raw touch deltas
    // alone. Defer to text selection whenever one is active, rather than guessing via
    // timing: bail out of (and un-arm, if already mid-drag) the swipe entirely.
    if (window.getSelection && window.getSelection().type === "Range") {
      if (fcDragging) {
        fcDragging = false;
        fcDx = 0;
        knownHint.style.opacity = 0;
        learnHint.style.opacity = 0;
        scene.style.transition = SCENE_SNAP_TRANSITION;
        scene.style.transform = "";
      }
      return;
    }
    var dx = e.touches[0].clientX - fcStartX;
    var dy = e.touches[0].clientY - fcStartY;
    if (!fcDragging) {
      if (Math.abs(dx) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) return;
      if (!state.studyHasFlippedCard) return;
      // Forced-retype drill pending — don't let swipe-to-grade fire the (now-disabled)
      // grading buttons and fly the card off mid-drill.
      if (state.fcForcedRetype) return;
      fcDragging = true;
    }
    fcDx = dx;
    var rot = (dx / (window.innerWidth * 0.5)) * MAX_ROT;
    scene.style.transition = "none";
    scene.style.transform = "translateX(" + dx + "px) rotate(" + rot + "deg)";
    // One-shot per gesture: tracking the boundary itself would buzz repeatedly on jitter.
    if (!fcArmed && Math.abs(dx) > SWIPE_THRESHOLD) {
      fcArmed = true;
      haptic("tick");
    }
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
      // Deliberately don't snap the scene back to center here — it'd show the just-graded,
      // still-flipped card at center for however long markCard()'s auto-advance takes (up to
      // 1200ms), flashing stale content before the real next card is ready. Leaving it flown
      // off-screen (invisible) until renderFlashcard() or beginForcedRetype() resets it —
      // whichever "this card's UI should be visible again" moment actually comes next —
      // means the timing of those two things no longer has to be reconciled with this one.
      setTimeout(function() {
        document.getElementById("btn-fc-known").click();
      }, 250);
    } else if (dx < -SWIPE_THRESHOLD) {
      scene.style.transition = "transform 0.25s ease-out";
      scene.style.transform = "translateX(-" + (window.innerWidth + 100) + "px) rotate(-" + MAX_ROT + "deg)";
      setTimeout(function() {
        document.getElementById("btn-fc-learning").click();
      }, 250);
    } else {
      if (fcArmed) haptic("tick"); // armed, then pulled back: the grade was cancelled
      scene.style.transition = SCENE_SNAP_TRANSITION;
      scene.style.transform = "";
    }
  });

  // ─── 2. Edge back swipe (left edge → swipe right → go back) ───────────

  // iOS's own WKWebView back-navigation gesture watches this same left-edge zone and
  // fires independently of any JS handler below — it isn't triggered by our code, so
  // removing our own response to the gesture (tried first) didn't stop its blank-frame
  // transition. This is the standard mitigation: a non-passive touchmove listener that
  // calls preventDefault() while the drag is still recognizably horizontal, before
  // iOS's gesture recognizer commits to it. Not guaranteed on every iOS version — it's
  // the only lever web content has here — so if the flash persists on a real device,
  // this technique isn't working for that iOS version and the gesture may need to stay
  // off Home entirely (open the sidebar via the hamburger button instead).
  var nativeEdgeStartX = null, nativeEdgeStartY = 0;
  document.addEventListener("touchstart", function(e) {
    var x = e.touches[0].clientX;
    nativeEdgeStartX = x < 24 ? x : null;
    nativeEdgeStartY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener("touchmove", function(e) {
    if (nativeEdgeStartX === null) return;
    var dx = e.touches[0].clientX - nativeEdgeStartX;
    var dy = Math.abs(e.touches[0].clientY - nativeEdgeStartY);
    if (dx > 10 && dx > dy) e.preventDefault();
  }, { passive: false });

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
        haptic("tick");
        openSidebar();
        return;
      }
      var backMap = {
        "class": "btn-class-back",
        "lesson": "btn-lesson-back",
        "quiz": "btn-quiz-back",
        "stats": "btn-stats-back",
        "dashboard": "btn-dashboard-back",
        "upstream": "btn-upstream-back",
        "vocabulary": "btn-vocabulary-back",
        "achievements": "btn-achievements-back"
      };
      var btn = backMap[screen];
      if (btn) {
        var el = document.getElementById(btn);
        if (el) { haptic("tick"); el.click(); }
      }
    }
  }, { passive: true });

  // ─── 3. Search modal: swipe down to close ─────────────────────────────
  var modal = document.querySelector("#modal-search .search-modal");
  var modalStartY;
  if (modal) {
    modal.addEventListener("touchstart", function(e) {
      modalStartY = e.touches[0].clientY;
    }, { passive: true });
    modal.addEventListener("touchend", function(e) {
      if (e.changedTouches[0].clientY - modalStartY > 80) { haptic("tick"); closeSearchModal(); }
    }, { passive: true });
  }
}());
