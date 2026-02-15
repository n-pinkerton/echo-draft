import React from "react";
import { Clipboard } from "lucide-react";
import { cn } from "../lib/utils";

const formatDuration = (ms = 0) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const getSecondaryText = (progress) => {
  switch (progress.stage) {
    case "listening":
      return `${formatDuration(progress.recordedMs)} recorded`;
    case "transcribing":
      if (progress.generatedWords > 0) {
        return `${progress.generatedWords} words • ${formatDuration(progress.elapsedMs)}`;
      }
      return `${formatDuration(progress.elapsedMs)} elapsed`;
    case "cleaning":
      return `Cleanup • ${formatDuration(progress.elapsedMs)}`;
    case "inserting":
      return `Inserting • ${formatDuration(progress.elapsedMs)}`;
    case "saving":
      return `Saving • ${formatDuration(progress.elapsedMs)}`;
    case "done":
      return `Completed in ${formatDuration(progress.elapsedMs)}`;
    case "error":
      return progress.message || "An error occurred";
    case "cancelled":
      return "Cancelled";
    default:
      return "Ready";
  }
};

const getCopyButtonStateClass = (stage) => {
  if (stage === "listening") {
    return "bg-primary/10 text-primary border-primary/30";
  }

  if (["transcribing", "cleaning", "inserting", "saving"].includes(stage)) {
    return "bg-accent/10 text-accent border-accent/30 animate-pulse";
  }

  if (stage === "done") {
    return "bg-success/10 text-success border-success/30";
  }

  return "bg-muted/30 text-muted-foreground border-border/50";
};

export default function DictationStatusBar({
  progress,
  canCopyTranscript = false,
  onCopyTranscript,
}) {
  const numericProgress =
    typeof progress?.stageProgress === "number"
      ? progress.stageProgress
      : typeof progress?.overallProgress === "number"
        ? progress.overallProgress
        : null;

  const stage = progress?.stage || "idle";
  const isIdle = stage === "idle";
  const secondaryText = getSecondaryText(progress);

  const copyTitle = canCopyTranscript ? "Copy last transcript" : "No transcript to copy yet";

  return (
    <div
      data-testid="dictation-status-bar"
      className={cn(
        "w-[170px] rounded-lg border px-2.5 py-2 backdrop-blur-sm transition-all duration-200",
        isIdle
          ? "bg-surface-2/70 border-border/40 opacity-90"
          : "bg-surface-2/95 border-border/60 shadow-lg"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p
          data-testid="dictation-status-stage"
          className="text-[10px] font-semibold tracking-wide text-foreground/95 truncate"
        >
          {progress.stageLabel}
        </p>

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={copyTitle}
            title={copyTitle}
            onClick={() => {
              if (!canCopyTranscript) return;
              onCopyTranscript?.();
            }}
            className={cn(
              "h-5 w-5 rounded-md border flex items-center justify-center transition-all duration-150",
              getCopyButtonStateClass(stage),
              canCopyTranscript
                ? "hover:brightness-110 cursor-pointer"
                : "opacity-60 cursor-not-allowed"
            )}
          >
            <Clipboard size={12} />
          </button>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {formatDuration(progress.elapsedMs)}
          </span>
        </div>
      </div>

      <p className="mt-0.5 text-[10px] text-muted-foreground/90 truncate">{secondaryText}</p>

      <div className="mt-1.5 h-1.5 w-full rounded-full bg-border/60 overflow-hidden">
        {numericProgress !== null ? (
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${Math.max(0, Math.min(1, numericProgress)) * 100}%` }}
          />
        ) : (
          <div className="h-full w-2/5 rounded-full bg-primary/80 animate-pulse" />
        )}
      </div>
    </div>
  );
}
