const registry = require("../config/languageRegistry.json");

const LANGUAGE_ENTRIES = Array.isArray(registry.languages) ? registry.languages : [];
const LANGUAGE_BY_CODE = new Map(
  LANGUAGE_ENTRIES.map((entry) => [String(entry.code || "").toLowerCase(), entry])
);
const BASE_LANGUAGE_ENTRIES = new Map();

for (const entry of LANGUAGE_ENTRIES) {
  const code = String(entry.code || "");
  if (!code || code === "auto") continue;
  const base = code.split("-")[0].toLowerCase();
  const existing = BASE_LANGUAGE_ENTRIES.get(base) || [];
  existing.push(entry);
  BASE_LANGUAGE_ENTRIES.set(base, existing);
}

const getLanguageEntry = (value) => {
  const token = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!token) return null;
  return LANGUAGE_BY_CODE.get(token) || null;
};

const getCapabilityEntries = (value) => {
  const token = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!token || token === "auto") return [];
  const exact = LANGUAGE_BY_CODE.get(token);
  if (exact) return [exact];
  return BASE_LANGUAGE_ENTRIES.get(token) || [];
};

const normalizeLanguageCode = (
  value,
  { allowAuto = true, capability = null, baseOnly = false } = {}
) => {
  const token = typeof value === "string" ? value.trim() : "";
  if (!token) return undefined;
  if (token.toLowerCase() === "auto") return allowAuto ? "auto" : undefined;

  const exact = getLanguageEntry(token);
  const candidates = getCapabilityEntries(token);
  if (candidates.length === 0) return undefined;
  if (capability && !candidates.some((entry) => entry[capability] === true)) return undefined;

  const canonical = exact ? String(exact.code) : token.toLowerCase();
  return baseOnly ? canonical.split("-")[0].toLowerCase() : canonical;
};

const requireLanguageCode = (value, options = {}, label = "language") => {
  const token = typeof value === "string" ? value.trim() : "";
  if (!token) return undefined;
  const normalized = normalizeLanguageCode(token, options);
  if (!normalized) throw new Error(`Unsupported ${label}`);
  return normalized;
};

const getLanguageInstruction = (value) => {
  const code = normalizeLanguageCode(value, { allowAuto: true });
  if (!code) return "";
  const entry = getLanguageEntry(code);
  if (typeof entry?.instruction === "string") return entry.instruction;
  return String(registry._genericTemplate || "").replace("{{code}}", code);
};

const buildLanguageSet = (capability) => {
  const values = new Set();
  for (const entry of LANGUAGE_ENTRIES) {
    if (entry[capability] !== true) continue;
    const code = String(entry.code);
    values.add(code);
    values.add(code.split("-")[0].toLowerCase());
  }
  return values;
};

module.exports = {
  ASSEMBLYAI_LANGUAGES: buildLanguageSet("assemblyai"),
  PARAKEET_LANGUAGES: buildLanguageSet("parakeet"),
  WHISPER_LANGUAGES: buildLanguageSet("whisper"),
  getLanguageInstruction,
  normalizeLanguageCode,
  requireLanguageCode,
};
