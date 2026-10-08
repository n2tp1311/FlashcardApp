"use strict";

// Child process for lib/memory.js train(): one fit, its result posted back, then exit.

const { fit, TrainingError } = require("./memory");

process.once("message", async ({ items }) => {
  let binding;
  try {
    binding = require("@open-spaced-repetition/binding");
  } catch (e) {
    process.send({ ok: false, code: "unavailable", message: String(e && e.message || e) }, () => process.exit(0));
    return;
  }
  try {
    process.send({ ok: true, fit: await fit(items, binding) }, () => process.exit(0));
  } catch (e) {
    process.send({ ok: false, code: e instanceof TrainingError ? e.code : "optimizerFailed",
                   message: String(e && e.message || e) }, () => process.exit(0));
  }
});
