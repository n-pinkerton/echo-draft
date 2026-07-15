import { sanitizeOpaqueRequestId } from "./diagnosticSanitizers";

const SAFE_META_STRINGS = [
  "sessionId",
  "outputMode",
  "status",
  "source",
  "provider",
  "model",
  "stopReason",
  "stopSource",
] as const;

const SAFE_FIDELITY_REASON_CODES = new Set([
  "added-content-to-empty-input",
  "added-whole-output-quotation",
  "assistant-action-output",
  "attachment-rewrite-risk",
  "critical-token-attachment-change",
  "critical-token-loss",
  "empty-output",
  "high-rewrite-risk",
  "incomplete-workflow-progression",
  "low-content-word-coverage",
  "material-compression",
  "material-expansion",
  "modal-attachment-change",
  "modal-certainty-change",
  "negation-addition",
  "negation-attachment-change",
  "negation-loss",
  "nested-quotation-inference",
  "question-loss",
  "quote-attachment-risk",
  "relation-attachment-change",
  "relation-marker-addition",
  "relation-marker-loss",
  "relation-verb-form-change",
  "request-execution-output",
  "request-modality-change",
  "stance-attachment-change",
  "stance-marker-addition",
  "stance-marker-loss",
  "strict-lexical-sequence-change",
  "strict-significant-token-change",
  "substantive-rewrite-risk",
  "technical-token-attachment-change",
  "technical-token-change",
  "wrapper-leak",
]);

const boundedMetadataString = (value: unknown, maxLength = 128): string | null => {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > maxLength || /[\r\n\u0000-\u001f]/.test(candidate)) {
    return null;
  }
  return candidate;
};

const pickNumbersAndBooleans = (value: unknown): Record<string, number | boolean> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, entry]) =>
        (/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key) && typeof entry === "boolean") ||
        (/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key) &&
          typeof entry === "number" &&
          Number.isFinite(entry) &&
          entry >= 0)
    )
  );
};

const pickFidelityReasonCodes = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string =>
      typeof entry === "string" ? SAFE_FIDELITY_REASON_CODES.has(entry) : false
    )
    .slice(0, 12);
};

export const sanitizeTranscriptionMetaForDiagnostics = (
  value: unknown
): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const meta = value as Record<string, any>;
  const output: Record<string, unknown> = {};

  for (const key of SAFE_META_STRINGS) {
    const safeValue = boundedMetadataString(meta[key]);
    if (safeValue) output[key] = safeValue;
  }
  for (const key of ["pasteSucceeded", "clipboardSucceeded"] as const) {
    if (typeof meta[key] === "boolean") output[key] = meta[key];
  }

  if (meta.delivery && typeof meta.delivery === "object") {
    const reasonCode = boundedMetadataString(meta.delivery.reasonCode, 96);
    output.delivery = {
      ...(boundedMetadataString(meta.delivery.status)
        ? { status: boundedMetadataString(meta.delivery.status) }
        : {}),
      ...(typeof meta.delivery.succeeded === "boolean"
        ? { succeeded: meta.delivery.succeeded }
        : {}),
      ...(reasonCode && /^[A-Z][A-Z0-9_]{0,95}$/.test(reasonCode) ? { reasonCode } : {}),
    };
  }

  if (meta.textMetrics && typeof meta.textMetrics === "object") {
    output.textMetrics = pickNumbersAndBooleans(meta.textMetrics);
  }

  if (meta.cleanup && typeof meta.cleanup === "object") {
    const cleanup = meta.cleanup as Record<string, unknown>;
    const initialFidelityReasons = pickFidelityReasonCodes(cleanup.initialFidelityReasons);
    const retryFidelityReasons = pickFidelityReasonCodes(cleanup.retryFidelityReasons);
    output.cleanup = {
      ...pickNumbersAndBooleans(cleanup),
      ...Object.fromEntries(
        ["status", "fallbackReason", "model", "appliedModel", "provider"]
          .map((key) => [key, boundedMetadataString(cleanup[key])])
          .filter(([, entry]) => Boolean(entry))
      ),
      ...(cleanup.modelSource === "selected" || cleanup.modelSource === "managed"
        ? { modelSource: cleanup.modelSource }
        : {}),
      ...(cleanup.retryDriftEditType === "substitution" ||
      cleanup.retryDriftEditType === "insertion" ||
      cleanup.retryDriftEditType === "deletion"
        ? { retryDriftEditType: cleanup.retryDriftEditType }
        : {}),
      ...(initialFidelityReasons.length ? { initialFidelityReasons } : {}),
      ...(retryFidelityReasons.length ? { retryFidelityReasons } : {}),
      ...(cleanup.metrics && typeof cleanup.metrics === "object"
        ? { metrics: pickNumbersAndBooleans(cleanup.metrics) }
        : {}),
    };
  }

  if (meta.timings && typeof meta.timings === "object") {
    const timings = meta.timings as Record<string, any>;
    const requestId = sanitizeOpaqueRequestId(timings.transcriptionRequestId);
    const requestIds = Array.isArray(timings.transcriptionRequestIds)
      ? timings.transcriptionRequestIds.map(sanitizeOpaqueRequestId).filter(Boolean).slice(0, 4)
      : [];
    const attempts = Array.isArray(timings.transcriptionTransportAttempts)
      ? timings.transcriptionTransportAttempts.slice(0, 4).map((attempt: unknown) => ({
          ...pickNumbersAndBooleans(attempt),
          ...(boundedMetadataString((attempt as any)?.outcome)
            ? { outcome: boundedMetadataString((attempt as any).outcome) }
            : {}),
          ...(sanitizeOpaqueRequestId((attempt as any)?.requestId)
            ? { requestId: sanitizeOpaqueRequestId((attempt as any).requestId) }
            : {}),
        }))
      : [];
    output.timings = {
      ...pickNumbersAndBooleans(timings),
      ...(boundedMetadataString(timings.audioFormat, 64)
        ? { audioFormat: boundedMetadataString(timings.audioFormat, 64) }
        : {}),
      ...(requestId ? { transcriptionRequestId: requestId } : {}),
      ...(requestIds.length ? { transcriptionRequestIds: requestIds } : {}),
      ...(attempts.length ? { transcriptionTransportAttempts: attempts } : {}),
    };
  }

  return output;
};
