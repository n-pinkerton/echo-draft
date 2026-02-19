import { getBaseLanguageCode } from "../../../utils/languageSupport";
import { getCustomDictionaryArray } from "./customDictionary";
import { isLikelyDictionaryPromptEcho } from "./dictionaryPromptEcho";

/**
 * EchoDraft/OpenWhispr cloud transcription client used by AudioManager.
 *
 * Responsibilities:
 * - IPC call to `cloudTranscribe`
 * - dictionary prompt echo guard
 * - optional reasoning/cleanup (cloud or BYOK reasoning)
 */
export class CloudTranscriber {
  /**
   * @param {{
   *   logger: any,
   *   emitProgress?: (payload: any) => void,
   *   withSessionRefresh: (fn: () => Promise<any>) => Promise<any>,
   *   getCleanupEnabledOverride?: () => boolean | null,
   *   reasoningCleanupService?: { processWithReasoningModel: Function },
   * }} deps
   */
  constructor(deps = {}) {
    if (!deps.withSessionRefresh) {
      throw new Error("withSessionRefresh is required");
    }
    this.logger = deps.logger;
    this.emitProgress = deps.emitProgress;
    this.withSessionRefresh = deps.withSessionRefresh;
    this.getCleanupEnabledOverride = deps.getCleanupEnabledOverride;
    this.reasoningCleanupService = deps.reasoningCleanupService;
  }

  async processWithEchoDraftCloud(audioBlob, metadata = {}) {
    if (!navigator.onLine) {
      const err = new Error("You're offline. Cloud transcription requires an internet connection.");
      err.code = "OFFLINE";
      throw err;
    }

    const timings = {};
    const language = getBaseLanguageCode(localStorage.getItem("preferredLanguage"));

    const arrayBuffer = await audioBlob.arrayBuffer();
    const opts = {};
    if (language) opts.language = language;

    const dictionaryEntries = getCustomDictionaryArray();
    const dictionaryPrompt = dictionaryEntries.length > 0 ? dictionaryEntries.join(", ") : null;
    if (dictionaryPrompt) opts.prompt = dictionaryPrompt;

    const transcriptionStart = performance.now();
    const result = await this.withSessionRefresh(async () => {
      const res = await window.electronAPI.cloudTranscribe(arrayBuffer, opts);
      if (!res.success) {
        const err = new Error(res.error || "Cloud transcription failed");
        err.code = res.code;
        throw err;
      }
      return res;
    });
    timings.transcriptionProcessingDurationMs = Math.round(performance.now() - transcriptionStart);

    const rawText = result.text;
    let processedText = rawText;

    if (dictionaryPrompt && isLikelyDictionaryPromptEcho(rawText, dictionaryEntries)) {
      throw new Error(
        "Transcription returned the dictionary prompt (likely no usable audio). Please try again."
      );
    }

    const override = this.getCleanupEnabledOverride?.() ?? null;
    const useReasoningModel =
      override !== null ? override : localStorage.getItem("useReasoningModel") === "true";
    let source = "openwhispr";

    if (useReasoningModel && processedText) {
      this.emitProgress?.({
        stage: "cleaning",
        stageLabel: "Cleaning up",
        provider: "openwhispr",
      });
      const reasoningStart = performance.now();
      const agentName = localStorage.getItem("agentName") || "";
      const cloudReasoningMode = localStorage.getItem("cloudReasoningMode") || "openwhispr";

      try {
        if (cloudReasoningMode === "openwhispr") {
          const reasonResult = await this.withSessionRefresh(async () => {
            const res = await window.electronAPI.cloudReason(processedText, {
              agentName,
              customDictionary: getCustomDictionaryArray(),
              language: localStorage.getItem("preferredLanguage") || "auto",
            });
            if (!res.success) {
              const err = new Error(res.error || "Cloud reasoning failed");
              err.code = res.code;
              throw err;
            }
            return res;
          });

          if (reasonResult.success && reasonResult.text) {
            processedText = reasonResult.text;
            source = "openwhispr-reasoned";
          }
        } else {
          const reasoningModel = localStorage.getItem("reasoningModel") || "";
          if (reasoningModel) {
            const result = await this.reasoningCleanupService.processWithReasoningModel(
              processedText,
              reasoningModel,
              agentName
            );
            if (result) {
              processedText = result;
              source = "openwhispr-byok-reasoned";
            }
          }
        }
      } catch (reasonError) {
        this.logger?.error?.(
          "Cloud reasoning failed, using raw text",
          { error: reasonError?.message || String(reasonError), cloudReasoningMode },
          "reasoning"
        );
      } finally {
        timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);
      }
    }

    return {
      success: true,
      text: processedText,
      rawText,
      source,
      timings,
      limitReached: result.limitReached,
      wordsUsed: result.wordsUsed,
      wordsRemaining: result.wordsRemaining,
    };
  }
}

