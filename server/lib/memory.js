"use strict";

// Target recall and a personal FSRS model. FSRS schedules a card for the moment its
// predicted chance of recall falls to the target; the default target is 90% and the
// default model is FSRS's own parameters, fitted to many other people's reviews. A user
// may choose a target from 80% to 95%, and may fit the 21 parameters to their own
// answers. A fit is only proposed: training stores a candidate and its held-out error
// beside the default's, and nothing changes until the user applies it.
//
// A new model or target applies to each card from its next answer. Stability and
// difficulty already stored were computed with the old model and are not recomputed:
// replaying a history would have to reproduce which answers were early (and so did not
// reschedule) under due dates the balancer moved, and a wrong replay would be worse than
// one review cycle of old values.

const { FSRS, generatorParameters } = require("ts-fsrs");
const { MAX_INTERVAL, ratingFor } = require("../fsrs");
const { localDay, normalizeTz } = require("./workload");

const DEFAULT_RECALL = 90, MIN_RECALL = 80, MAX_RECALL = 95;
// Below this many answers a fit is mostly noise; the button shows progress until then.
const MIN_REVIEWS = 400;
// Suggest retraining once this many answers have come in since the last fit, or as many
// as it was trained on if that is fewer: a small fit gains most from new data.
const RETRAIN_AFTER = 1000;
// The later share of the history held out to compare the default and personal models.
const HOLDOUT = 0.2;
const PARAM_COUNT = 21;
const DEFAULT_W = generatorParameters({}).w.slice();

function targetRecall(prefs) {
  const v = prefs && prefs.targetRecall;
  return Number.isInteger(v) && v >= MIN_RECALL && v <= MAX_RECALL ? v : DEFAULT_RECALL;
}

function validWeights(w) {
  return Array.isArray(w) && w.length === PARAM_COUNT && w.every(x => typeof x === "number" && isFinite(x));
}

// The stored model, or null for the default. A row that does not parse is the default.
function parseModel(json) {
  if (!json) return null;
  try {
    const m = JSON.parse(json);
    return m && validWeights(m.w) ? m : null;
  } catch (_) { return null; }
}

const cache = new Map();
function schedulerFor(w, recall) {
  const key = (w ? w.join(",") : "default") + "|" + recall;
  let s = cache.get(key);
  if (!s) {
    if (cache.size > 200) cache.clear();
    const params = { maximum_interval: MAX_INTERVAL, request_retention: recall / 100 };
    if (w) params.w = w;
    s = new FSRS(generatorParameters(params));
    cache.set(key, s);
  }
  return s;
}

function readUser(db, userId) {
  const row = db.prepare("SELECT preferences, fsrs_model, fsrs_candidate FROM users WHERE id = ?").get(userId) || {};
  let prefs = {};
  try { prefs = JSON.parse(row.preferences || "{}"); } catch (_) {}
  return { recall: targetRecall(prefs), model: parseModel(row.fsrs_model), candidate: parseModel(row.fsrs_candidate) };
}

// The scheduler every due date, interval preview and recall estimate for this user uses.
function userScheduler(db, userId) {
  const u = readUser(db, userId);
  return schedulerFor(u.model && u.model.w, u.recall);
}

// FSRS's interval for a stability at a target, before rounding and the 365-day cap. Same
// formula as ts-fsrs: the forgetting curve's decay is the model's last parameter.
function intervalAt(stability, recall, w) {
  const decay = -(w || DEFAULT_W)[20];
  const factor = Math.pow(0.9, 1 / decay) - 1;
  return stability / factor * (Math.pow(recall / 100, 1 / decay) - 1);
}

// Rough reviews per day once each card has settled at the target: every review card
// comes back once per interval. Lapses add relearning reviews this leaves out, so the
// number is a comparison between targets, not a forecast.
function loadByTarget(stabilities, w) {
  const out = {};
  for (let r = MIN_RECALL; r <= MAX_RECALL; r++) {
    let sum = 0;
    for (const s of stabilities) sum += 1 / Math.min(MAX_INTERVAL, Math.max(1, intervalAt(s, r, w)));
    out[r] = Math.round(sum * 10) / 10;
  }
  return out;
}

function reviewCount(db, userId) {
  return db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_id = ?").get(userId).n;
}

// Each card's answers as (rating, local day), oldest first. Answers to cards since
// deleted still count: they are real evidence of how this person forgets.
function histories(db, userId, tz) {
  const rows = db.prepare(
    "SELECT card_id, correct, grade, source, created_at FROM attempts WHERE user_id = ? ORDER BY card_id, created_at, rowid"
  ).all(userId);
  const byCard = new Map();
  for (const r of rows) {
    let h = byCard.get(r.card_id);
    if (!h) byCard.set(r.card_id, h = []);
    h.push({ rating: ratingFor(!!r.correct, r.grade, r.source), day: localDay(r.created_at, tz), at: r.created_at });
  }
  return byCard;
}

