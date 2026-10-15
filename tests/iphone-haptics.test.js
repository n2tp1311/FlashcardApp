const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { webkit } = require("playwright");

// iPhone haptics: iOS Safari has no navigator.vibrate, so haptic() clicks a hidden
// <input switch>'s label, which plays a system tick on iOS 18+. WebKit here can't tick,
// so these check what can be checked off a phone: how many toggles, and no side effects.
const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
function fn(name) {
  const start = app.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}
const patterns = app.slice(app.indexOf("var HAPTIC_PATTERNS"), app.indexOf("};", app.indexOf("var HAPTIC_PATTERNS")) + 2);

const harness = `
var state = { haptics: true };
var IPHONE_TAPS = true, iphoneTapLabel = null;
${patterns}
${fn("iphoneTaps")}${fn("iphoneTap")}${fn("haptic")}
var toggles = 0, outside = 0;
document.addEventListener("click", function() { outside++; });
document.body.innerHTML = '<input id="answer">';
`;

let browser;
before(async () => { browser = await webkit.launch({ headless: true }); });
after(async () => { if (browser) await browser.close(); });

async function page() {
  const p = await browser.newPage();
  await p.setContent("<!doctype html><body></body>");
  await p.addScriptTag({ content: harness });
  await p.evaluate(() => { haptic("tick"); document.querySelector("input[switch]").addEventListener("change", () => toggles++); toggles = 0; outside = 0; });
  return p;
}

test("each pulse of a pattern is one switch toggle, and none reach document click handlers", async () => {
  const p = await page();
  assert.equal(await p.evaluate(() => typeof navigator.vibrate), "undefined", "WebKit, like iOS, has no Vibration API");
  await p.evaluate(() => haptic("success"));
  assert.equal(await p.evaluate(() => toggles), 1);
  await p.evaluate(() => haptic("error"));
  await p.waitForTimeout(150);
  assert.equal(await p.evaluate(() => toggles), 3);
  await p.evaluate(() => haptic("complete"));
  await p.waitForTimeout(250);
  assert.equal(await p.evaluate(() => toggles), 6);
  assert.equal(await p.evaluate(() => outside), 0, "an open menu must not close on a tick");
  assert.equal(await p.evaluate(() => document.querySelectorAll("input[switch]").length), 1, "one reused switch");
  const hidden = await p.evaluate(() => { const l = document.querySelector("input[switch]").parentElement; return [l.getAttribute("aria-hidden"), l.getBoundingClientRect().right <= 0]; });
  assert.deepEqual(hidden, ["true", true]);
  await p.close();
});

test("the tick leaves focus in a typed answer, and the setting turns it off", async () => {
  const p = await page();
  await p.focus("#answer");
  await p.evaluate(() => haptic("error"));
  await p.waitForTimeout(150);
  assert.equal(await p.evaluate(() => document.activeElement.id), "answer");
  await p.evaluate(() => { state.haptics = false; toggles = 0; haptic("success"); haptic("complete"); });
  await p.waitForTimeout(250);
  assert.equal(await p.evaluate(() => toggles), 0);
  await p.close();
});

test("Android keeps the Vibration API; iPad and desktop get no ticks", async () => {
  const p = await page();
  const r = await p.evaluate(() => { var got; navigator.vibrate = function(x) { got = x; return true; }; toggles = 0; haptic("error"); return { got, toggles }; });
  assert.deepEqual(r, { got: [12, 70, 12], toggles: 0 });
  assert.match(app, /var IPHONE_TAPS = \/iPhone\|iPod\/\.test\(navigator\.userAgent\);/);
  assert.match(app, /pref-haptics-hint"\)\.classList\.toggle\("hidden", !!navigator\.vibrate \|\| IPHONE_TAPS\)/);
  await p.close();
});
