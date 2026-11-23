"use strict";
// The Dashboard's Study charts are drawn over the period pill's window. One with nothing in it
// says so for that window ("No answers in the last 60 days", not "No study data yet" beside a
// history), and it is one row, its name and why (the reason may wrap), rather than a 70px box.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const express = require("express");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
let base, listener, browser;
test.before(async () => {
  await new Promise((ok) => {
    const server = express();
    server.use(express.static(path.join(root, "client")));
    listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); });
  });
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { if (browser) await browser.close(); listener.close(); });

test("empty charts name the period and collapse to one line", async function() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.renderStudyCharts === "function");
    const out = await page.evaluate(() => {
      state.dashPeriod = 60;
      document.getElementById("dash-panel-charts").classList.remove("hidden");
      document.getElementById("screen-dashboard").classList.add("active");
      renderStudyCharts({ days: 60, heatmap: [], weeklyTrend: [], newCardsWeeklyTrend: [], gradeDistribution: [], reviewTimeTrend: [] });
      renderSrsDistribution([], document.getElementById("dash-srs-wrap"));
      return ["dash-trend-wrap", "dash-retention-wrap", "dash-newcards-trend-wrap", "dash-reviewtime-wrap", "dash-heatmap-wrap", "dash-srs-wrap", "dash-grade-wrap"].map((id) => {
        const wrap = document.getElementById(id), card = wrap.closest(".analytics-chart-card");
        const title = card.querySelector(".analytics-chart-title");
        return { text: wrap.textContent, oneLine: card.getBoundingClientRect().height < 80 && Math.abs(wrap.getBoundingClientRect().top - title.getBoundingClientRect().top) < 8,
          title: getComputedStyle(title).fontSize };
      });
    });
    assert.deepEqual(out.map((o) => o.text), [
      "No answers in the last 60 days.", "No answers in the last 60 days.", "No new cards in the last 60 days.",
      "No timed answers in the last 60 days.", "No study in the last 60 days.", "No cards reviewed in the last 60 days.",
      "No graded answers in the last 60 days."]);
    out.forEach((o, i) => assert.equal(o.title, "12px", "title " + i));
    out.forEach((o, i) => assert.ok(o.oneLine, "name and reason share a row: " + o.text));
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("each new empty line exists in both languages and the old ones are gone", function() {
  const app = require("fs").readFileSync(path.join(root, "client", "app.js"), "utf8");
  ["noAnswersIn", "noNewCardsIn", "noTimedIn", "noStudyIn", "noReviewedIn", "noGradedIn"].forEach((k) =>
    assert.equal(app.split('"dashboard.' + k + '":').length - 1, 2, k));
  ["noStudyData", "noCardsInSrs", "noReviewGrades", "noReviewTime"].forEach((k) => assert.doesNotMatch(app, new RegExp("dashboard\\." + k)));
});
