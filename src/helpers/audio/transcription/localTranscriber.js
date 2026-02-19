import { getBaseLanguageCode, validateLanguageForModel } from "../../../utils/languageSupport";
import { getCustomDictionaryPrompt } from "./customDictionary";

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
   *   reasoningCleanupService?: { processTranscription: Function },
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

  async processWithLocalWhisper(audioBlob, model = "base", metadata = {}) {
    const timings = {};

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const language = getBaseLanguageCode(localStorage.getItem("preferredLanguage"));
      const options = { model };
      if (language) {
        options.language = language;
      }

      const dictionaryPrompt = getCustomDictionaryPrompt();
      if (dictionaryPrompt) {
        options.initialPrompt = dictionaryPrompt;
      }

      const transcriptionStart = performance.now();
      const result = await window.electronAPI.transcribeLocalWhisper(arrayBuffer, options);
      timings.transcriptionProcessingDurationMs = Math.round(performance.now() - transcriptionStart);

      if (result.success && result.text) {
        const rawText = result.text;
        let cleanedText = rawText;

        if (this.shouldApplyReasoningCleanup?.()) {
          this.emitProgress?.({ stage: "cleaning", stageLabel: "Cleaning up" });
          const reasoningStart = performance.now();
          cleanedText = await this.reasoningCleanupService.processTranscription(
            rawText,
            "local",
            this.getCleanupEnabledOverride?.() ?? null
          );
          timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);
        }

        return {
          success: true,
          text: cleanedText || rawText,
          rawText,
          source: "local",
          timings,
        };
      }

      if (result.success === false && result.message === "No audio detected") {
        throw new Error("No audio detected");
      }

      throw new Error(result.message || result.error || "Local Whisper transcription failed");
    } catch (error) {
      if (error?.message === "No audio detected") {
        throw error;
      }

      const allowOpenAIFallback = localStorage.getItem("allowOpenAIFallback") === "true";
      const isLocalMode = localStorage.getItem("useLocalWhisper") === "true";

      if (allowOpenAIFallback && isLocalMode) {
        try {
          const fallbackResult = await this.openAiTranscriber.processWithOpenAIAPI(audioBlob, metadata);
          return { ...fallbackResult, source: "openai-fallback" };
        } catch (fallbackError) {
          throw new Error(
            `Local Whisper failed: ${error.message}. OpenAI fallback also failed: ${fallbackError.message}`
          );
        }
      }

      throw new Error(`Local Whisper failed: ${error.message}`);
    }
  }

  async processWithLocalParakeet(audioBlob, model = "parakeet-tdt-0.6b-v3", metadata = {}) {
    const timings = {};

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const language = validateLanguageForModel(localStorage.getItem("preferredLanguage"), model);
      const options = { model };
      if (language) {
        options.language = language;
      }

      const transcriptionStart = performance.now();
      const result = await window.electronAPI.transcribeLocalParakeet(arrayBuffer, options);
      timings.transcriptionProcessingDurationMs = Math.round(performance.now() - transcriptionStart);

      if (result.success && result.text) {
        const rawText = result.text;
        let cleanedText = rawText;

        if (this.shouldApplyReasoningCleanup?.()) {
          this.emitProgress?.({ stage: "cleaning", stageLabel: "Cleaning up" });
          const reasoningStart = performance.now();
          cleanedText = await this.reasoningCleanupService.processTranscription(
            rawText,
            "local-parakeet",
            this.getCleanupEnabledOverride?.() ?? null
          );
          timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);
        }

        return {
          success: true,
          text: cleanedText || rawText,
          rawText,
          source: "local-parakeet",
          timings,
        };
      }

      if (result.success === false && result.message === "No audio detected") {
        throw new Error("No audio detected");
      }

      throw new Error(result.message || result.error || "Parakeet transcription failed");
    } catch (error) {
      if (error?.message === "No audio detected") {
        throw error;
      }

      const allowOpenAIFallback = localStorage.getItem("allowOpenAIFallback") === "true";
      const isLocalMode = localStorage.getItem("useLocalWhisper") === "true";

      if (allowOpenAIFallback && isLocalMode) {
        try {
          const fallbackResult = await this.openAiTranscriber.processWithOpenAIAPI(audioBlob, metadata);
          return { ...fallbackResult, source: "openai-fallback" };
        } catch (fallbackError) {
          throw new Error(
            `Parakeet failed: ${error.message}. OpenAI fallback also failed: ${fallbackError.message}`
          );
        }
      }

      throw new Error(`Parakeet failed: ${error.message}`);
    }
  }
}

