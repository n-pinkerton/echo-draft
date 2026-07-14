type CleanupOutcomeLike = {
  preferredSpellingApplied?: unknown;
  metrics?: Record<string, unknown> | null;
} | null;

/**
 * Handles both the explicit flag written by current builds and the metric kept
 * by early 1.4.10 candidates, so history copy stays truthful across upgrades.
 */
export const cleanupAppliedPreferredSpelling = (cleanup: CleanupOutcomeLike): boolean => {
  if (typeof cleanup?.preferredSpellingApplied === "boolean") {
    return cleanup.preferredSpellingApplied;
  }
  return (
    typeof cleanup?.metrics?.preferredSpellingCorrectionCount === "number" &&
    cleanup.metrics.preferredSpellingCorrectionCount > 0
  );
};
