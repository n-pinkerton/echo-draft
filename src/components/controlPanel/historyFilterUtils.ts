import type { TranscriptionItem as TranscriptionItemType } from "../../types/electron";

export type ModeFilter = "all" | "insert" | "clipboard" | "file";
export type StatusFilter = "all" | "success" | "error" | "cancelled";

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
    const provider = meta.provider || meta.source;
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
    const provider = String(meta.provider || meta.source || "").toLowerCase();
    const model = String(meta.model || "").toLowerCase();
    const outputMode = String(meta.outputMode || "insert").toLowerCase();
    const status = String(meta.status || "success").toLowerCase();
    const haystack = [item.text || "", item.raw_text || "", provider, model, status, outputMode]
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

