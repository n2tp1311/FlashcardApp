const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

// The flashcard screen's buttons, rendered with the real markup and CSS: Show answer filled
// between two arrows before the flip, grades after it, and a card that keeps its size.
const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "client", "style.css"), "utf8");
const start = html.indexOf('<div id="screen-flashcard" class="screen">');
const screen = html.slice(start, html.indexOf("<!-- ===== SCREEN: Quiz", start));

let browser;
before(async function() { browser = await chromium.launch({ headless: true }); });
after(async function() { if (browser) await browser.close(); });

async function render(width, height) {
  const page = await browser.newPage({ viewport: { width: width, height: height } });
  await page.setContent(screen.replace('class="screen"', 'class="screen active"'));
  await page.addStyleTag({ path: path.join(root, "client", "style.css") });
  await page.evaluate(function() {
    document.getElementById("fc-front-content").textContent = "Supervised learning";
    document.getElementById("fc-mark-btns").classList.add("awaiting-reveal");
    ["fc-int-learning", "fc-int-hard", "fc-int-known", "fc-int-easy"].forEach(function(id, i) {
      document.getElementById(id).textContent = ["1 min", "6 min", "10 min", "1d"][i];
    });
  });
  return page;
}

function boxes(page) {
  return page.evaluate(function() {
    function b(id) {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right),
        width: Math.round(r.width), height: Math.round(r.height), visible: getComputedStyle(el).visibility === "visible" && r.width > 0,
        bg: getComputedStyle(el).backgroundColor };
    }
    return { scene: b("fc-scene"), reveal: b("btn-fc-reveal"), prev: b("btn-fc-prev"), next: b("btn-fc-next"),
      known: b("btn-fc-known"), vh: innerHeight, scroll: document.documentElement.scrollHeight - innerHeight };
  });
}

function flip(page) {
  return page.evaluate(function() { document.getElementById("fc-mark-btns").classList.remove("awaiting-reveal"); });
}

test("before the flip a phone shows one row: arrow, filled Show answer, arrow", async function() {
  const page = await render(390, 844);
  const b = await boxes(page);
  assert.equal(b.scroll, 0, "fits without scrolling");
  assert.ok(Math.abs(b.prev.top - b.reveal.top) < 2 && Math.abs(b.next.top - b.reveal.top) < 2, JSON.stringify(b));
  assert.ok(b.prev.right <= b.reveal.left && b.reveal.right <= b.next.left, "arrows either side");
  assert.ok(b.vh - b.reveal.bottom < 30, "at the bottom, under the thumb");
  assert.ok(b.reveal.height >= 48 && b.prev.width >= 44 && b.prev.height >= 44, "finger-sized targets");
  assert.notEqual(b.reveal.bg, "rgba(0, 0, 0, 0)");
  assert.equal(b.known.visible, false, "grades wait for the flip");
  await page.close();
});

test("flipping keeps the card the same size on a phone, and the grades take the bottom", async function() {
  const page = await render(390, 844);
  const front = await boxes(page);
  await flip(page);
  const back = await boxes(page);
  assert.equal(back.scene.height, front.scene.height, "the card must not shrink mid-flip");
  assert.equal(back.reveal.visible, false);
  assert.ok(back.known.visible && back.vh - back.known.bottom < 30, JSON.stringify(back.known));
  assert.ok(back.prev.bottom <= back.known.top, "arrows above the grades, away from the thumb");
  assert.ok(back.prev.width >= 44 && back.prev.height >= 44);
  await page.close();
});

test("on a phone the card grows into the free height instead of leaving a gap", async function() {
  const short = await render(390, 700);
  const tall = await render(390, 900);
  const a = await boxes(short), b = await boxes(tall);
  assert.ok(b.scene.height - a.scene.height >= 190, JSON.stringify([a.scene, b.scene]));
  await short.close(); await tall.close();
});

test("desktop keeps the one row before the flip, with room between card and buttons", async function() {
  const page = await render(1200, 800);
  const b = await boxes(page);
  assert.ok(Math.abs(b.prev.top - b.reveal.top) < 2 && b.prev.right <= b.reveal.left && b.reveal.right <= b.next.left, JSON.stringify(b));
  assert.ok(b.reveal.top - b.scene.bottom >= 12, "not touching the card");
  await page.close();
});

test("the dot row is gone, and the arrows are named for screen readers", function() {
  assert.doesNotMatch(html, /fc-dots/);
  assert.doesNotMatch(css, /\.fc-dot/);
  assert.doesNotMatch(app, /renderFcDots/);
  assert.match(html, /id="btn-fc-prev"[^>]*data-i18n-aria="study\.prevCard"/);
  assert.match(app, /nextBtn\.setAttribute\("aria-label", t\(last \? "study\.finish" : "study\.nextCard"\)\)/);
  assert.equal((app.match(/"study\.nextCard":/g) || []).length, 2, "English and Vietnamese");
});

test("an empty memory strip stays hidden until the first answer", function() {
  assert.match(app, /var empty = !!strip && !Object\.keys\(strip\.entries\)\.length && !strip\.lastNotDue;/);
  assert.match(app, /var show = !!strip && !empty && IS_SERVER/);
});
