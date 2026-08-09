import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Check,
  ClipboardCheck,
  Copy,
  FolderOpen,
  Inbox,
  Loader2,
  RefreshCw,
  Smartphone,
  SquareTerminal,
} from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import type { CorrectionReason, ReprocessingMode, TodoItem } from "../../types/electron";
import type { MobileInboxStatus } from "../../types/electronApi/mobileInbox";

type Props = {
  items: TodoItem[];
  isLoading: boolean;
  copyToClipboard: (
    text: string,
    options?: { title?: string; description?: string }
  ) => Promise<void>;
  markActioned: (id: number) => Promise<void>;
  reprocessItem?: (item: TodoItem, mode: ReprocessingMode) => Promise<void>;
  setCorrectionFlag?: (item: TodoItem, reason: CorrectionReason | null) => Promise<void>;
  archiveRefreshKey?: number;
  mobileInboxStatus?: MobileInboxStatus | null;
  isChoosingInboxFolder?: boolean;
  chooseMobileInboxFolder?: () => Promise<void>;
};

const ARCHIVED_PAGE_SIZE = 25;
const MAX_ARCHIVED_SEARCH_LENGTH = 200;

function formatCreatedAt(value: string) {
  const source = value.endsWith("Z") ? value : `${value}Z`;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-NZ", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TodoPanel({
  items,
  isLoading,
  copyToClipboard,
  markActioned,
  reprocessItem,
  setCorrectionFlag,
  archiveRefreshKey = 0,
  mobileInboxStatus,
  isChoosingInboxFolder = false,
  chooseMobileInboxFolder,
}: Props) {
  const [view, setView] = useState<"pending" | "archived">("pending");
  const [actioningId, setActioningId] = useState<number | null>(null);
  const [reprocessingKey, setReprocessingKey] = useState<string | null>(null);
  const [flaggingId, setFlaggingId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [archivedItems, setArchivedItems] = useState<TodoItem[]>([]);
  const [archivedCursor, setArchivedCursor] = useState<{
    sortEpoch: number;
    id: number;
  } | null>(null);
  const [isLoadingArchived, setIsLoadingArchived] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const archiveRequestRef = useRef(0);

  const pendingItems = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return items;
    return items.filter((item) =>
      `${item.title || ""} ${item.text} ${item.raw_text || ""}`.toLocaleLowerCase().includes(query)
    );
  }, [items, searchQuery]);

  const runArchiveQuery = useCallback(
    async (query: string, cursor: { sortEpoch: number; id: number } | null, reset: boolean) => {
      const requestId = ++archiveRequestRef.current;
      setIsLoadingArchived(true);
      setArchiveError(null);
      try {
        const result = await window.electronAPI.getArchivedTodos({
          query,
          cursor,
          limit: ARCHIVED_PAGE_SIZE,
        });
        if (requestId !== archiveRequestRef.current) return;
        setArchivedItems((current) => (reset ? result.items : [...current, ...result.items]));
        setArchivedCursor(result.nextCursor);
      } catch {
        if (requestId !== archiveRequestRef.current) return;
        if (reset) setArchivedItems([]);
        setArchiveError("Could not load Archived To Do items.");
      } finally {
        if (requestId === archiveRequestRef.current) setIsLoadingArchived(false);
      }
    },
    []
  );

  const loadArchived = useCallback(
    (reset: boolean) => runArchiveQuery(searchQuery, reset ? null : archivedCursor, reset),
    [archivedCursor, runArchiveQuery, searchQuery]
  );

  useEffect(() => {
    if (view !== "archived") return;
    const timer = window.setTimeout(() => void runArchiveQuery(searchQuery, null, true), 180);
    return () => window.clearTimeout(timer);
  }, [archiveRefreshKey, runArchiveQuery, searchQuery, view]);

  const handleActioned = async (id: number) => {
    if (actioningId !== null) return;
    setActioningId(id);
    try {
      await markActioned(id);
    } finally {
      setActioningId(null);
    }
  };

  const handleReprocess = async (item: TodoItem, mode: ReprocessingMode) => {
    if (!reprocessItem || reprocessingKey) return;
    setReprocessingKey(`${item.id}:${mode}`);
    try {
      await reprocessItem(item, mode);
    } finally {
      setReprocessingKey(null);
    }
  };

  const handleFlag = async (item: TodoItem, reason: CorrectionReason | null) => {
    if (!setCorrectionFlag || flaggingId !== null) return;
    setFlaggingId(item.id);
    try {
      await setCorrectionFlag(item, reason);
    } finally {
      setFlaggingId(null);
    }
  };

  const visibleItems = view === "pending" ? pendingItems : archivedItems;
  const busy =
    isLoading || (view === "archived" && isLoadingArchived && archivedItems.length === 0);

  return (
    <div className="rounded-lg border border-border bg-card/50 backdrop-blur-sm dark:bg-card/30">
      <div className="space-y-3 border-b border-border/50 p-3">
        {chooseMobileInboxFolder ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Smartphone size={13} aria-hidden="true" />
                {mobileInboxStatus?.configured ? "Mobile sync folder" : "Set up mobile sync"}
              </p>
              <p
                className="mt-1 truncate text-[11px] text-muted-foreground"
                title={mobileInboxStatus?.folderPath || undefined}
              >
                {mobileInboxStatus?.configured
                  ? mobileInboxStatus.folderPath
                  : "Choose the PC copy of your phone’s EchoDraft cloud folder."}
              </p>
              {mobileInboxStatus?.state === "folder_unavailable" ? (
                <p className="mt-1 text-[11px] text-destructive" role="status">
                  Folder unavailable. Check that cloud sync is running.
                </p>
              ) : null}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={isChoosingInboxFolder}
              onClick={() => void chooseMobileInboxFolder()}
            >
              {isChoosingInboxFolder ? (
                <Loader2 size={12} className="mr-1 animate-spin" aria-hidden="true" />
              ) : (
                <FolderOpen size={12} className="mr-1" aria-hidden="true" />
              )}
              {mobileInboxStatus?.configured ? "Change" : "Choose folder"}
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            className="inline-flex rounded-md border border-border bg-background p-0.5"
            role="group"
            aria-label="To Do status"
          >
            <Button
              size="sm"
              variant={view === "pending" ? "secondary" : "ghost"}
              className="h-7 px-2 text-[11px]"
              aria-pressed={view === "pending"}
              onClick={() => setView("pending")}
            >
              <Inbox size={12} className="mr-1" aria-hidden="true" />
              Pending ({items.length})
            </Button>
            <Button
              size="sm"
              variant={view === "archived" ? "secondary" : "ghost"}
              className="h-7 px-2 text-[11px]"
              aria-pressed={view === "archived"}
              onClick={() => setView("archived")}
            >
              <Archive size={12} className="mr-1" aria-hidden="true" />
              Archived
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {view === "pending"
              ? "Copy a memo, then mark it as actioned when the follow-up is complete."
              : "Search actioned mobile memos stored on this computer."}
          </p>
        </div>

        <Input
          data-testid="todo-search"
          aria-label={
            view === "pending"
              ? "Search mobile To Do dictations"
              : "Search Archived mobile To Do dictations"
          }
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          name="mobile-todo-search"
          autoComplete="off"
          maxLength={MAX_ARCHIVED_SEARCH_LENGTH}
          placeholder={
            view === "pending"
              ? "Search pending mobile dictations…"
              : "Search all Archived dictations…"
          }
          className="h-8 text-xs"
        />
      </div>

      {busy ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-2 py-8"
        >
          <Loader2 size={14} className="animate-spin text-primary" aria-hidden="true" />
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      ) : archiveError ? (
        <div className="px-4 py-10 text-center" role="alert">
          <p className="text-sm text-destructive">{archiveError}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void loadArchived(true)}
          >
            Try again
          </Button>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-muted/50 dark:bg-white/4">
            {view === "pending" ? (
              <ClipboardCheck size={18} className="text-muted-foreground" aria-hidden="true" />
            ) : (
              <Archive size={18} className="text-muted-foreground" aria-hidden="true" />
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {view === "pending"
              ? items.length === 0
                ? "Nothing to action"
                : "No matching mobile dictations."
              : "No matching Archived dictations."}
          </p>
          {searchQuery ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 h-7 px-2 text-[11px]"
              onClick={() => setSearchQuery("")}
            >
              Clear search
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="max-h-[calc(100vh-320px)] min-h-[120px] divide-y divide-border/50 overflow-y-auto">
            {visibleItems.map((item, index) => {
              const itemNumber = index + 1;
              const hasRawText = typeof item.raw_text === "string" && Boolean(item.raw_text.trim());
              return (
                <article
                  key={item.id}
                  data-testid="todo-item"
                  className="px-3 py-3 transition-colors duration-150 hover:bg-muted/30 dark:hover:bg-white/2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {formatCreatedAt(item.created_at)}
                    </span>
                    <span className="inline-flex items-center rounded-sm bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
                      <Smartphone size={10} className="mr-1" aria-hidden="true" />
                      Mobile
                    </span>
                    {item.processingMode === "codex-prompt" ? (
                      <span
                        role="img"
                        aria-label="Codex prompt"
                        title="Codex prompt"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-violet-500/10 text-violet-600 dark:text-violet-300"
                      >
                        <SquareTerminal size={11} aria-hidden="true" />
                      </span>
                    ) : null}
                    {item.correctionFlag ? (
                      <span className="inline-flex items-center rounded-sm bg-warning/10 px-1.5 py-px text-[10px] font-medium text-warning">
                        Needs correction ·{" "}
                        {item.correctionFlag.reason.replace("paste-delivery", "paste/delivery")}
                      </span>
                    ) : null}
                  </div>

                  {item.title ? (
                    <h3 className="mt-1.5 text-[13px] font-semibold leading-snug text-foreground">
                      {item.title}
                    </h3>
                  ) : null}
                  <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-[1.5] text-foreground">
                    {item.text}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void copyToClipboard(item.text)}
                      aria-label={`Copy mobile memo ${itemNumber}`}
                      className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <Copy size={12} className="mr-1" aria-hidden="true" /> Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        hasRawText &&
                        void copyToClipboard(item.raw_text as string, {
                          title: "Raw Transcript Copied",
                          description: "Raw transcript copied to clipboard.",
                        })
                      }
                      disabled={!hasRawText}
                      aria-label={
                        hasRawText
                          ? `Copy raw mobile memo ${itemNumber}`
                          : `Raw mobile memo ${itemNumber} unavailable`
                      }
                      title={hasRawText ? "Copy raw transcript" : "Raw transcript was not stored"}
                      className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <Copy size={12} className="mr-1" aria-hidden="true" /> Copy raw
                    </Button>
                    {reprocessItem ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!hasRawText || reprocessingKey !== null}
                          title={
                            hasRawText
                              ? "Create and copy a new cleanup alternative"
                              : "Raw transcript is required to clean again"
                          }
                          onClick={() => void handleReprocess(item, "cleanup")}
                          className="h-6 px-2 text-[11px] text-muted-foreground"
                        >
                          {reprocessingKey === `${item.id}:cleanup` ? (
                            <Loader2 size={12} className="mr-1 animate-spin" aria-hidden="true" />
                          ) : (
                            <RefreshCw size={12} className="mr-1" aria-hidden="true" />
                          )}{" "}
                          Clean again
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!hasRawText || reprocessingKey !== null}
                          title={
                            hasRawText
                              ? "Create and copy a Luna prompt alternative"
                              : "Raw transcript is required to make a Codex prompt"
                          }
                          onClick={() => void handleReprocess(item, "codex-prompt")}
                          className="h-6 px-2 text-[11px] text-muted-foreground"
                        >
                          {reprocessingKey === `${item.id}:codex-prompt` ? (
                            <Loader2 size={12} className="mr-1 animate-spin" aria-hidden="true" />
                          ) : (
                            <SquareTerminal size={12} className="mr-1" aria-hidden="true" />
                          )}{" "}
                          Make Codex prompt
                        </Button>
                      </>
                    ) : null}
                    {setCorrectionFlag ? (
                      <select
                        aria-label={`Correction flag for mobile memo ${itemNumber}`}
                        name={`todo-${item.id}-correction-flag`}
                        value={item.correctionFlag?.reason || ""}
                        disabled={flaggingId !== null}
                        onChange={(event) =>
                          void handleFlag(item, (event.target.value as CorrectionReason) || null)
                        }
                        className="h-6 rounded-md border border-border bg-background px-1.5 text-[11px] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="">No correction flag</option>
                        <option value="transcription">Needs correction: Transcription</option>
                        <option value="cleanup">Needs correction: Cleanup</option>
                        <option value="prompt">Needs correction: Prompt</option>
                        <option value="paste-delivery">Needs correction: Paste/delivery</option>
                      </select>
                    ) : null}
                    {view === "pending" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleActioned(item.id)}
                        disabled={actioningId !== null}
                        aria-label={`Mark mobile memo ${itemNumber} actioned`}
                        className="h-6 px-2 text-[11px] text-muted-foreground hover:text-success"
                      >
                        {actioningId === item.id ? (
                          <Loader2 size={12} className="mr-1 animate-spin" aria-hidden="true" />
                        ) : (
                          <Check size={12} className="mr-1" aria-hidden="true" />
                        )}{" "}
                        Mark actioned
                      </Button>
                    ) : null}
                  </div>

                  {item.alternatives && item.alternatives.length > 0 ? (
                    <details className="mt-2 rounded border border-border/50 bg-muted/20 p-2">
                      <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                        Saved alternatives ({item.alternatives.length})
                      </summary>
                      <div className="mt-2 space-y-2">
                        {item.alternatives.map((alternative) => (
                          <div
                            key={alternative.id}
                            className="rounded border border-border/50 bg-background/60 p-2"
                          >
                            <p className="text-[10px] font-medium text-muted-foreground">
                              {alternative.mode === "codex-prompt" ? "Codex prompt" : "Cleanup"}
                            </p>
                            <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px] text-foreground/90">
                              {alternative.text}
                            </p>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="mt-1 h-6 px-1.5 text-[11px]"
                              onClick={() => void copyToClipboard(alternative.text)}
                            >
                              Copy alternative
                            </Button>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </article>
              );
            })}
          </div>
          {view === "archived" && archivedCursor ? (
            <div className="border-t border-border/50 p-3 text-center">
              <Button
                variant="outline"
                size="sm"
                disabled={isLoadingArchived}
                onClick={() => void loadArchived(false)}
              >
                {isLoadingArchived ? (
                  <Loader2 size={12} className="mr-1 animate-spin" aria-hidden="true" />
                ) : null}
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
