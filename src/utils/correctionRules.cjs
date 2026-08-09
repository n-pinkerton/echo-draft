const MAX_CORRECTION_RULES = 200;
const MAX_CORRECTION_PHRASE_LENGTH = 200;
const MAX_CORRECTION_REPLACEMENT_LENGTH = 500;

const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_]/u;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const areCorrectionPhrasesEquivalent = (left, right) => {
  if (typeof left !== "string" || typeof right !== "string") return false;
  return (
    new RegExp(`^(?:${escapeRegExp(left)})$`, "iu").test(right) &&
    new RegExp(`^(?:${escapeRegExp(right)})$`, "iu").test(left)
  );
};

const normalizeCorrectionRule = (rule, index = 0) => {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return null;
  const sourcePhrase = typeof rule.sourcePhrase === "string" ? rule.sourcePhrase.trim() : "";
  const replacementText =
    typeof rule.replacementText === "string" ? rule.replacementText.trim() : "";
  if (
    !sourcePhrase ||
    !replacementText ||
    sourcePhrase.length > MAX_CORRECTION_PHRASE_LENGTH ||
    replacementText.length > MAX_CORRECTION_REPLACEMENT_LENGTH
  ) {
    return null;
  }
  return {
    id: Number.isSafeInteger(rule.id) && rule.id > 0 ? rule.id : index + 1,
    sourcePhrase,
    replacementText,
    enabled: rule.enabled !== false,
  };
};

const buildRulePattern = (sourcePhrase) => {
  const codePoints = Array.from(sourcePhrase);
  const first = codePoints[0];
  const last = codePoints[codePoints.length - 1];
  const prefix = WORD_CHARACTER.test(first) ? "(?<![\\p{L}\\p{M}\\p{N}_])" : "";
  const suffix = WORD_CHARACTER.test(last) ? "(?![\\p{L}\\p{M}\\p{N}_])" : "";
  return new RegExp(`${prefix}${escapeRegExp(sourcePhrase)}${suffix}`, "giu");
};

const applyCorrectionRules = (text, rules = []) => {
  const input = typeof text === "string" ? text : "";
  if (!input || !Array.isArray(rules) || rules.length === 0) {
    return { text: input, replacements: [] };
  }

  const normalizedRules = rules
    .slice(0, MAX_CORRECTION_RULES)
    .map(normalizeCorrectionRule)
    .filter((rule) => rule?.enabled);
  const matches = [];
  for (const rule of normalizedRules) {
    const pattern = buildRulePattern(rule.sourcePhrase);
    for (const match of input.matchAll(pattern)) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        matchedText: match[0],
        rule,
      });
    }
  }

  matches.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start) ||
      left.rule.id - right.rule.id
  );
  const accepted = [];
  let nextAvailableIndex = 0;
  for (const match of matches) {
    if (match.start < nextAvailableIndex) continue;
    accepted.push(match);
    nextAvailableIndex = match.end;
  }
  if (accepted.length === 0) return { text: input, replacements: [] };

  let output = "";
  let cursor = 0;
  for (const match of accepted) {
    output += input.slice(cursor, match.start);
    output += match.rule.replacementText;
    cursor = match.end;
  }
  output += input.slice(cursor);

  return {
    text: output,
    replacements: accepted.map((match) => ({
      ruleId: match.rule.id,
      sourcePhrase: match.rule.sourcePhrase,
      replacementText: match.rule.replacementText,
      matchedText: match.matchedText,
      start: match.start,
    })),
  };
};

module.exports = {
  MAX_CORRECTION_PHRASE_LENGTH,
  MAX_CORRECTION_REPLACEMENT_LENGTH,
  MAX_CORRECTION_RULES,
  applyCorrectionRules,
  areCorrectionPhrasesEquivalent,
  normalizeCorrectionRule,
};
