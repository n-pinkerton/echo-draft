import { Mic } from "lucide-react";
import {
  formatRecordingDuration,
  shouldShowLongRecordingReminder,
} from "./recordingIndicatorUtils";

export default function RecordingIndicator({
  recordedMs = 0,
  longRecordingReminderEnabled = true,
  queuedAheadCount = 0,
  outputMode = "insert",
}: {
  recordedMs?: number;
  longRecordingReminderEnabled?: boolean;
  queuedAheadCount?: number;
  outputMode?: "insert" | "clipboard" | string;
}) {
  const formattedDuration = formatRecordingDuration(recordedMs);
  const showLongReminder = shouldShowLongRecordingReminder(
    recordedMs,
    longRecordingReminderEnabled
  );
  const normalizedQueuedAheadCount = Math.max(0, Math.floor(queuedAheadCount));
  const queueLabel = normalizedQueuedAheadCount
    ? `${normalizedQueuedAheadCount} ${normalizedQueuedAheadCount === 1 ? "dictation" : "dictations"} ahead`
    : null;
  const destinationLabel = outputMode === "clipboard" ? "Clipboard" : "Insert";
  const compactQueueLabel = normalizedQueuedAheadCount
    ? `${normalizedQueuedAheadCount} ahead`
    : null;

  return (
    <div className="dictation-window pointer-events-none fixed bottom-0 right-0 flex h-[72px] w-[260px] items-center justify-center p-1.5 select-none">
      <div
        data-testid="recording-indicator"
        data-long-recording={showLongReminder ? "true" : "false"}
        className={`flex w-full items-center gap-2.5 rounded-full border bg-surface-2/95 px-3 py-2 text-foreground shadow-lg backdrop-blur-md transition-colors ${
          showLongReminder ? "border-warning/70" : "border-red-400/40"
        }`}
      >
        <span role="status" aria-live="polite" className="sr-only">
          {showLongReminder
            ? `Still recording, microphone live, ${destinationLabel} mode, one minute elapsed${queueLabel ? `, ${queueLabel}` : ""}`
            : `Recording, microphone live, ${destinationLabel} mode${queueLabel ? `, ${queueLabel}` : ""}`}
        </span>
        <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-500">
          <span
            data-testid="recording-pulse"
            className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-red-500/55 motion-reduce:animate-none"
            aria-hidden="true"
          />
          <Mic className="relative h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold tracking-[0.16em] text-red-500">REC</span>
          <span
            className={`block text-[10px] ${
              showLongReminder ? "font-medium text-warning-text" : "text-muted-foreground"
            }`}
          >
            {showLongReminder
              ? `Mic live · ${destinationLabel} · ${compactQueueLabel || "still recording"}`
              : `Mic live · ${destinationLabel}${compactQueueLabel ? ` · ${compactQueueLabel}` : ""}`}
          </span>
        </span>
        <time
          className={`shrink-0 text-sm font-semibold tabular-nums ${
            showLongReminder ? "text-warning-text" : ""
          }`}
          dateTime={`PT${Math.floor(recordedMs / 1000)}S`}
          aria-label={`Recording elapsed time ${formattedDuration}`}
          aria-live="off"
        >
          {formattedDuration}
        </time>
      </div>
    </div>
  );
}
