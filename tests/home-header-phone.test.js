const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

// The real Home markup and stylesheet with app.js's initHomeHeaderAutoHide alone. On a
// phone the bar was pinned inside the 16px gutter and below the status bar, and the class
// list showed above it and down both sides; it now spans the screen, slides away while
// scrolling down and comes back on a scroll up.
const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "client", "style.css"), "utf8");
const start = app.indexOf("\nfunction initHomeHeaderAutoHide(");
const init = app.slice(start, app.indexOf("\n}\n", start) + 3);

let browser;
before(async function() { browser = await chromium.launch({ headless: true }); });
after(async function() { if (browser) await browser.close(); });

async function home(width, height, opts) {
  const page = await browser.newPage(Object.assign({ viewport: { width, height } }, opts));
  await page.route("**/*.js", (r) => r.abort());
  await page.goto("file://" + path.join(root, "client", "index.html"));
  await page.addStyleTag({ path: path.join(root, "client", "style.css") });
  await page.evaluate(function() {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    document.getElementById("screen-home").classList.add("active");
    document.getElementById("user-nav").classList.remove("hidden");
    const list = document.getElementById("class-list");
    for (let i = 0; i < 30; i++) {
      const c = document.createElement("div");
      c.className = "class-card";
      c.style.height = "120px";
      c.textContent = "Class " + i;
      list.appendChild(c);
    }
    window.getActiveScreen = () => "home";
  });
  await page.addScriptTag({ content: init + "\ninitHomeHeaderAutoHide();" });
  return page;
}

async function scrollTo(page, y) {
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(300);
}
const bar = (page) => page.evaluate(function() {
  const h = document.querySelector("#screen-home .home-header");
  const r = h.getBoundingClientRect();
  const hit = document.elementFromPoint(4, 4);
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: innerWidth,
    away: h.classList.contains("header-away"), corner: !!(hit && h.contains(hit)) };
});

test("on a phone the bar spans the screen, hides scrolling down and returns scrolling up", async function() {
  const page = await home(390, 844, { hasTouch: true, isMobile: true });
  let b = await bar(page);
  assert.equal(b.left, 0);
  assert.equal(b.right, b.width);
  // The buttons stay inside the gutter they had: the hamburger lines up with the cards.
  const edge = await page.evaluate(() => [document.getElementById("btn-sidebar-toggle").getBoundingClientRect().left,
    document.getElementById("class-list").getBoundingClientRect().left]);
  assert.equal(edge[0], edge[1]);

  await scrollTo(page, 600);
  await scrollTo(page, 1200);
  b = await bar(page);
  assert.equal(b.away, true);
  assert.ok(b.bottom <= 0, JSON.stringify(b));

  await scrollTo(page, 1100);
  b = await bar(page);
  assert.equal(b.away, false);
  assert.equal(b.top, 0);
  assert.equal(b.corner, true, "the bar, not a card, is what shows at the top corner: " + JSON.stringify(b));
  await page.close();
});

test("the bar stays while it holds focus or its menu is open", async function() {
  const page = await home(390, 844, { hasTouch: true, isMobile: true });
  await scrollTo(page, 400);
  await page.evaluate(() => document.getElementById("btn-new-class").focus());
  await scrollTo(page, 1200);
  assert.equal((await bar(page)).away, false);

  await page.evaluate(function() {
    document.activeElement.blur();
    document.getElementById("user-dropdown-menu").classList.remove("hidden");
  });
  await scrollTo(page, 1800);
  assert.equal((await bar(page)).away, false);
  await page.close();
});

test("near the top the bar always shows", async function() {
  const page = await home(390, 844, { hasTouch: true, isMobile: true });
  await scrollTo(page, 900);
  await scrollTo(page, 1500);
  assert.equal((await bar(page)).away, true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await scrollTo(page, 20);
  assert.equal((await bar(page)).away, false);
  await page.close();
});

test("on a desktop nothing hides", async function() {
  const page = await home(1200, 900);
  await scrollTo(page, 600);
  await scrollTo(page, 1400);
  assert.equal((await bar(page)).away, false);
  await page.close();
});

test("the phone bar reaches under the status bar, with a backdrop for when it is away", function() {
  const phone = css.slice(css.indexOf("/* ── Mobile: sidebar hidden, hamburger visible"));
  assert.match(phone, /\.home-header \{\n    position: sticky;\n    top: 0;\n    margin: calc\(-1 \* env\(safe-area-inset-top, 0px\)\) calc\(50% - 50vw\) 20px;\n    padding: calc\(14px \+ env\(safe-area-inset-top, 0px\)\) calc\(50vw - 50%\) 14px;/);
  assert.match(phone, /#screen-home\.active::before \{[^}]*position: fixed;[^}]*height: env\(safe-area-inset-top, 0px\);[^}]*background: var\(--bg\);/);
});
