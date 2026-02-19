const path = require("path");

const DICTIONARY_SPLIT_REGEX = /[\n,;\t]+/g;

function parseDictionaryWords(input = "") {
  if (typeof input !== "string") {
    return [];
  }
  return input
    .split(DICTIONARY_SPLIT_REGEX)
    .map((word) => word.trim())
    .filter(Boolean);
}

function dedupeDictionaryWords(words = []) {
  const seen = new Set();
  const uniqueWords = [];
  for (const word of words) {
    if (typeof word !== "string") continue;
    const trimmed = word.trim();
    if (!trimmed) continue;
    const normalized = trimmed.toLocaleLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    uniqueWords.push(trimmed);
  }
  return uniqueWords;
}

function stripDictionaryHeader(words = [], filePath = "") {
  if (!Array.isArray(words) || words.length === 0) {
    return [];
  }

  const ext = path.extname(filePath || "").toLowerCase();
  if (ext !== ".csv" && ext !== ".tsv") {
    return words;
  }

  const first = String(words[0] || "")
    .trim()
    .toLowerCase();
  if (first === "word" && words.length > 1) {
    return words.slice(1);
  }

  return words;
}

module.exports = {
  dedupeDictionaryWords,
  parseDictionaryWords,
  stripDictionaryHeader,
};

