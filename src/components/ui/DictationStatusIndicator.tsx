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
};

const TERMINAL_ICON = {
  done: Check,
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
}: Props) {
  const TerminalIcon = TERMINAL_ICON[stage as keyof typeof TERMINAL_ICON];
  const isError = stage === "error";
  const isCancelled = stage === "cancelled";
  const detail = canCancel
    ? isSlow
      ? "Taking longer · press dictation hotkey to cancel"
      : "Press dictation hotkey again to cancel"
    : message || (stage === "done" ? "Text delivered" : "");

  return (
    <div className="dictation-window flex h-screen w-screen items-center justify-center p-1.5 pointer-events-none select-none">
      <div
        data-testid="dictation-status-indicator"
        data-stage={stage}
        className={`flex w-full items-center gap-2.5 rounded-full border bg-surface-2/95 px-3 py-2 text-foreground shadow-lg backdrop-blur-md ${
          isError
            ? "border-destructive/50"
            : isCancelled
              ? "border-border-hover"
              : "border-primary/40"
        }`}
        role="status"
        aria-live="polite"
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
            isError
              ? "bg-destructive/15 text-destructive"
              : stage === "done"
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
            className={`block truncate text-[9px] leading-tight ${
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
