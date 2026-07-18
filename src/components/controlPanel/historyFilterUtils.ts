import type { TranscriptionItem as TranscriptionItemType } from "../../types/electron";
import { normalizeEchoDraftSource } from "../../utils/branding";
import { normalizeCleanupTitle } from "../../config/cleanupOutputContract.cjs";

export type ModeFilter = "all" | "insert" | "clipboard" | "file";
export type StatusFilter = "all" | "success" | "delivery_issue" | "error" | "cancelled";

export type HistoryFilters = {
  searchQuery: string;
  modeFilter: ModeFilter;
  statusFilter: StatusFilter;
  providerFilter: string;
};

export function getProviderOptions(history: TranscriptionItemType[]): string[] {
  const providers = new Set<string>();
  for (const item of history) {
    const meta = item.meta || {};
    const provider = normalizeEchoDraftSource(meta.provider || meta.source);
    if (provider) {
      providers.add(String(provider));
    }
  }
  return Array.from(providers).sort((a, b) => a.localeCompare(b));
}

export function filterHistory(
  history: TranscriptionItemType[],
  filters: HistoryFilters
): TranscriptionItemType[] {
  const normalizedQuery = filters.searchQuery.trim().toLowerCase();
  const normalizedProviderFilter = filters.providerFilter.trim().toLowerCase();

  return history.filter((item) => {
    const meta = item.meta || {};
    const provider = String(
      normalizeEchoDraftSource(meta.provider || meta.source || "")
    ).toLowerCase();
    const model = String(normalizeEchoDraftSource(meta.model || "")).toLowerCase();
    const outputMode = String(meta.outputMode || "insert").toLowerCase();
    const status = String(meta.status || "success").toLowerCase();
    const title = normalizeCleanupTitle(meta.title) || "";
    const haystack = [title, item.text || "", item.raw_text || "", provider, model, status, outputMode]
      .join(" ")
      .toLowerCase();

    if (normalizedQuery && !haystack.includes(normalizedQuery)) {
      return false;
    }
    if (filters.modeFilter !== "all" && outputMode !== filters.modeFilter) {
      return false;
    }
    if (filters.statusFilter !== "all" && status !== filters.statusFilter) {
      return false;
    }
    if (normalizedProviderFilter !== "all" && provider !== normalizedProviderFilter) {
      return false;
    }
    return true;
  });
}
