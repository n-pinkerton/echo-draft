import { installEchoDraftE2E } from "../../utils/branding";
import { isLikelyDictionaryPromptEcho } from "../../helpers/audio/transcription/dictionaryPromptEcho";

export const installE2EHelpers = (deps) => {
  const {
    enabled,
    activeSessionRef,
    latestProgressRef,
    normalizeTriggerPayload,
    onTranscriptionComplete,
    updateStage,
  } = deps;

  if (!enabled || typeof window === "undefined") {
    return () => {};
  }

  const helpers = {
    getProgress: () => latestProgressRef.current,
    setStage: (stage, patch = {}) => {
      updateStage(stage, patch);
      return latestProgressRef.current;
    },
    setActiveSession: (payload = {}) => {
      activeSessionRef.current = normalizeTriggerPayload(payload);
      return activeSessionRef.current;
    },
    simulateTranscriptionComplete: async (resultPatch = {}, sessionPatch = {}) => {
      const session = normalizeTriggerPayload(sessionPatch);
      activeSessionRef.current = session;
      const text =
        typeof resultPatch.text === "string" ? resultPatch.text : String(resultPatch.text ?? "");
      const rawText =
        typeof resultPatch.rawText === "string"
          ? resultPatch.rawText
          : resultPatch.rawText == null
            ? null
            : String(resultPatch.rawText);

      return await onTranscriptionComplete({
        success: true,
        text,
        rawText: rawText || text,
        source: resultPatch.source || "e2e",
        timings: resultPatch.timings || {},
        limitReached: Boolean(resultPatch.limitReached),
        wordsUsed: resultPatch.wordsUsed,
        wordsRemaining: resultPatch.wordsRemaining,
      });
    },
    isLikelyDictionaryPromptEcho: (transcribedText = "", dictionaryEntries = []) =>
      isLikelyDictionaryPromptEcho(transcribedText, dictionaryEntries),
  };

  return installEchoDraftE2E(helpers);
};
