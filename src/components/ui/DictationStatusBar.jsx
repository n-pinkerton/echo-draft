import React from "react";
import { Clipboard, SquareArrowOutUpRight } from "lucide-react";
import { cn } from "../lib/utils";

const formatDuration = (ms = 0) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const getDetailText = (progress) => {
  switch (progress.stage) {
    case "listening":
      return "Recording";
    case "transcribing":
      if (progress.generatedWords > 0) {
        return `${progress.generatedWords} words`;
      }
      return "Transcribing";
    case "cleaning":
      return "Running cleanup";
    case "inserting":
      return "Pasting into app";
    case "saving":
      return "Saving to history";
    case "done":
      return "Completed";
    case "error":
      return progress.message || "An error occurred";
    case "cancelled":
      return "Cancelled";
    default:
      return "Ready";
  }
};

const getTimerMs = (progress) => {
  if (!progress) return null;
  if (progress.stage === "listening") {
    return typeof progress.recordedMs === "number" ? progress.recordedMs : progress.elapsedMs;
  }

  if (["transcribing", "cleaning", "inserting", "saving", "done"].includes(progress.stage)) {
    return progress.elapsedMs;
  }

  return null;
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
  onLaunchApp,
}) {
  const numericProgress =
    typeof progress?.stageProgress === "number"
      ? progress.stageProgress
      : typeof progress?.overallProgress === "number"
        ? progress.overallProgress
        : null;

  const stage = progress?.stage || "idle";
  const isIdle = stage === "idle";
  const detailText = getDetailText(progress);
  const timerMs = getTimerMs(progress);

  const copyTitle = canCopyTranscript ? "Copy last transcript" : "No transcript to copy yet";
  const launchTitle = "Open main app";

  return (
    <div
      data-testid="dictation-status-bar"
      className={cn(
        "w-[220px] rounded-xl border px-2.5 py-2 backdrop-blur-sm transition-all duration-200",
        isIdle
          ? "bg-surface-2/70 border-border/40 opacity-90"
          : "bg-surface-2/95 border-border/60 shadow-lg"
      )}
    >
      <div className="flex items-stretch gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p
              data-testid="dictation-status-stage"
              className="min-w-0 flex-1 truncate text-[10px] font-semibold tracking-wide text-foreground/95"
            >
              {progress.stageLabel}
            </p>
            {timerMs !== null ? (
              <span className="shrink-0 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
                {formatDuration(timerMs)}
              </span>
            ) : null}
          </div>

          <p className="mt-1 text-[10px] text-muted-foreground/90 truncate">{detailText}</p>

          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border/60">
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

        <div className="flex shrink-0 flex-col justify-between gap-1">
          <button
            type="button"
            aria-label={copyTitle}
            title={copyTitle}
            onClick={() => {
              if (!canCopyTranscript) return;
              onCopyTranscript?.();
            }}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md border transition-all duration-150",
              getCopyButtonStateClass(stage),
              canCopyTranscript
                ? "hover:brightness-110 cursor-pointer"
                : "opacity-60 cursor-not-allowed"
            )}
          >
            <Clipboard size={14} />
          </button>
          <button
            type="button"
            aria-label={launchTitle}
            title={launchTitle}
            onClick={() => onLaunchApp?.()}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground transition-all duration-150 hover:bg-muted/70 hover:text-foreground"
          >
            <SquareArrowOutUpRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
