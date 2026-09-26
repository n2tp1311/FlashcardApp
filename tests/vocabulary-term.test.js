const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const path = require("node:path");
const { chromium } = require("playwright");
const { getVocabularySpeechText } = require("../client/vocabulary-term");

let browser;

before(async function() {
  browser = await chromium.launch({ headless: true });
});

after(async function() {
  if (browser) await browser.close();
});

async function renderTerm(term) {
  const page = await browser.newPage();
  await page.setContent('<div id="term"></div>');
  await page.addStyleTag({ path: path.join(__dirname, "../client/style.css") });
  await page.addScriptTag({ path: require.resolve("../client/vocabulary-term.js") });
  const result = await page.evaluate(function(rawTerm) {
    var element = document.getElementById("term");
    var card = { term: rawTerm };
    var split = window.renderVocabularyTerm(card.term, element, function(text, target) {
      target.textContent = text;
    });
    return {
      split: split,
      storedTerm: card.term,
      text: element.textContent,
      headword: element.querySelector(".fc-vocabulary-headword")?.textContent || null,
      ipa: element.querySelector(".fc-vocabulary-ipa")?.textContent || null,
      headwordSize: element.querySelector(".fc-vocabulary-headword") &&
        getComputedStyle(element.querySelector(".fc-vocabulary-headword")).fontSize,
      ipaSize: element.querySelector(".fc-vocabulary-ipa") &&
        getComputedStyle(element.querySelector(".fc-vocabulary-ipa")).fontSize
    };
  }, term);
  await page.close();
  return result;
}

test("separates a trailing IPA for display and preserves the stored term", async function() {
  const result = await renderTerm("resilient /rɪˈzɪliənt/");

  assert.equal(result.split, true);
  assert.equal(result.headword, "resilient");
  assert.equal(result.ipa, "/rɪˈzɪliənt/");
  assert.ok(parseFloat(result.headwordSize) > parseFloat(result.ipaSize));
  assert.equal(result.storedTerm, "resilient /rɪˈzɪliənt/");
  assert.equal(getVocabularySpeechText(result.storedTerm), "resilient");
});

test("keeps terms without trailing IPA in their existing plain display", async function() {
  const result = await renderTerm("resilient");

  assert.equal(result.split, false);
  assert.equal(result.text, "resilient");
  assert.equal(result.headword, null);
  assert.equal(result.ipa, null);
  assert.equal(result.storedTerm, "resilient");
  assert.equal(getVocabularySpeechText(result.storedTerm), "resilient");
});
