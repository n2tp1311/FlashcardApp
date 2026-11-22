const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

// The quiz screen without its toolbar row, rendered with the real markup, CSS and menu code.
const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");

function extract(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "missing " + name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}
const quizStart = html.indexOf('<div id="screen-quiz" class="screen">');
const quiz = html.slice(quizStart, html.indexOf('<div id="quiz-options"', quizStart)) + "</div></div>";

let browser;
before(async function() { browser = await chromium.launch({ headless: true }); });
after(async function() { if (browser) await browser.close(); });

async function render(width) {
  const page = await browser.newPage({ viewport: { width: width, height: 700 } });
  await page.setContent('<div style="padding:0 16px">' + quiz.replace('class="screen"', 'class="screen active"') + "</div>");
  await page.addStyleTag({ path: path.join(root, "client", "style.css") });
  await page.addScriptTag({ content: extract("registerDropdown") + extract("closeAllDropdowns") +
    'document.addEventListener("click", closeAllDropdowns);' +
    'registerDropdown("btn-quiz-settings", "quiz-settings-menu");' +
    'registerDropdown("btn-quiz-card-menu", "quiz-card-menu");' +
    'document.getElementById("quiz-settings-menu").addEventListener("click", function(e) { e.stopPropagation(); });' +
    'document.getElementById("quiz-question").textContent = "Doubly robust score stays unbiased when one model is right";' });
  return page;
}

function box(page, sel) {
  return page.evaluate(function(sel) {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: document.documentElement.clientWidth,
      shown: getComputedStyle(document.querySelector(sel)).display !== "none" };
  }, sel);
}

test("on a phone the header keeps Exit, progress, score and settings on one row", async function() {
  const page = await render(390);
  const exit = await box(page, "#btn-quiz-back");
  const gear = await box(page, "#btn-quiz-settings");
  const score = await box(page, "#quiz-score-display");
  assert.ok(gear.right <= gear.vw, JSON.stringify(gear));
  assert.ok(Math.abs(gear.top - exit.top) < 12 && Math.abs(score.top - exit.top) < 12, JSON.stringify({ exit, gear, score }));
  assert.ok(gear.right - gear.left >= 40, "a finger-sized target");
  await page.close();
});

test("each menu opens inside the screen, and the settings stay open while changed", async function() {
  for (const width of [390, 1200]) {
    const page = await render(width);
    await page.click("#btn-quiz-settings");
    const menu = await box(page, "#quiz-settings-menu");
    assert.ok(menu.shown && menu.left >= 0 && menu.right <= menu.vw, JSON.stringify(menu));
    assert.equal(await page.getAttribute("#btn-quiz-settings", "aria-expanded"), "true");
    await page.click("#btn-quiz-layout");
    assert.equal((await box(page, "#quiz-settings-menu")).shown, true, "a toggle keeps the menu open");

    await page.click("#btn-quiz-card-menu");
    assert.equal((await box(page, "#quiz-settings-menu")).shown, false, "one menu at a time");
    const cardMenu = await box(page, "#quiz-card-menu");
    assert.ok(cardMenu.shown && cardMenu.left >= 0 && cardMenu.right <= cardMenu.vw, JSON.stringify(cardMenu));
    await page.click("#btn-quiz-edit-card");
    assert.equal((await box(page, "#quiz-card-menu")).shown, false, "a card action closes its menu");
    assert.equal(await page.getAttribute("#btn-quiz-card-menu", "aria-expanded"), "false");
    await page.close();
  }
});

test("a new question closes a menu left open", function() {
  const start = app.indexOf("\nfunction renderQuizCard(");
  assert.match(app.slice(start, start + 200), /closeAllDropdowns\(\);/);
});

test("the corner menu does not cover the question", async function() {
  const page = await render(390);
  const more = await box(page, "#btn-quiz-card-menu");
  const q = await box(page, "#quiz-question");
  assert.ok(more.right <= q.left || more.bottom <= q.top, JSON.stringify({ more, q }));
  await page.close();
});

// The flashcard screen: Shuffle and the card actions share one ⋯ in the header.
const fcStart = html.indexOf('<div id="screen-flashcard" class="screen">');
const fcScreen = html.slice(fcStart, html.indexOf("<!-- ===== SCREEN: Quiz", fcStart));

test("the flashcard screen has no toolbar row; its ⋯ holds Shuffle, Edit, Report, then Delete", function() {
  assert.doesNotMatch(fcScreen, /fc-toolbar/);
  const header = fcScreen.slice(0, fcScreen.indexOf("</header>"));
  assert.match(header, /id="btn-fc-menu"[^>]*aria-controls="fc-card-menu"[\s\S]*id="btn-fc-shuffle"[\s\S]*id="btn-fc-edit-card"[\s\S]*id="btn-fc-flag-card"[\s\S]*dropdown-divider[\s\S]*id="btn-fc-delete-card"/);
  assert.match(app, /registerDropdown\("btn-fc-menu", "fc-card-menu"\);/);
  assert.match(app, /"btn-fc-menu", "btn-fc-shuffle", "btn-fc-edit-card"/, "locked with them during the retype drill");
  const start = app.indexOf("\nfunction renderFlashcard(");
  assert.match(app.slice(start, start + 200), /closeAllDropdowns\(\);/);
  assert.match(app, /e\.key === "Escape" && document\.querySelector\("#screen-flashcard \.dropdown-menu:not\(\.hidden\)"\)\) closeAllDropdowns\(\);/);
});

test("the report label is short", function() {
  assert.match(app, /"flag\.button": "Report this card",/);
  assert.match(app, /"flag\.button": "Báo lỗi thẻ",/);
});

test("on a phone the flashcard header fits and its menu opens inside the screen", async function() {
  const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
  await page.setContent('<div style="padding:0 16px">' + fcScreen.replace('class="screen"', 'class="screen active"') + "</div>");
  await page.addStyleTag({ path: path.join(root, "client", "style.css") });
  await page.addScriptTag({ content: extract("registerDropdown") + extract("closeAllDropdowns") +
    'document.addEventListener("click", closeAllDropdowns); registerDropdown("btn-fc-menu", "fc-card-menu");' });
  const exit = await box(page, "#btn-fc-back");
  const more = await box(page, "#btn-fc-menu");
  assert.ok(more.right <= more.vw && Math.abs(more.top - exit.top) < 12, JSON.stringify({ exit, more }));
  await page.click("#btn-fc-menu");
  const menu = await box(page, "#fc-card-menu");
  assert.ok(menu.shown && menu.left >= 0 && menu.right <= menu.vw, JSON.stringify(menu));
  await page.click("#btn-fc-edit-card");
  assert.equal((await box(page, "#fc-card-menu")).shown, false, "an action closes the menu");
  await page.close();
});
