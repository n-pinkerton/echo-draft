export const STAGE_META = {
  idle: { label: "Ready", overallProgress: 0 },
  starting: { label: "Starting", overallProgress: 0.05 },
  listening: { label: "Listening", overallProgress: 0.1 },
  queued: { label: "Queued", overallProgress: 0.2 },
  transcribing: { label: "Transcribing", overallProgress: 0.45 },
  cleaning: { label: "Cleaning up", overallProgress: 0.7 },
  delivering: { label: "Delivering", overallProgress: 0.82 },
  inserting: { label: "Inserting", overallProgress: 0.85 },
  saving: { label: "Saving", overallProgress: 0.93 },
  done: { label: "Done", overallProgress: 1 },
  warning: { label: "Delivered with warning", overallProgress: 1 },
  error: { label: "Error", overallProgress: 1 },
  cancelled: { label: "Cancelled", overallProgress: 1 },
};

export const TERMINAL_STAGES = new Set(["done", "warning", "error", "cancelled"]);

export const INITIAL_PROGRESS = {
  stage: "idle",
  stageLabel: STAGE_META.idle.label,
  stageProgress: null,
  overallProgress: STAGE_META.idle.overallProgress,
  elapsedMs: 0,
  stageElapsedMs: 0,
  recordedMs: 0,
  generatedChars: 0,
  generatedWords: 0,
  outputMode: "insert",
  sessionId: null,
  jobId: null,
  provider: null,
  model: null,
  message: null,
  isSlow: false,
  canCancel: false,
  transportAttempt: null,
  transportRetrying: false,
};