// One training item per answer after a card's first: the history up to and including it,
// which is what FSRS predicts that answer from. Days between answers, 0 on the same day.
// A history still all on its first day is left out: the optimizer panics on one, and a
// native panic aborts the process rather than throwing.
function trainingItems(byCard) {
  const items = [];
  for (const h of byCard.values()) {
    for (let i = 1; i < h.length; i++) {
      if (h[i].day === h[0].day) continue;
      items.push({ at: h[i].at, reviews: h.slice(0, i + 1).map((x, k) => [x.rating, k === 0 ? 0 : x.day - h[k - 1].day]) });
    }
  }
  return items.sort((a, b) => a.at - b.at);
}

// The comparison is on cross-day recall, the thing the target sets: each history keeps its
// first answer of every day, and answers on the same day as the one before are not
// predicted. The binding's evaluate() rejects whole sets that contain same-day reviews
// (InvalidInput, measured on 0.5.0), while training takes them and fits the short-term
// parameters on them.
function crossDay(items) {
  return items.filter(it => it.reviews[it.reviews.length - 1][1] > 0)
    .map(it => ({ at: it.at, reviews: it.reviews.filter((r, k) => k === 0 || r[1] > 0) }));
}

function toBinding(b, items) {
  return items.map(it => new b.FSRSBindingItem(it.reviews.map(([rating, dt]) => new b.FSRSBindingReview(rating, dt))));
}

class TrainingError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Fits on the earlier part of the history and compares both models on the later part,
// which neither saw; the candidate itself is then fitted on everything. Runs in the
// training child process (trainWorker.js), never in the server.
async function fit(items, binding) {
  const b = binding || require("@open-spaced-repetition/binding");
  const cut = Math.floor(items.length * (1 - HOLDOUT));
  if (cut < 1 || cut >= items.length) throw new TrainingError("notEnoughData", "too few reviews on separate days");
  const earlier = toBinding(b, items.slice(0, cut)), later = toBinding(b, crossDay(items.slice(cut)));
  if (!later.length) throw new TrainingError("notEnoughData", "no recent reviews on a later day to compare on");
  const opts = { enableShortTerm: true };
  let errorDefault, errorPersonal, w;
  try {
    const early = await b.computeParameters(earlier, opts);
    errorDefault = new b.FSRSBinding(DEFAULT_W).evaluate(later).rmseBins;
    errorPersonal = new b.FSRSBinding(early).evaluate(later).rmseBins;
    w = await b.computeParameters(toBinding(b, items), opts);
  } catch (e) {
    // NotEnoughData: answers exist but too few span more than a day to fit on.
    throw new TrainingError("notEnoughData", String(e && e.message || e));
  }
  if (!validWeights(w) || !isFinite(errorDefault) || !isFinite(errorPersonal))
    throw new TrainingError("notEnoughData", "the optimizer returned no usable parameters");
  return { w, errorDefault, errorPersonal };
}

// The optimizer is native code, and a panic in it aborts whatever process it runs in. It
// runs in a child process so that a bad item costs one failed training, not the server.
const TRAIN_TIMEOUT_MS = 5 * 60 * 1000;
function train(items) {
  const { fork } = require("child_process");
  return new Promise((resolve, reject) => {
    const child = fork(require("path").join(__dirname, "trainWorker.js"), [], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let stderr = "", settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => { child.kill("SIGKILL"); done(reject, new TrainingError("optimizerFailed", "training timed out")); }, TRAIN_TIMEOUT_MS);
    child.stderr.on("data", d => { if (stderr.length < 4000) stderr += d; });
    child.on("message", m => {
      if (m && m.ok) done(resolve, m.fit);
      else done(reject, m && m.code === "unavailable" ? Object.assign(new Error(m.message), { code: "unavailable" })
                                                     : new TrainingError((m && m.code) || "optimizerFailed", m && m.message));
    });
    child.on("error", e => done(reject, e));
    child.on("exit", code => done(reject, new TrainingError("optimizerFailed", "the optimizer exited (" + code + "): " + stderr.slice(0, 300))));
    child.send({ items });
  });
}

module.exports = {
  DEFAULT_RECALL, MIN_RECALL, MAX_RECALL, MIN_REVIEWS, RETRAIN_AFTER, HOLDOUT, DEFAULT_W,
  targetRecall, validWeights, parseModel, schedulerFor, readUser, userScheduler,
  intervalAt, loadByTarget, reviewCount, histories, trainingItems, crossDay, fit, train, TrainingError,
  normalizeTz
};
