import { Download, Loader2, Mic } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import TranscriptionItem from "../ui/TranscriptionItem";
import { formatHotkeyLabel } from "../../utils/hotkeys";
import type { TranscriptionItem as TranscriptionItemType } from "../../types/electron";

type ModeFilter = "all" | "insert" | "clipboard" | "file";
type StatusFilter = "all" | "success" | "error" | "cancelled";

type Props = {
  history: TranscriptionItemType[];
  filteredHistory: TranscriptionItemType[];
  providerOptions: string[];
  isLoading: boolean;
  hotkey: string;

  searchQuery: string;
  setSearchQuery: (next: string) => void;
  modeFilter: ModeFilter;
  setModeFilter: (next: ModeFilter) => void;
  statusFilter: StatusFilter;
  setStatusFilter: (next: StatusFilter) => void;
  providerFilter: string;
  setProviderFilter: (next: string) => void;

  exportTranscriptions: (format: "csv" | "json") => Promise<void>;
  isExporting: boolean;

  copyToClipboard: (text: string, options?: { title?: string; description?: string }) => Promise<void>;
  copyDiagnostics: (item: TranscriptionItemType) => Promise<void>;
  deleteTranscription: (id: number) => Promise<void>;
};

export default function HistoryPanel(props: Props) {
  const {
    history,
    filteredHistory,
    providerOptions,
    isLoading,
    hotkey,
    searchQuery,
    setSearchQuery,
    modeFilter,
    setModeFilter,
    statusFilter,
    setStatusFilter,
    providerFilter,
    setProviderFilter,
    exportTranscriptions,
    isExporting,
    copyToClipboard,
    copyDiagnostics,
    deleteTranscription,
  } = props;

  return (
    <div className="rounded-lg border border-border bg-card/50 dark:bg-card/30 backdrop-blur-sm">
      <div className="border-b border-border/50 p-3 space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <Input
            data-testid="history-search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search text, provider, model…"
            className="h-8 text-xs"
          />
          <select
            data-testid="history-filter-mode"
            value={modeFilter}
            onChange={(event) => setModeFilter(event.target.value as ModeFilter)}
            className="h-8 px-2 rounded-md border border-border bg-background text-xs text-foreground"
          >
            <option value="all">All modes</option>
            <option value="insert">Insert</option>
            <option value="clipboard">Clipboard</option>
            <option value="file">File</option>
          </select>
          <select
            data-testid="history-filter-status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="h-8 px-2 rounded-md border border-border bg-background text-xs text-foreground"
          >
            <option value="all">All statuses</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            data-testid="history-filter-provider"
            value={providerFilter}
            onChange={(event) => setProviderFilter(event.target.value)}
            className="h-8 px-2 rounded-md border border-border bg-background text-xs text-foreground"
          >
            <option value="all">All providers</option>
            {providerOptions.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            Workspace view with raw/clean copy and per-session diagnostics.
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => exportTranscriptions("json")}
              disabled={isExporting || history.length === 0}
            >
              <Download size={12} className="mr-1" />
              Export JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => exportTranscriptions("csv")}
              disabled={isExporting || history.length === 0}
            >
              <Download size={12} className="mr-1" />
              Export CSV
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-8">
          <Loader2 size={14} className="animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      ) : history.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 px-4">
          <div className="w-10 h-10 rounded-md bg-muted/50 dark:bg-white/4 flex items-center justify-center mb-3">
            <Mic size={18} className="text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground mb-3">No transcriptions yet</p>
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span>Press</span>
            <kbd className="inline-flex items-center h-5 px-1.5 rounded-sm bg-surface-1 dark:bg-white/6 border border-border text-[11px] font-mono font-medium">
              {formatHotkeyLabel(hotkey)}
            </kbd>
            <span>to start</span>
          </div>
        </div>
      ) : filteredHistory.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 px-4">
          <p className="text-sm text-muted-foreground">No matching dictations.</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-7 px-2 text-[11px]"
            onClick={() => {
              setSearchQuery("");
              setModeFilter("all");
              setStatusFilter("all");
              setProviderFilter("all");
            }}
          >
            Reset filters
          </Button>
        </div>
      ) : (
        <div className="divide-y divide-border/50 max-h-[calc(100vh-240px)] overflow-y-auto">
          {filteredHistory.map((item, index) => (
            <TranscriptionItem
              key={item.id}
              item={item}
              index={index}
              total={filteredHistory.length}
              onCopyClean={(text) => copyToClipboard(text)}
              onCopyRaw={(text) =>
                copyToClipboard(text, {
                  title: "Raw Transcript Copied",
                  description: "Raw transcript copied to clipboard.",
                })
              }
              onCopyDiagnostics={copyDiagnostics}
              onDelete={deleteTranscription}
            />
          ))}
        </div>
      )}
    </div>
  );
}

