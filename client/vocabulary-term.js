(function(root) {
  "use strict";

  function splitVocabularyTerm(term) {
    if (typeof term !== "string") return null;
    var match = term.match(/^(.+?)\s+\/([^/]+)\/\s*$/);
    if (!match) return null;
    var headword = match[1].trim();
    var ipa = match[2].trim();
    return headword && ipa ? { headword: headword, ipa: ipa } : null;
  }

  function renderVocabularyTerm(term, element, renderText) {
    var parts = splitVocabularyTerm(term);
    if (!parts) {
      renderText(term, element);
      return false;
    }

    element.innerHTML = "";
    var wrapper = document.createElement("div");
    wrapper.className = "fc-vocabulary-term";
    var headword = document.createElement("div");
    headword.className = "fc-vocabulary-headword";
    var ipa = document.createElement("div");
    ipa.className = "fc-vocabulary-ipa";

    renderText(parts.headword, headword);
    ipa.textContent = "/" + parts.ipa + "/";
    wrapper.appendChild(headword);
    wrapper.appendChild(ipa);
    element.appendChild(wrapper);
    return true;
  }

  root.renderVocabularyTerm = renderVocabularyTerm;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { splitVocabularyTerm: splitVocabularyTerm, renderVocabularyTerm: renderVocabularyTerm };
  }
})(typeof window !== "undefined" ? window : globalThis);
