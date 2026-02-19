export const installE2EHelpers = (deps) => {
  const {
    enabled,
    activeSessionRef,
    audioManagerRef,
    latestProgressRef,
    normalizeTriggerPayload,
    onTranscriptionComplete,
    updateStage,
  } = deps;

  if (!enabled || typeof window === "undefined") {
    return () => {};
  }

  window.__openwhisprE2E = {
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
    isLikelyDictionaryPromptEcho: (transcribedText = "", dictionaryEntries = []) => {
      const manager = audioManagerRef.current;
      if (!manager?.isLikelyDictionaryPromptEcho) {
        return false;
      }
      return manager.isLikelyDictionaryPromptEcho(transcribedText, dictionaryEntries);
    },
  };

  return () => {
    if (typeof window !== "undefined" && window.__openwhisprE2E) {
      delete window.__openwhisprE2E;
    }
  };
};

