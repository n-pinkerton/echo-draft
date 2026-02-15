import { useState } from "react";
import { Button } from "./button";
import { Copy, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import type { TranscriptionItem as TranscriptionItemType } from "../../types/electron";
import { cn } from "../lib/utils";

interface TranscriptionItemProps {
  item: TranscriptionItemType;
  index: number;
  total: number;
  onCopyClean: (text: string) => void;
  onCopyRaw: (text: string) => void;
  onCopyDiagnostics: (item: TranscriptionItemType) => void;
  onDelete: (id: number) => void;
}

const TEXT_PREVIEW_LENGTH = 180;

const formatDuration = (value?: unknown) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  const totalSeconds = Math.max(0, value / 1000);
  if (totalSeconds < 60) {
    const secondsLabel =
      totalSeconds < 10
        ? totalSeconds.toFixed(1).replace(/\.0$/, "")
        : String(Math.round(totalSeconds));
    return `${secondsLabel}s`;
  }

  const roundedSeconds = Math.round(totalSeconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const getStatusClass = (status: string) => {
  if (status === "error") {
    return "bg-destructive/10 text-destructive";
  }
  if (status === "cancelled") {
    return "bg-muted text-muted-foreground";
  }
  return "bg-success/10 text-success";
};

export default function TranscriptionItem({
  item,
  index,
  total,
  onCopyClean,
  onCopyRaw,
  onCopyDiagnostics,
  onDelete,
}: TranscriptionItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const meta = item.meta || {};
  const timings = (meta.timings || {}) as Record<string, unknown>;
  const outputMode = meta.outputMode || "insert";
  const status = meta.status || "success";
  const provider = meta.provider || meta.source || "unknown";
  const model = meta.model || "";
  const rawTextFromDb = typeof item.raw_text === "string" ? item.raw_text : null;
  const hasRawText = Boolean(rawTextFromDb && rawTextFromDb.trim());
  const rawTextForCopy = rawTextFromDb ?? item.text;
  const outputModeLabel =
    outputMode === "clipboard" ? "Clipboard" : outputMode === "file" ? "File" : "Insert";

  const timestampSource =
    typeof item.timestamp === "string" && item.timestamp.endsWith("Z")
      ? item.timestamp
      : `${item.timestamp}Z`;
  const timestampDate = new Date(timestampSource);
  const formattedTimestamp = Number.isNaN(timestampDate.getTime())
    ? item.timestamp
    : timestampDate.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

  const isLongText = item.text.length > TEXT_PREVIEW_LENGTH;
  const displayText =
    isExpanded || !isLongText ? item.text : `${item.text.slice(0, TEXT_PREVIEW_LENGTH)}…`;

  const timingRows: Array<{ label: string; value: string | null }> = [
    {
      label: "Record",
      value: formatDuration(timings.recordDurationMs ?? timings.recordMs),
    },
    {
      label: "Transcribe",
      value: formatDuration(
        timings.transcriptionProcessingDurationMs ?? timings.transcribeDurationMs
      ),
    },
    {
      label: "Cleanup",
      value: formatDuration(timings.reasoningProcessingDurationMs ?? timings.cleanupDurationMs),
    },
    {
      label: "Paste",
      value: formatDuration(timings.pasteDurationMs),
    },
    {
      label: "Save",
      value: formatDuration(timings.saveDurationMs),
    },
    {
      label: "Total",
      value: formatDuration(timings.totalDurationMs),
    },
  ].filter((entry) => Boolean(entry.value));

  return (
    <div
      data-testid="transcription-item"
      className="group relative px-3 py-2.5 transition-colors duration-150 hover:bg-muted/30 dark:hover:bg-white/2"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <span className="inline-flex items-center justify-center min-w-[28px] h-5 px-1.5 rounded-sm bg-primary/10 dark:bg-primary/15 text-primary text-[10px] font-semibold tabular-nums">
            {total - index}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {formattedTimestamp}
            </span>
            <span className="inline-flex items-center rounded-sm px-1.5 py-px text-[10px] font-medium bg-primary/10 text-primary">
              {outputModeLabel}
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-sm px-1.5 py-px text-[10px] font-medium",
                getStatusClass(String(status))
              )}
            >
              {String(status)}
            </span>
            <span className="inline-flex items-center rounded-sm px-1.5 py-px text-[10px] font-medium bg-muted text-muted-foreground">
              {String(provider)}
            </span>
            {model ? (
              <span className="inline-flex items-center rounded-sm px-1.5 py-px text-[10px] font-medium bg-muted text-muted-foreground">
                {String(model)}
              </span>
            ) : null}
          </div>

          <p
            className={cn(
              "mt-1 text-foreground text-[13px] leading-[1.5] break-words",
              !isExpanded && isLongText && "line-clamp-3"
            )}
          >
            {displayText}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onCopyClean(item.text)}
              className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Copy size={12} className="mr-1" />
              Copy
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onCopyRaw(rawTextForCopy)}
              className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Raw
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onCopyDiagnostics(item)}
              className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Diagnostics
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {isExpanded ? (
                <>
                  Hide
                  <ChevronUp size={12} className="ml-1" />
                </>
              ) : (
                <>
                  Details
                  <ChevronDown size={12} className="ml-1" />
                </>
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onDelete(item.id)}
              className="h-6 w-6 rounded-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 size={12} />
            </Button>
          </div>

          {isExpanded && (
            <div className="mt-2 space-y-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Raw Transcript
                </p>
                {hasRawText ? (
                  <p className="mt-1 text-[12px] text-foreground/90 whitespace-pre-wrap break-words">
                    {rawTextFromDb}
                  </p>
                ) : (
                  <p className="mt-1 text-[12px] text-muted-foreground whitespace-pre-wrap break-words">
                    Raw transcript wasn't stored for this item.
                  </p>
                )}
              </div>

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Diagnostics
                </p>
                <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1 text-[11px]">
                  {timingRows.map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className="tabular-nums text-foreground">{row.value}</span>
                    </div>
                  ))}
                </div>
                {meta.error ? (
                  <p className="mt-1 text-[11px] text-destructive break-words">
                    {String(meta.error)}
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
