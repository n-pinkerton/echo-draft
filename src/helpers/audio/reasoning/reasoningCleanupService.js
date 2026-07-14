import {
  getTrustedCleanupDictionary,
  normalizeCleanupModelId,
  sanitizeProcessedText,
} from "../../../config/prompts";
import {
  assessCleanupFidelity,
  assessStrictCleanupLexicalFidelity,
  applyStrictCleanupTokensToOriginalPunctuation,
  applyTrustedPreferredSpellingAliases,
  CleanupFidelityError,
} from "./cleanupFidelity";
import { repairCleanupOutput } from "./cleanupOutputRepairs";
import { getCustomDictionaryArray } from "../transcription/customDictionary";
import {
  createTranscriptionCancelledError,
  isTranscriptionCancelled,
  throwIfTranscriptionCancelled,
} from "../pipeline/cancellation";

/**
 * Shared cleanup/orchestration around `ReasoningService` for transcript post-processing.
 *
 * AudioManager uses this for both:
 * - non-streaming transcription (OpenAI/local Whisper)
 * - streaming transcription (AssemblyAI) BYOK reasoning mode
 *
 * This service owns the "reasoning availability" cache because it’s expensive to check
 * on every dictation.
 */

export class ReasoningCleanupService {
  /**
   * @param {{
   *   logger: { logReasoning?: Function },
   *   reasoningService: { processText: Function, isAvailable: Function },
   *   cacheTtlMs?: number
   * }} deps
   */
  constructor(deps = {}) {
    this.logger = deps.logger;
    this.reasoningService = deps.reasoningService;
    this.cacheTtlMs = typeof deps.cacheTtlMs === "number" ? deps.cacheTtlMs : 30_000;

    this.availabilityCache = { value: false, expiresAt: 0 };
    this.cachedPreferenceKey = null;
  }

  _getStoredEnabledValue() {
    if (typeof window === "undefined" || !window.localStorage) {
      return "";
    }
    return localStorage.getItem("useReasoningModel") || "";
  }

  _getPreferenceKey(cleanupEnabledOverride, provider = "auto") {
    const storedValue = this._getStoredEnabledValue();
    const enabledKey =
      cleanupEnabledOverride === null
        ? `storage:${storedValue}`
        : `override:${cleanupEnabledOverride}`;
    return `${enabledKey}:provider:${provider || "auto"}`;
  }

  _isReasoningEnabled(cleanupEnabledOverride) {
    const storedValue = this._getStoredEnabledValue();
    return cleanupEnabledOverride !== null
      ? cleanupEnabledOverride
      : storedValue === "true" || (!!storedValue && storedValue !== "false");
  }

  _getReasoningEffort() {
    const storedValue =
      typeof window !== "undefined" && window.localStorage
        ? localStorage.getItem("cleanupReasoningEffort") || ""
        : "";
    return storedValue === "none" || storedValue === "medium" ? storedValue : "low";
  }

  _getPreferredSpellings() {
    // Dictionary entries guide the model and transcription providers, but the
    // fidelity assessor authorizes cleanup substitutions only through its
    // explicit, audited source-to-target alias table.
    return getTrustedCleanupDictionary(getCustomDictionaryArray());
  }

  _getFidelityRetryModel(model) {
    return model;
  }

  _getFidelityRetryReasoningEffort(_retryModel, selectedEffort) {
    return selectedEffort;
  }

