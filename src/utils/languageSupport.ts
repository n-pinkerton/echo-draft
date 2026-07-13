import {
  ASSEMBLYAI_LANGUAGES,
  PARAKEET_LANGUAGES,
  WHISPER_LANGUAGES,
  getLanguageInstruction as getRegistryLanguageInstruction,
  normalizeLanguageCode,
} from "./languagePolicy.cjs";

const ASSEMBLYAI_UNIVERSAL3_PRO_LANGUAGES = ASSEMBLYAI_LANGUAGES;

const MODEL_LANGUAGE_MAP: Record<string, Set<string>> = {
  "parakeet-tdt-0.6b-v3": PARAKEET_LANGUAGES,
};

export function getBaseLanguageCode(language: string | null | undefined): string | undefined {
  const normalized = normalizeLanguageCode(language, { allowAuto: false, baseOnly: true });
  return normalized || undefined;
}

export function validateLanguageForModel(
  language: string | null | undefined,
  modelId: string
): string | undefined {
  const baseCode = getBaseLanguageCode(language);
  if (!baseCode) return undefined;

  const supportedSet = MODEL_LANGUAGE_MAP[modelId];
  if (!supportedSet) return baseCode;

  return supportedSet.has(baseCode) ? baseCode : undefined;
}

export function getLanguageInstruction(language: string | undefined): string {
  return getRegistryLanguageInstruction(language);
}

export { WHISPER_LANGUAGES, PARAKEET_LANGUAGES, ASSEMBLYAI_UNIVERSAL3_PRO_LANGUAGES };
