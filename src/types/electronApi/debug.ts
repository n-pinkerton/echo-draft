export interface ElectronAPIDebugLogging {
  // Debug logging
  getLogLevel?: () => Promise<string>;
  log?: (entry: {
    level: string;
    message: string;
    meta?: any;
    scope?: string;
    source?: string;
  }) => Promise<void>;
  getDebugState: () => Promise<{
    enabled: boolean;
    logPath: string | null;
    logsDir?: string | null;
    logsDirSource?: string | null;
    fileLoggingEnabled?: boolean;
    fileLoggingError?: string | null;
    logLevel: string;
  }>;
  setDebugLogging: (enabled: boolean) => Promise<{
    success: boolean;
    enabled?: boolean;
    logPath?: string | null;
    logsDir?: string | null;
    logsDirSource?: string | null;
    fileLoggingEnabled?: boolean;
    fileLoggingError?: string | null;
    logLevel?: string;
    error?: string;
  }>;
  debugSaveAudio?: (payload: {
    audioBuffer: ArrayBuffer;
    mimeType?: string;
    sessionId?: string | null;
    jobId?: number | null;
    outputMode?: string | null;
    durationSeconds?: number | null;
    stopReason?: string | null;
    stopSource?: string | null;
  }) => Promise<{
    success: boolean;
    skipped?: boolean;
    reason?: string;
    audioDir?: string;
    filePath?: string;
    bytes?: number;
    kept?: number;
    deleted?: number;
    error?: string;
  }>;
  openLogsFolder: () => Promise<{ success: boolean; error?: string }>;
}

