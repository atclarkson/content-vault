const assert = require("assert/strict");

const NON_DECOMPOSING_LETTERS = new Map([
  ["Đ", "D"],
  ["đ", "d"],
  ["Ø", "O"],
  ["ø", "o"],
  ["Ł", "L"],
  ["ł", "l"],
  ["ß", "ss"],
  ["Æ", "Ae"],
  ["æ", "ae"],
  ["Œ", "Oe"],
  ["œ", "oe"],
  ["Þ", "Th"],
  ["þ", "th"],
  ["Ð", "D"],
  ["ð", "d"]
]);

function normalizePlaceName(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmedValue = String(value).trim();

  if (!trimmedValue) {
    return null;
  }

  const replaced = Array.from(trimmedValue, (character) => (
    NON_DECOMPOSING_LETTERS.get(character) || character
  )).join("");

  const normalized = replaced
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || null;
}

function selfCheck() {
  assert.equal(normalizePlaceName("Đà Nẵng"), "Da Nang");
  assert.equal(normalizePlaceName("São Paulo"), "Sao Paulo");
  assert.equal(normalizePlaceName("Zürich"), "Zurich");
  assert.equal(normalizePlaceName("Kraków"), "Krakow");
  assert.equal(normalizePlaceName("東京"), "東京");
  assert.equal(normalizePlaceName(null), null);
}

if (require.main === module) {
  selfCheck();
  console.log("placeNames self-check passed");
}

module.exports = {
  normalizePlaceName
};