  /**
   * Returns whether reasoning cleanup should run AND the service is reachable.
   *
   * @param {boolean|null} cleanupEnabledOverride
   * @returns {Promise<boolean>}
   */
  async isReasoningAvailable(cleanupEnabledOverride, provider = "auto") {
    if (typeof window === "undefined" || !window.localStorage) {
      return false;
    }

    const preferenceKey = this._getPreferenceKey(cleanupEnabledOverride, provider);
    const now = Date.now();
    const cacheValid =
      now < this.availabilityCache.expiresAt && this.cachedPreferenceKey === preferenceKey;

    if (cacheValid) {
      return this.availabilityCache.value;
    }

    const useReasoning = this._isReasoningEnabled(cleanupEnabledOverride);
    this.logger?.logReasoning?.("REASONING_CHECK", {
      useReasoning,
      preferenceKey,
      cleanupEnabledOverride,
      storedValue: this._getStoredEnabledValue(),
    });

    if (!useReasoning) {
      this.availabilityCache = { value: false, expiresAt: now + this.cacheTtlMs };
      this.cachedPreferenceKey = preferenceKey;
      return false;
    }

    try {
      const isAvailable = await this.reasoningService.isAvailable(provider);

      this.logger?.logReasoning?.("REASONING_AVAILABILITY", {
        isAvailable,
        reasoningEnabled: useReasoning,
        finalDecision: useReasoning && isAvailable,
      });

      this.availabilityCache = { value: isAvailable, expiresAt: now + this.cacheTtlMs };
      this.cachedPreferenceKey = preferenceKey;
      return isAvailable;
    } catch (error) {
      this.logger?.logReasoning?.("REASONING_AVAILABILITY_ERROR", {
        error: error?.message || String(error),
        stack: error?.stack,
      });

      this.availabilityCache = { value: false, expiresAt: now + this.cacheTtlMs };
      this.cachedPreferenceKey = preferenceKey;
      return false;
    }
  }

  /**
   * @param {string} text
   * @param {string} model
   * @param {string|null} agentName
   * @param {{signal?: AbortSignal}} runtime
   * @returns {Promise<{text: string, assessment: any, retryCount: number, appliedModel: string}>}
   */
  async processWithReasoningModelResult(text, model, _agentName, runtime = {}) {
    this.logger?.logReasoning?.("CALLING_REASONING_SERVICE", {
      model,
      textLength: text.length,
    });

    const startTime = Date.now();
    const reasoningEffort = this._getReasoningEffort();
    const fidelityOptions = { preferredSpellings: this._getPreferredSpellings() };
    const signal = runtime?.signal || null;
    let retryAttempted = false;
    let attemptedRetryModel = null;
    try {
      throwIfTranscriptionCancelled(signal);
      const preferredSpellings = fidelityOptions.preferredSpellings;
      const firstResult = applyTrustedPreferredSpellingAliases(
        text,
        repairCleanupOutput(
          text,
          sanitizeProcessedText(
            await this.reasoningService.processText(text, model, null, {
              cleanupPromptMode: "preservation-first",
              reasoningEffort,
              ...(signal ? { signal } : {}),
            })
          )
        ),
        preferredSpellings
      );
      throwIfTranscriptionCancelled(signal);
      const firstAssessment = assessCleanupFidelity(text, firstResult, fidelityOptions);

      if (firstAssessment.accepted) {
        const processingTimeMs = Date.now() - startTime;
        this.logger?.logReasoning?.("REASONING_SERVICE_COMPLETE", {
          model,
          processingTimeMs,
          resultLength: firstResult.length,
          retryCount: 0,
          success: true,
        });
        return {
          text: firstResult,
          assessment: firstAssessment,
          retryCount: 0,
          appliedModel: model,
        };
      }

      this.logger?.logReasoning?.("REASONING_FIDELITY_RETRY", {
        model,
        reasons: firstAssessment.reasons,
        metrics: firstAssessment.metrics,
      });

      const retryModel = this._getFidelityRetryModel(model);
      const retryReasoningEffort = this._getFidelityRetryReasoningEffort(
        retryModel,
        reasoningEffort
      );
      retryAttempted = true;
      attemptedRetryModel = retryModel;
      throwIfTranscriptionCancelled(signal);
      const generatedRetryResult = repairCleanupOutput(
        text,
        sanitizeProcessedText(
          await this.reasoningService.processText(text, retryModel, null, {
            cleanupPromptMode: "strict-preservation",
            reasoningEffort: retryReasoningEffort,
            ...(signal ? { signal } : {}),
          })
        )
      );
      throwIfTranscriptionCancelled(signal);
      const generatedRetryLexicalAssessment = assessStrictCleanupLexicalFidelity(
        text,
        generatedRetryResult,
        {
          language:
            typeof localStorage !== "undefined"
              ? localStorage.getItem("preferredLanguage") || "auto"
              : "auto",
        }
      );
      const retryResult = generatedRetryLexicalAssessment.accepted
        ? applyStrictCleanupTokensToOriginalPunctuation(text, generatedRetryResult, {
            language:
              typeof localStorage !== "undefined"
                ? localStorage.getItem("preferredLanguage") || "auto"
                : "auto",
          })
        : generatedRetryResult;
      const retrySemanticAssessment = assessCleanupFidelity(text, retryResult, fidelityOptions);
      // The strict retry is allowed to repair mechanics only. Enforce that
      // contract after sanitization and deterministic repairs so neither the
      // model nor a post-processor can silently add, remove, or reorder words.
      const retryLexicalAssessment = assessStrictCleanupLexicalFidelity(text, retryResult, {
        language:
          typeof localStorage !== "undefined"
            ? localStorage.getItem("preferredLanguage") || "auto"
            : "auto",
      });
      // A token-locked retry cannot repair a source-inherent trailing workflow
      // fragment without violating its lexical contract. Once exact lexical
      // preservation is proven, keep the source-formatted result instead of
      // reporting cleanup failure for the original recognizer's defect.
      const retrySemanticReasons = retrySemanticAssessment.reasons.filter(
        (reason) => reason !== "incomplete-workflow-progression" || !retryLexicalAssessment.accepted
      );
      const retryAssessment = {
        accepted: retrySemanticReasons.length === 0 && retryLexicalAssessment.accepted,
        reasons: Array.from(new Set([...retrySemanticReasons, ...retryLexicalAssessment.reasons])),
        metrics: {
          ...retrySemanticAssessment.metrics,
          ...retryLexicalAssessment.metrics,
        },
      };
      const processingTimeMs = Date.now() - startTime;

      if (!retryAssessment.accepted) {
        this.logger?.logReasoning?.("REASONING_FIDELITY_REJECTED", {
          model,
          retryModel,
          processingTimeMs,
          reasons: retryAssessment.reasons,
          metrics: retryAssessment.metrics,
          retryCount: 1,
        });
        throw new CleanupFidelityError(retryAssessment);
      }

      this.logger?.logReasoning?.("REASONING_SERVICE_COMPLETE", {
        model,
        retryModel,
        retryReasoningEffort,
        sourceSeparatorsRestored: retryResult !== generatedRetryResult,
        processingTimeMs,
        resultLength: retryResult.length,
        retryCount: 1,
        success: true,
      });

      return {
        text: retryResult,
        assessment: retryAssessment,
        retryCount: 1,
        appliedModel: retryModel,
      };
    } catch (error) {
      if (isTranscriptionCancelled(error, signal)) {
        throw createTranscriptionCancelledError();
      }
      if (retryAttempted && error && typeof error === "object") {
        error.cleanupRetryCount = 1;
        error.cleanupRetryModel = attemptedRetryModel;
      }
      const processingTimeMs = Date.now() - startTime;
      this.logger?.logReasoning?.("REASONING_SERVICE_ERROR", {
        model,
        processingTimeMs,
        error: error?.message || String(error),
        stack: error?.stack,
      });
      throw error;
    }
  }

