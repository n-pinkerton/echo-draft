import {
  getTrustedCleanupDictionary,
  normalizeCleanupModelId,
  sanitizeProcessedText,
} from "../../../config/prompts";
import {
  assessCleanupFidelity,
  assessCleanupUsability,
  applyTrustedPreferredSpellingAliases,
  CleanupFidelityError,
} from "./cleanupFidelity";
import { getCustomDictionaryArray } from "../transcription/customDictionary";
import {
  createTranscriptionCancelledError,
  isTranscriptionCancelled,
  throwIfTranscriptionCancelled,
} from "../pipeline/cancellation";

const buildFidelityRepairPacket = (originalTranscript, rejectedCleanup, rejectionReasons) =>
  JSON.stringify({
    originalTranscript,
    rejectedCleanup,
    rejectionReasons: Array.isArray(rejectionReasons)
      ? rejectionReasons.filter((reason) => typeof reason === "string")
      : [],
  });

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
    return storedValue === "low" || storedValue === "medium" ? storedValue : "none";
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
   * @returns {Promise<{text: string, assessment: any, retryCount: number, appliedModel: string|null, retryDriftRecovered?: boolean, retryDriftEditType?: "substitution"|"insertion"|"deletion", initialFidelityReasons?: string[], retryFidelityReasons?: string[]}>}
   */
  async processWithReasoningModelResult(text, model, _agentName, runtime = {}) {
    this.logger?.logReasoning?.("CALLING_REASONING_SERVICE", {
      model,
      textLength: text.length,
    });

    const startTime = Date.now();
    const reasoningEffort = this._getReasoningEffort();
    const fidelityOptions = { preferredSpellings: this._getPreferredSpellings() };
    const preferredSourceCandidate = applyTrustedPreferredSpellingAliases(
      text,
      text,
      fidelityOptions.preferredSpellings
    );
    const preferredSourceAssessment = assessCleanupFidelity(
      text,
      preferredSourceCandidate,
      fidelityOptions
    );
    // The alias helper itself is the authorization boundary: it only emits an
    // occurrence-bound, dictionary-backed person-name spelling repair. Prepare
    // that source before asking the model to edit it so ordinary punctuation or
    // filler changes cannot make token-count alignment suppress the name fix.
    const trustedBaselineText = preferredSourceAssessment.accepted
      ? preferredSourceCandidate
      : text;
    const modelInputText = trustedBaselineText;
    const preferredSpellingCorrectionCount = preferredSourceAssessment.accepted
      ? preferredSourceAssessment.metrics.preferredSpellingCorrectionCount || 0
      : 0;
    const includePreferredSpellingMetrics = (assessment) => ({
      ...assessment,
      metrics: {
        ...assessment.metrics,
        preferredSpellingCorrectionCount:
          (assessment.metrics.preferredSpellingCorrectionCount || 0) +
          preferredSpellingCorrectionCount,
      },
    });
    const signal = runtime?.signal || null;
    let retryAttemptCount = 0;
    let attemptedRetryModel = null;
    try {
      throwIfTranscriptionCancelled(signal);
      const preferredSpellings = fidelityOptions.preferredSpellings;
      const firstResult = applyTrustedPreferredSpellingAliases(
        modelInputText,
        sanitizeProcessedText(
          await this.reasoningService.processText(modelInputText, model, null, {
            cleanupPromptMode: "preservation-first",
            reasoningEffort,
            ...(signal ? { signal } : {}),
          })
        ),
        preferredSpellings
      );
      throwIfTranscriptionCancelled(signal);
      // The recognizer transcript remains the trust baseline apart from an
      // independently authorized dictionary spelling. Quote-input preparation
      // may guide the model, but never becomes the final fidelity baseline.
      const firstAssessment = includePreferredSpellingMetrics(
        assessCleanupUsability(trustedBaselineText, firstResult, fidelityOptions)
      );

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
      retryAttemptCount = 1;
      attemptedRetryModel = retryModel;
      throwIfTranscriptionCancelled(signal);
      const retryPacket = buildFidelityRepairPacket(
        trustedBaselineText,
        firstResult,
        firstAssessment.reasons
      );
      const retryResult = applyTrustedPreferredSpellingAliases(
        trustedBaselineText,
        sanitizeProcessedText(
          await this.reasoningService.processText(retryPacket, retryModel, null, {
            cleanupPromptMode: "fidelity-repair",
            reasoningEffort: retryReasoningEffort,
            ...(signal ? { signal } : {}),
          })
        ),
        preferredSpellings
      );
      throwIfTranscriptionCancelled(signal);
      const retryAssessment = {
        ...includePreferredSpellingMetrics(
          assessCleanupUsability(trustedBaselineText, retryResult, fidelityOptions)
        ),
        initialFidelityReasons: firstAssessment.reasons,
      };
      const processingTimeMs = Date.now() - startTime;

      if (!retryAssessment.accepted) {
        this.logger?.logReasoning?.("REASONING_FIDELITY_REJECTED", {
          model,
          retryModel,
          processingTimeMs,
          reasons: retryAssessment.reasons,
          advisoryReasons: retryAssessment.advisoryReasons,
          metrics: retryAssessment.metrics,
          retryCount: 1,
        });
        throw new CleanupFidelityError(retryAssessment);
      }

      this.logger?.logReasoning?.("REASONING_SERVICE_COMPLETE", {
        model,
        retryModel,
        retryReasoningEffort,
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
        initialFidelityReasons: firstAssessment.reasons,
        retryFidelityReasons: retryAssessment.reasons,
      };
    } catch (error) {
      if (isTranscriptionCancelled(error, signal)) {
        throw createTranscriptionCancelledError();
      }
      if (retryAttemptCount > 0 && error && typeof error === "object") {
        error.cleanupRetryCount = retryAttemptCount;
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
    const text = sanitizeProcessedText(candidateText);
    // Managed cleanup uses the same objective usability boundary as local
    // cleanup. Broad linguistic diagnostics must never discard fluent model
    // output merely because it was rewritten or punctuated differently.
    const assessment = assessCleanupUsability(originalText, text);
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
      ...(reasoningModel ? { modelSource: "selected" } : {}),
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
      const retryDriftRecovered = result.retryDriftRecovered === true;
      const preferredSpellingApplied =
        typeof result.assessment.metrics.preferredSpellingCorrectionCount === "number" &&
        result.assessment.metrics.preferredSpellingCorrectionCount > 0 &&
        !unchanged;
      return {
        text: result.text,
        cleanup: {
          ...baseOutcome,
          attempted: true,
          applied: retryDriftRecovered ? false : true,
          status: retryDriftRecovered || unchanged ? "unchanged" : "applied",
          fallbackReason: null,
          retryCount: result.retryCount,
          appliedModel: retryDriftRecovered ? null : result.appliedModel || reasoningModel,
          retryDriftRecovered,
          ...(result.retryDriftEditType ? { retryDriftEditType: result.retryDriftEditType } : {}),
          ...(Array.isArray(result.initialFidelityReasons)
            ? { initialFidelityReasons: result.initialFidelityReasons }
            : {}),
          ...(Array.isArray(result.retryFidelityReasons)
            ? { retryFidelityReasons: result.retryFidelityReasons }
            : {}),
          preferredSpellingApplied,
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

      const preferredSpellings = this._getPreferredSpellings();
      const preferredFallbackCandidate = applyTrustedPreferredSpellingAliases(
        sourceText,
        sourceText,
        preferredSpellings
      );
      const preferredFallbackAssessment = assessCleanupFidelity(
        sourceText,
        preferredFallbackCandidate,
        { preferredSpellings }
      );
      const preferredFallbackText = preferredFallbackAssessment.accepted
        ? preferredFallbackCandidate
        : sourceText;
      const preferredSpellingCorrectionCount =
        preferredFallbackAssessment.accepted && preferredFallbackText !== sourceText
          ? preferredFallbackAssessment.metrics.preferredSpellingCorrectionCount || 0
          : 0;
      const preferredSpellingApplied = preferredSpellingCorrectionCount > 0;
      const errorMetrics = error?.assessment?.metrics || null;
      const fallbackMetrics =
        errorMetrics || preferredSpellingApplied
          ? {
              ...(errorMetrics || {}),
              ...(preferredSpellingApplied
                ? {
                    preferredSpellingCorrectionCount: Math.max(
                      errorMetrics?.preferredSpellingCorrectionCount || 0,
                      preferredSpellingCorrectionCount
                    ),
                  }
                : {}),
            }
          : null;

      return {
        // Model cleanup made no accepted change. Preserve the recognizer output
        // byte-for-byte except for an independently authorized, dictionary-backed
        // person-name spelling repair. Do not run a general sanitizer here because
        // it can alter punctuation (for example converting an em dash).
        text: preferredSpellingApplied ? preferredFallbackText : sourceText,
        cleanup: {
          ...baseOutcome,
          attempted: true,
          applied: false,
          status: "fallback",
          fallbackReason:
            error?.code === "CLEANUP_FIDELITY_REJECTED" ? "fidelity_rejected" : "provider_error",
          retryCount:
            Number.isInteger(error?.cleanupRetryCount) && error.cleanupRetryCount > 0
              ? error.cleanupRetryCount
              : error?.code === "CLEANUP_FIDELITY_REJECTED"
                ? 1
                : 0,
          ...(Array.isArray(error?.assessment?.initialFidelityReasons)
            ? { initialFidelityReasons: error.assessment.initialFidelityReasons }
            : {}),
          ...(Array.isArray(error?.assessment?.retryFidelityReasons)
            ? { retryFidelityReasons: error.assessment.retryFidelityReasons }
            : {}),
          preferredSpellingApplied,
          ...(fallbackMetrics ? { metrics: fallbackMetrics } : {}),
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
