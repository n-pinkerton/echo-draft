import { getBaseLanguageCode, validateLanguageForModel } from "../../../utils/languageSupport";
import { invokeCancelableIpc } from "../../../utils/cancelableIpc";
import { getCustomDictionaryArray } from "./customDictionary";
import {
  areTranscriptionsEquivalent,
  classifyDictionaryPromptEcho,
} from "./dictionaryPromptEcho";
import {
  createTranscriptionCancelledError,
  isTranscriptionCancelled,
  throwIfTranscriptionCancelled,
} from "../pipeline/cancellation";

/**
 * Local transcription via IPC to the main process (Whisper.cpp and Parakeet).
 *
 * Keeps AudioManager thin by owning the provider-specific options and post-processing.
 */
export class LocalTranscriber {
  /**
   * @param {{
   *   logger: any,
   *   emitProgress?: (payload: any) => void,
   *   shouldApplyReasoningCleanup?: () => boolean,
   *   getCleanupEnabledOverride?: () => boolean | null,
   *   reasoningCleanupService?: {
   *     processTranscription?: Function,
   *     processTranscriptionWithOutcome?: Function,
   *   },
   *   openAiTranscriber?: { processWithOpenAIAPI: Function }
   * }} deps
   */
  constructor(deps = {}) {
    this.logger = deps.logger;
    this.emitProgress = deps.emitProgress;
    this.shouldApplyReasoningCleanup = deps.shouldApplyReasoningCleanup;
    this.getCleanupEnabledOverride = deps.getCleanupEnabledOverride;
    this.reasoningCleanupService = deps.reasoningCleanupService;
    this.openAiTranscriber = deps.openAiTranscriber;
  }

  async applyReasoningCleanup(rawText, source, runtime = {}) {
    const cleanupEnabledOverride = this.getCleanupEnabledOverride?.() ?? null;
    if (typeof this.reasoningCleanupService?.processTranscriptionWithOutcome === "function") {
      return await this.reasoningCleanupService.processTranscriptionWithOutcome(
        rawText,
        source,
        cleanupEnabledOverride,
        runtime
      );
    }

    const text = await this.reasoningCleanupService.processTranscription(
      rawText,
      source,
      cleanupEnabledOverride,
      runtime
    );
    return {
      text,
      cleanup: {
        requested: true,
        attempted: true,
        applied: true,
        status: text === rawText ? "unchanged" : "applied",
      },
    };
  }

