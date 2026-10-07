"use strict";
// Lessons sort by name, numerically: topic 2 before topic 10.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
const start = app.indexOf("\nfunction sortLessons(");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(app.slice(start, app.indexOf("\n}\n", start) + 3), ctx);

test("name sort is numeric and case-insensitive, and reverses", () => {
  const lessons = ["10. Combining", "2. Summarizing", "1. Graphs", "calculator", "Basics"].map((title, i) => ({ id: "l" + i, title }));
  const asc = ctx.sortLessons(lessons, {}, "name", "asc").map((l) => l.title).join("|");
  assert.equal(asc, "1. Graphs|2. Summarizing|10. Combining|Basics|calculator");
  const desc = ctx.sortLessons(lessons, {}, "name", "desc").map((l) => l.title).join("|");
  assert.equal(desc, "calculator|Basics|10. Combining|2. Summarizing|1. Graphs");
});

test("the lesson sort menu offers name", () => {
  const menu = html.slice(html.indexOf('id="lesson-sort-select"'), html.indexOf("</select>", html.indexOf('id="lesson-sort-select"')));
  assert.match(menu, /<option value="name" data-i18n="sort.nameAZ">/);
});