  async processWithReasoningModel(text, model, agentName, runtime = {}) {
    const result = await this.processWithReasoningModelResult(text, model, agentName, runtime);
    return result.text;
  }

  validateCleanupCandidate(originalText, candidateText) {
    const text = repairCleanupOutput(originalText, sanitizeProcessedText(candidateText));
    const assessment = assessCleanupFidelity(originalText, text);
    if (!assessment.accepted) {
      throw new CleanupFidelityError(assessment);
    }
    return { text, assessment };
  }

  /**
   * @param {string} text
   * @param {string} source
   * @param {boolean|null} cleanupEnabledOverride
   * @param {{signal?: AbortSignal}} runtime
   * @returns {Promise<{text: string, cleanup: Record<string, any>}>}
   */
  async processTranscriptionWithOutcome(text, source, cleanupEnabledOverride, runtime = {}) {
    const sourceText = typeof text === "string" ? text : "";
    const normalizedText = sourceText.trim();
    const signal = runtime?.signal || null;
    throwIfTranscriptionCancelled(signal);

    this.logger?.logReasoning?.("TRANSCRIPTION_RECEIVED", {
      source,
      textLength: normalizedText.length,
      timestamp: new Date().toISOString(),
    });

    const storedReasoningModel =
      typeof window !== "undefined" && window.localStorage
        ? localStorage.getItem("reasoningModel") || ""
        : "";
    const reasoningProvider =
      typeof window !== "undefined" && window.localStorage
        ? localStorage.getItem("reasoningProvider") || "auto"
        : "auto";
    const reasoningModel = normalizeCleanupModelId(storedReasoningModel, reasoningProvider);
    const requested = this._isReasoningEnabled(cleanupEnabledOverride);
    const baseOutcome = {
      requested,
      attempted: false,
      applied: false,
      status: requested ? "fallback" : "disabled",
      fallbackReason: requested ? null : "disabled",
      model: reasoningModel || null,
      appliedModel: null,
      provider: reasoningProvider || "auto",
      retryCount: 0,
    };

    if (
      reasoningModel &&
      reasoningModel !== storedReasoningModel &&
      typeof window !== "undefined"
    ) {
      localStorage.setItem("reasoningModel", reasoningModel);
      this.logger?.logReasoning?.("REASONING_MODEL_MIGRATED", {
        from: storedReasoningModel,
        to: reasoningModel,
        provider: reasoningProvider,
      });
    }

    if (!reasoningModel) {
      this.logger?.logReasoning?.("REASONING_SKIPPED", { reason: "No reasoning model selected" });
      return {
        text: requested ? sourceText : normalizedText,
        cleanup: {
          ...baseOutcome,
          status: requested ? "fallback" : "disabled",
          fallbackReason: requested ? "not_configured" : "disabled",
        },
      };
    }

    const useReasoning = await this.isReasoningAvailable(cleanupEnabledOverride, reasoningProvider);
    throwIfTranscriptionCancelled(signal);
    this.logger?.logReasoning?.("REASONING_CHECK", {
      useReasoning,
      reasoningModel,
      reasoningProvider,
    });

    if (!useReasoning || !normalizedText) {
      return {
        text: requested ? sourceText : normalizedText,
        cleanup: {
          ...baseOutcome,
          status: !requested ? "disabled" : normalizedText ? "fallback" : "unchanged",
          fallbackReason: !requested ? "disabled" : normalizedText ? "unavailable" : null,
        },
      };
    }

    try {
      this.logger?.logReasoning?.("SENDING_TO_REASONING", {
        preparedTextLength: normalizedText.length,
        model: reasoningModel,
        provider: reasoningProvider,
      });

      const result = await this.processWithReasoningModelResult(
        normalizedText,
        reasoningModel,
        null,
        runtime
      );
      this.logger?.logReasoning?.("REASONING_SUCCESS", {
        resultLength: result.text.length,
        retryCount: result.retryCount,
        processingTime: new Date().toISOString(),
      });

      const unchanged = result.text === normalizedText;
      return {
        text: result.text,
        cleanup: {
          ...baseOutcome,
          attempted: true,
          applied: true,
          status: unchanged ? "unchanged" : "applied",
          fallbackReason: null,
          retryCount: result.retryCount,
          appliedModel: result.appliedModel || reasoningModel,
          metrics: result.assessment.metrics,
        },
      };
    } catch (error) {
      if (isTranscriptionCancelled(error, signal)) {
        throw createTranscriptionCancelledError();
      }
      this.logger?.logReasoning?.("REASONING_FAILED", {
        error: error?.message || String(error),
        stack: error?.stack,
        fallbackToCleanup: true,
      });

      return {
        // Fallback means cleanup made no accepted change. Preserve the recognizer
        // output byte-for-byte instead of running a sanitizer that can alter its
        // punctuation (for example converting an em dash).
        text: sourceText,
        cleanup: {
          ...baseOutcome,
          attempted: true,
          applied: false,
          status: "fallback",
          fallbackReason:
            error?.code === "CLEANUP_FIDELITY_REJECTED" ? "fidelity_rejected" : "provider_error",
          retryCount:
            error?.cleanupRetryCount === 1 || error?.code === "CLEANUP_FIDELITY_REJECTED" ? 1 : 0,
          ...(error?.assessment?.metrics ? { metrics: error.assessment.metrics } : {}),
        },
      };
    }
  }

  async processTranscription(text, source, cleanupEnabledOverride, runtime = {}) {
    const result = await this.processTranscriptionWithOutcome(
      text,
      source,
      cleanupEnabledOverride,
      runtime
    );
    return result.text;
  }
}