  async processWithLocalWhisper(audioBlob, model = "base", metadata = {}, runtime = {}) {
    const timings = {};
    const signal = runtime?.signal || null;

    try {
      throwIfTranscriptionCancelled(signal);
      const arrayBuffer = await audioBlob.arrayBuffer();
      throwIfTranscriptionCancelled(signal);
      const language = getBaseLanguageCode(localStorage.getItem("preferredLanguage"));
      const options = { model };
      if (language) {
        options.language = language;
      }

      const dictionaryEntries = getCustomDictionaryArray();
      if (dictionaryEntries.length > 0) {
        options.dictionaryEntries = dictionaryEntries;
      }

      const transcriptionStart = performance.now();
      const result = await invokeCancelableIpc(signal, (requestId) =>
        window.electronAPI.transcribeLocalWhisper(arrayBuffer, options, requestId)
      );
      throwIfTranscriptionCancelled(signal);
      if (result.success && result.text) {
        let rawText = result.text;
        const echoClassification =
          dictionaryEntries.length > 0
            ? classifyDictionaryPromptEcho(rawText, dictionaryEntries)
            : "none";

        if (echoClassification === "exact-short") {
          // A short exact match could be either real speech or a prompt echo. Confirm it once with
          // the same local model and audio but no dictionary prompt before allowing fallback.
          const confirmationOptions = { model };
          if (language) confirmationOptions.language = language;
          const confirmation = await invokeCancelableIpc(signal, (requestId) =>
            window.electronAPI.transcribeLocalWhisper(
              arrayBuffer,
              confirmationOptions,
              requestId
            )
          );
          throwIfTranscriptionCancelled(signal);
          if (
            !confirmation.success ||
            !confirmation.text ||
            !areTranscriptionsEquivalent(rawText, confirmation.text)
          ) {
            throw new Error(
              "Local transcription returned only dictionary hints. Please check the microphone and try again."
            );
          }
          rawText = confirmation.text;
        } else if (echoClassification === "likely") {
          throw new Error(
            "Local transcription returned only dictionary hints. Please check the microphone and try again."
          );
        }
        timings.transcriptionProcessingDurationMs = Math.round(
          performance.now() - transcriptionStart
        );
        let cleanedText = rawText;
        let cleanup = null;

        if (this.shouldApplyReasoningCleanup?.()) {
          this.emitProgress?.({ stage: "cleaning", stageLabel: "Cleaning up" });
          const reasoningStart = performance.now();
          const cleanupResult = await this.applyReasoningCleanup(rawText, "local", runtime);
          cleanedText = cleanupResult.text;
          cleanup = cleanupResult.cleanup;
          timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);
        }

        return {
          success: true,
          text: cleanedText || rawText,
          rawText,
          source: "local",
          timings,
          ...(cleanup ? { cleanup } : {}),
        };
      }

      if (result.success === false && result.message === "No audio detected") {
        throw new Error("No audio detected");
      }

      throw new Error(result.message || result.error || "Local Whisper transcription failed");
    } catch (error) {
      if (isTranscriptionCancelled(error, signal)) {
        throw createTranscriptionCancelledError();
      }
      if (error?.message === "No audio detected") {
        throw error;
      }

      const allowOpenAIFallback = localStorage.getItem("allowOpenAIFallback") === "true";
      const isLocalMode = localStorage.getItem("useLocalWhisper") === "true";

      if (allowOpenAIFallback && isLocalMode) {
        try {
          const fallbackResult = await this.openAiTranscriber.processWithOpenAIAPI(
            audioBlob,
            metadata,
            runtime
          );
          return { ...fallbackResult, source: "openai-fallback" };
        } catch (fallbackError) {
          if (isTranscriptionCancelled(fallbackError, signal)) {
            throw createTranscriptionCancelledError();
          }
          throw new Error(
            `Local Whisper failed: ${error.message}. OpenAI fallback also failed: ${fallbackError.message}`
          );
        }
      }

      throw new Error(`Local Whisper failed: ${error.message}`);
    }
  }

  async processWithLocalParakeet(
    audioBlob,
    model = "parakeet-tdt-0.6b-v3",
    metadata = {},
    runtime = {}
  ) {
    const timings = {};
    const signal = runtime?.signal || null;

    try {
      throwIfTranscriptionCancelled(signal);
      const arrayBuffer = await audioBlob.arrayBuffer();
      throwIfTranscriptionCancelled(signal);
      const language = validateLanguageForModel(localStorage.getItem("preferredLanguage"), model);
      const options = { model };
      if (language) {
        options.language = language;
      }

      const transcriptionStart = performance.now();
      const result = await invokeCancelableIpc(signal, (requestId) =>
        window.electronAPI.transcribeLocalParakeet(arrayBuffer, options, requestId)
      );
      throwIfTranscriptionCancelled(signal);
      timings.transcriptionProcessingDurationMs = Math.round(
        performance.now() - transcriptionStart
      );

      if (result.success && result.text) {
        const rawText = result.text;
        let cleanedText = rawText;
        let cleanup = null;

        if (this.shouldApplyReasoningCleanup?.()) {
          this.emitProgress?.({ stage: "cleaning", stageLabel: "Cleaning up" });
          const reasoningStart = performance.now();
          const cleanupResult = await this.applyReasoningCleanup(
            rawText,
            "local-parakeet",
            runtime
          );
          cleanedText = cleanupResult.text;
          cleanup = cleanupResult.cleanup;
          timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);
        }

        return {
          success: true,
          text: cleanedText || rawText,
          rawText,
          source: "local-parakeet",
          timings,
          ...(cleanup ? { cleanup } : {}),
        };
      }

      if (result.success === false && result.message === "No audio detected") {
        throw new Error("No audio detected");
      }

      throw new Error(result.message || result.error || "Parakeet transcription failed");
    } catch (error) {
      if (isTranscriptionCancelled(error, signal)) {
        throw createTranscriptionCancelledError();
      }
      if (error?.message === "No audio detected") {
        throw error;
      }

      const allowOpenAIFallback = localStorage.getItem("allowOpenAIFallback") === "true";
      const isLocalMode = localStorage.getItem("useLocalWhisper") === "true";

      if (allowOpenAIFallback && isLocalMode) {
        try {
          const fallbackResult = await this.openAiTranscriber.processWithOpenAIAPI(
            audioBlob,
            metadata,
            runtime
          );
          return { ...fallbackResult, source: "openai-fallback" };
        } catch (fallbackError) {
          if (isTranscriptionCancelled(fallbackError, signal)) {
            throw createTranscriptionCancelledError();
          }
          throw new Error(
            `Parakeet failed: ${error.message}. OpenAI fallback also failed: ${fallbackError.message}`
          );
        }
      }

      throw new Error(`Parakeet failed: ${error.message}`);
    }
  }
}
