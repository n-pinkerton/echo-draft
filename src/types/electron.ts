import "./windowElectron";

export type LocalTranscriptionProvider = "whisper" | "nvidia";
export type DictationOutputMode = "insert" | "clipboard" | "file";

export interface TranscriptionTimings {
  recordDurationMs?: number;
  transcriptionProcessingDurationMs?: number;
  reasoningProcessingDurationMs?: number;
  pasteDurationMs?: number | null;
  saveDurationMs?: number | null;
  totalDurationMs?: number | null;
  [key: string]: unknown;
}

export interface TranscriptionMeta {
  sessionId?: string;
  outputMode?: DictationOutputMode;
  status?: "success" | "error" | "cancelled" | string;
  source?: string;
  provider?: string;
  model?: string;
  insertionTarget?: InsertionTargetSnapshot | null;
  pasteSucceeded?: boolean;
  error?: string;
  timings?: TranscriptionTimings;
  [key: string]: unknown;
}

export interface DictationTriggerPayload {
  outputMode?: DictationOutputMode;
  sessionId?: string;
  triggeredAt?: number;
  insertionTarget?: InsertionTargetSnapshot | null;
}

export interface InsertionTargetSnapshot {
  hwnd: number;
  pid?: number | null;
  processName?: string;
  title?: string;
  capturedAt?: number;
}

export interface TranscriptionItem {
  id: number;
  text: string;
  raw_text?: string | null;
  meta_json?: string;
  meta?: TranscriptionMeta;
  timestamp: string;
  created_at: string;
}

export interface DictionaryImportResult {
  success: boolean;
  canceled?: boolean;
  filePath?: string;
  words?: string[];
  parsedCount?: number;
  uniqueCount?: number;
  duplicatesRemoved?: number;
  error?: string;
}

export interface DictionaryExportResult {
  success: boolean;
  canceled?: boolean;
  format?: "txt" | "csv";
  filePath?: string;
  count?: number;
}

export interface AudioFileSelectionResult {
  success: boolean;
  canceled?: boolean;
  error?: string;
  filePath?: string;
  fileName?: string;
  extension?: string | null;
  mimeType?: string;
  sizeBytes?: number;
  data?: Uint8Array;
}

export interface WhisperCheckResult {
  installed: boolean;
  working: boolean;
  error?: string;
}

export interface WhisperModelResult {
  success: boolean;
  model: string;
  downloaded: boolean;
  size_mb?: number;
  error?: string;
}

export interface WhisperModelDeleteResult {
  success: boolean;
  model: string;
  deleted: boolean;
  freed_mb?: number;
  error?: string;
}

export interface WhisperModelsListResult {
  success: boolean;
  models: Array<{ model: string; downloaded: boolean; size_mb?: number }>;
  cache_dir: string;
}

export interface FFmpegAvailabilityResult {
  available: boolean;
  path?: string;
  error?: string;
}

export interface AudioDiagnosticsResult {
  platform: string;
  arch: string;
  resourcesPath: string | null;
  isPackaged: boolean;
  ffmpeg: { available: boolean; path: string | null; error: string | null };
  whisperBinary: { available: boolean; path: string | null; error: string | null };
  whisperServer: { available: boolean; path: string | null };
  modelsDir: string;
  models: string[];
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  version?: string;
  releaseDate?: string;
  files?: any[];
  releaseNotes?: string;
  message?: string;
}

export interface UpdateStatusResult {
  updateAvailable: boolean;
  updateDownloaded: boolean;
  isDevelopment: boolean;
}

export interface UpdateInfoResult {
  version?: string;
  releaseDate?: string;
  releaseNotes?: string | null;
  files?: any[];
}

export interface UpdateResult {
  success: boolean;
  message: string;
}

export interface AppVersionResult {
  version: string;
}

export interface WhisperDownloadProgressData {
  type: string;
  model: string;
  percentage?: number;
  downloaded_bytes?: number;
  total_bytes?: number;
  error?: string;
  result?: any;
}

export interface ParakeetCheckResult {
  installed: boolean;
  working: boolean;
  path?: string;
}

export interface ParakeetModelResult {
  success: boolean;
  model: string;
  downloaded: boolean;
  path?: string;
  size_bytes?: number;
  size_mb?: number;
  error?: string;
}

export interface ParakeetModelDeleteResult {
  success: boolean;
  model: string;
  deleted: boolean;
  freed_bytes?: number;
  freed_mb?: number;
  error?: string;
}

export interface ParakeetModelsListResult {
  success: boolean;
  models: Array<{ model: string; downloaded: boolean; size_mb?: number }>;
  cache_dir: string;
}

export interface ParakeetDownloadProgressData {
  type: string;
  model: string;
  percentage?: number;
  downloaded_bytes?: number;
  total_bytes?: number;
  error?: string;
}

export interface ParakeetTranscriptionResult {
  success: boolean;
  text?: string;
  message?: string;
  error?: string;
}

export interface ParakeetDiagnosticsResult {
  platform: string;
  arch: string;
  resourcesPath: string | null;
  isPackaged: boolean;
  sherpaOnnx: { available: boolean; path: string | null };
  modelsDir: string;
  models: string[];
}

export interface PasteToolsResult {
  platform: "darwin" | "win32" | "linux";
  available: boolean;
  method: string | null;
  requiresPermission: boolean;
  isWayland?: boolean;
  xwaylandAvailable?: boolean;
  tools?: string[];
  recommendedInstall?: string;
}

export type { ElectronAPI } from "./electronApi/ElectronAPI";
