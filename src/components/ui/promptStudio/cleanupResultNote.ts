import { getReasoningModelLabel } from "../../../models/ModelRegistry";
import { cleanupAppliedPreferredSpelling } from "../../../utils/cleanupOutcome";

type CleanupResultSummary = {
  status?: string;
  fallbackReason?: string | null;
  retryCount?: number;
  retryDriftRecovered?: boolean;
  appliedModel?: string | null;
  preferredSpellingApplied?: boolean;
  metrics?: Record<string, unknown>;
} | null;

export function getCleanupResultNote(cleanup: CleanupResultSummary): string {
  if (cleanup?.status === "fallback") {
    if (cleanupAppliedPreferredSpelling(cleanup)) {
      return "Cleanup was not applied; the recognizer wording was kept with a verified dictionary spelling correction.";
    }
    if (cleanup.fallbackReason === "fidelity_rejected") {
      return (cleanup.retryCount || 0) > 0
        ? "Both cleanup attempts failed preservation checks, so the original text was kept."
        : "Cleanup failed preservation checks, so the original text was kept.";
    }
    if (cleanup.fallbackReason === "not_configured") {
      return "Cleanup is not configured, so the original text was kept.";
    }
    if (cleanup.fallbackReason === "unavailable") {
      return "Cleanup is unavailable, so the original text was kept.";
    }
    if (cleanup.fallbackReason === "provider_error") {
      return "The cleanup request failed, so the original text was kept.";
    }
    return "Cleanup could not complete, so the original text was kept.";
  }

  if (cleanup?.retryDriftRecovered === true || cleanup?.metrics?.retryDriftRecovered === true) {
    return cleanupAppliedPreferredSpelling(cleanup)
      ? "The safety retry changed one word and was discarded; the recognizer wording was kept with a verified dictionary spelling correction."
      : "The safety retry changed one word and was discarded, so the trusted source wording was kept.";
  }

  if ((cleanup?.retryCount || 0) > 0 && cleanup?.appliedModel) {
    return `The strict ${getReasoningModelLabel(cleanup.appliedModel)} safety retry preserved every input word in order; the retry result was accepted.`;
  }

  if (cleanup?.status === "unchanged") {
    return "The production cleanup path found no safe wording change to apply.";
  }

  return "Processed with the same preservation and fidelity checks as dictation.";
}
