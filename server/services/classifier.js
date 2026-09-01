"use strict";

const Anthropic = require("@anthropic-ai/sdk");
const { z } = require("zod");
const { zodOutputFormat } = require("@anthropic-ai/sdk/helpers/zod");
const env = require("../config/env");

const MODEL = "claude-opus-5";
// Claude Opus 5 runs adaptive thinking by default when `thinking` is omitted (unlike
// Opus 4.7/4.8), and max_tokens caps thinking + response text combined — a tight budget
// sized only for the final JSON risks the model truncating mid-thought before it ever
// emits output, surfacing as a spurious "parse_failed" error. Effort "low" keeps thinking
// minimal for what's a simple classification task, and the token budget leaves headroom
// beyond that either way.
const MAX_TOKENS = 2048;
const EFFORT = "low";
// The SDK's default timeout is 10 minutes — fine for a one-off script, but this call sits
// behind a UI button with a single global "is a request pending" flag (see btn-suggest-tags
// in app.js): a hung request blocks the feature for every class, not just the one that
// started it, until it times out. A low-effort classification over a short prompt should
// never legitimately take anywhere near this long.
const REQUEST_TIMEOUT_MS = 45000;
const TagSuggestions = z.object({
  tags: z.array(z.string()).min(1).max(6),
});
// zodOutputFormat walks the schema tree into a JSON-schema object — the schema is a
// module-level constant that never changes per-request, so build this once rather than
// on every suggestTags() call.
const TAG_OUTPUT_FORMAT = zodOutputFormat(TagSuggestions);

// Constructed fresh per call rather than cached: this route is capped at 15 req/hour/user
// (see suggestTagsLimiter in classes.js), so there's no hot-path cost to justify a module-
// level singleton, and a singleton would go stale if ANTHROPIC_API_KEY ever changed at
// runtime without a process restart.
function getClient() {
  if (!env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

// cardTexts: array of plain-text strings already extracted from card content (see
// classes.js's extractCardText) — this module only talks to the model, callers own
// pulling data out of the DB and normalizing/saving the result.
async function suggestTags(cardTexts) {
  const anthropic = getClient();
  if (!anthropic) {
    const err = new Error("ANTHROPIC_API_KEY not configured");
    err.code = "not_configured";
    throw err;
  }
  if (!cardTexts.length) {
    const err = new Error("No card content to classify");
    err.code = "no_content";
    throw err;
  }

  const response = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system:
      "You are tagging a flashcard study set by subject/topic so a student can filter " +
      "their library later. Given a sample of the set's card content, suggest 1-6 short " +
      "tags (single words or short phrases, e.g. \"linear-algebra\", \"organic-chemistry\", " +
      "\"spanish-vocab\", \"exam-prep\") that describe what the set is actually about. " +
      "Prefer specific subject/topic tags over generic ones. Lowercase, no punctuation " +
      "beyond hyphens.",
    messages: [
      { role: "user", content: "Card content:\n\n" + cardTexts.join("\n---\n") },
    ],
    output_config: { effort: EFFORT, format: TAG_OUTPUT_FORMAT },
  }, { timeout: REQUEST_TIMEOUT_MS });

  if (!response.parsed_output) {
    const err = new Error("Model did not return parseable tag suggestions");
    err.code = "parse_failed";
    throw err;
  }
  return response.parsed_output.tags;
}

module.exports = { suggestTags };
