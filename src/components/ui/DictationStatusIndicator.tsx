import { AlertTriangle, Check, LoaderCircle, X } from "lucide-react";

const formatElapsed = (elapsedMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

type Props = {
  stage: string;
  stageLabel?: string | null;
  stageElapsedMs?: number | null;
  message?: string | null;
  canCancel?: boolean;
  isSlow?: boolean;
  queuedWaitingCount?: number;
  outputMode?: "insert" | "clipboard" | string;
};

const TERMINAL_ICON = {
  done: Check,
  warning: AlertTriangle,
  error: AlertTriangle,
  cancelled: X,
} as const;

export default function DictationStatusIndicator({
  stage,
  stageLabel,
  stageElapsedMs = 0,
  message,
  canCancel = false,
  isSlow = false,
  queuedWaitingCount = 0,
  outputMode = "insert",
}: Props) {
  const TerminalIcon = TERMINAL_ICON[stage as keyof typeof TERMINAL_ICON];
  const isSuccess = stage === "done";
  const isError = stage === "error";
  const isWarning = stage === "warning";
  const isCancelled = stage === "cancelled";
  const operationDetail = canCancel
    ? isSlow
      ? "Taking longer · cancel from the tray menu"
      : "Cancel from the EchoDraft tray menu"
    : message || (stage === "done" ? "Text delivered" : "");
  const normalizedWaitingCount = Math.max(0, Math.floor(queuedWaitingCount));
  const destinationLabel = outputMode === "clipboard" ? "Clipboard" : "Insert";
  const activeContext = TerminalIcon
    ? []
    : [destinationLabel, ...(normalizedWaitingCount ? [`${normalizedWaitingCount} waiting`] : [])];
  const detail = [...activeContext, operationDetail].filter(Boolean).join(" · ");

  return (
    <div className="dictation-window pointer-events-none fixed bottom-0 right-0 flex h-[72px] w-[260px] items-center justify-center p-1.5 select-none">
      <div
        data-testid="dictation-status-indicator"
        data-stage={stage}
        className={`flex w-full items-center gap-2.5 rounded-full border bg-surface-2/95 px-3 py-2 text-foreground shadow-lg backdrop-blur-md ${
          isError
            ? "border-destructive/50"
            : isWarning
              ? "border-warning/60"
              : isSuccess
                ? "border-success/50"
                : isCancelled
                  ? "border-border-hover"
                  : "border-primary/40"
        }`}
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
            isError
              ? "bg-destructive/15 text-destructive"
              : isWarning
                ? "bg-warning/15 text-warning-text"
                : isSuccess
                  ? "bg-success/15 text-success"
                  : "bg-primary/15 text-primary"
          }`}
        >
          {TerminalIcon ? (
            <TerminalIcon className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <LoaderCircle
              className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-semibold text-foreground">
            {stageLabel || "Working"}
          </span>
          <span
            className={`block whitespace-normal text-[10px] leading-tight ${
              isSlow ? "font-medium text-warning-text" : "text-muted-foreground"
            }`}
          >
            {detail}
          </span>
        </span>
        {!TerminalIcon && (
          <time
            className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground"
            dateTime={`PT${Math.floor(Math.max(0, stageElapsedMs || 0) / 1000)}S`}
            aria-label={`Current stage elapsed time ${formatElapsed(stageElapsedMs || 0)}`}
            aria-live="off"
          >
            {formatElapsed(stageElapsedMs || 0)}
          </time>
        )}
      </div>
    </div>
  );
}
