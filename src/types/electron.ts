export type LocalTranscriptionProvider = "whisper" | "nvidia";
export type DictationOutputMode = "insert" | "clipboard";

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

declare global {
  interface Window {
    electronAPI: {
      // Basic window operations
      pasteText: (
        text: string,
        options?: { fromStreaming?: boolean; insertionTarget?: InsertionTargetSnapshot | null }
      ) => Promise<void>;
      hideWindow: () => Promise<void>;
      showDictationPanel: () => Promise<void>;
      onToggleDictation: (callback: (payload?: DictationTriggerPayload) => void) => () => void;
      onStartDictation?: (callback: (payload?: DictationTriggerPayload) => void) => () => void;
      onStopDictation?: (callback: (payload?: DictationTriggerPayload) => void) => () => void;

      // Database operations
      saveTranscription: (
        payload:
          | string
          | {
              text: string;
              rawText?: string | null;
              meta?: Record<string, any>;
            }
      ) => Promise<{ id: number; success: boolean; transcription?: TranscriptionItem }>;
      getTranscriptions: (limit?: number) => Promise<TranscriptionItem[]>;
      patchTranscriptionMeta?: (
        id: number,
        metaPatch: Partial<TranscriptionMeta>
      ) => Promise<{ success: boolean; transcription?: TranscriptionItem; message?: string }>;
      exportTranscriptions?: (
        format?: "csv" | "json"
      ) => Promise<{ success: boolean; canceled?: boolean; filePath?: string; count?: number }>;
      e2eExportTranscriptions?: (
        format: "csv" | "json",
        filePath: string
      ) => Promise<{
        success: boolean;
        format?: "csv" | "json";
        filePath?: string;
        count?: number;
        error?: string;
      }>;
      e2eGetHotkeyStatus?: () => Promise<{
        activationMode: "tap" | "push" | string;
        insertHotkey: string | null;
        clipboardHotkey: string | null;
        insertUsesNativeListener: boolean;
        clipboardUsesNativeListener: boolean;
        insertGlobalRegistered: boolean;
        clipboardGlobalRegistered: boolean;
        windowsPushToTalkAvailable: boolean;
      }>;
      clearTranscriptions: () => Promise<{ cleared: number; success: boolean }>;
      deleteTranscription: (id: number) => Promise<{ success: boolean }>;

      // Dictionary operations
      getDictionary: () => Promise<string[]>;
      setDictionary: (words: string[]) => Promise<{ success: boolean }>;
      importDictionaryFile?: () => Promise<DictionaryImportResult>;
      exportDictionary?: (format?: "txt" | "csv") => Promise<DictionaryExportResult>;
      e2eExportDictionary?: (
        format: "txt" | "csv",
        filePath: string
      ) => Promise<{
        success: boolean;
        format?: "txt" | "csv";
        filePath?: string;
        count?: number;
        error?: string;
      }>;
      e2eImportDictionary?: (filePath: string) => Promise<DictionaryImportResult>;

      // Database event listeners
      onTranscriptionAdded?: (callback: (item: TranscriptionItem) => void) => () => void;
      onTranscriptionUpdated?: (callback: (item: TranscriptionItem) => void) => () => void;
      onTranscriptionDeleted?: (callback: (payload: { id: number }) => void) => () => void;
      onTranscriptionsCleared?: (callback: (payload: { cleared: number }) => void) => () => void;

      // API key management
      getOpenAIKey: () => Promise<string>;
      saveOpenAIKey: (key: string) => Promise<{ success: boolean }>;
      createProductionEnvFile: (key: string) => Promise<void>;
      getAnthropicKey: () => Promise<string | null>;
      saveAnthropicKey: (key: string) => Promise<void>;
      saveAllKeysToEnv: () => Promise<{ success: boolean; path: string }>;
      syncStartupPreferences: (prefs: {
        useLocalWhisper: boolean;
        localTranscriptionProvider: LocalTranscriptionProvider;
        model?: string;
        reasoningProvider: string;
        reasoningModel?: string;
      }) => Promise<void>;

      // Clipboard operations
      readClipboard: () => Promise<string>;
      writeClipboard: (text: string) => Promise<{ success: boolean }>;
      captureInsertionTarget?: () => Promise<{
        success: boolean;
        reason?: string;
        error?: string;
        target?: InsertionTargetSnapshot;
      }>;
      checkPasteTools: () => Promise<PasteToolsResult>;

      // Audio
      onNoAudioDetected: (callback: (event: any, data?: any) => void) => () => void;

      // Whisper operations (whisper.cpp)
      transcribeLocalWhisper: (audioBlob: Blob | ArrayBuffer, options?: any) => Promise<any>;
      checkWhisperInstallation: () => Promise<WhisperCheckResult>;
      downloadWhisperModel: (modelName: string) => Promise<WhisperModelResult>;
      onWhisperDownloadProgress: (
        callback: (event: any, data: WhisperDownloadProgressData) => void
      ) => () => void;
      checkModelStatus: (modelName: string) => Promise<WhisperModelResult>;
      listWhisperModels: () => Promise<WhisperModelsListResult>;
      deleteWhisperModel: (modelName: string) => Promise<WhisperModelDeleteResult>;
      deleteAllWhisperModels: () => Promise<{
        success: boolean;
        deleted_count?: number;
        freed_bytes?: number;
        freed_mb?: number;
        error?: string;
      }>;
      cancelWhisperDownload: () => Promise<{
        success: boolean;
        message?: string;
        error?: string;
      }>;

      // Parakeet operations (NVIDIA via sherpa-onnx)
      transcribeLocalParakeet: (
        audioBlob: ArrayBuffer,
        options?: { model?: string; language?: string }
      ) => Promise<ParakeetTranscriptionResult>;
      checkParakeetInstallation: () => Promise<ParakeetCheckResult>;
      downloadParakeetModel: (modelName: string) => Promise<ParakeetModelResult>;
      onParakeetDownloadProgress: (
        callback: (event: any, data: ParakeetDownloadProgressData) => void
      ) => () => void;
      checkParakeetModelStatus: (modelName: string) => Promise<ParakeetModelResult>;
      listParakeetModels: () => Promise<ParakeetModelsListResult>;
      deleteParakeetModel: (modelName: string) => Promise<ParakeetModelDeleteResult>;
      deleteAllParakeetModels: () => Promise<{
        success: boolean;
        deleted_count?: number;
        freed_bytes?: number;
        freed_mb?: number;
        error?: string;
      }>;
      cancelParakeetDownload: () => Promise<{
        success: boolean;
        message?: string;
        error?: string;
      }>;
      getParakeetDiagnostics: () => Promise<ParakeetDiagnosticsResult>;

      // Local AI model management
      modelGetAll: () => Promise<any[]>;
      modelCheck: (modelId: string) => Promise<boolean>;
      modelDownload: (modelId: string) => Promise<void>;
      modelDelete: (modelId: string) => Promise<void>;
      modelDeleteAll: () => Promise<{ success: boolean; error?: string; code?: string }>;
      modelCheckRuntime: () => Promise<boolean>;
      modelCancelDownload: (modelId: string) => Promise<{ success: boolean; error?: string }>;
      onModelDownloadProgress: (callback: (event: any, data: any) => void) => () => void;

      // Local reasoning
      processLocalReasoning: (
        text: string,
        modelId: string,
        agentName: string | null,
        config: any
      ) => Promise<{ success: boolean; text?: string; error?: string }>;
      checkLocalReasoningAvailable: () => Promise<boolean>;

      // Anthropic reasoning
      processAnthropicReasoning: (
        text: string,
        modelId: string,
        agentName: string | null,
        config: any
      ) => Promise<{ success: boolean; text?: string; error?: string }>;

      // llama.cpp management
      llamaCppCheck: () => Promise<{ isInstalled: boolean; version?: string }>;
      llamaCppInstall: () => Promise<{ success: boolean; error?: string }>;
      llamaCppUninstall: () => Promise<{ success: boolean; error?: string }>;

      // Window control operations
      windowMinimize: () => Promise<void>;
      windowMaximize: () => Promise<void>;
      windowClose: () => Promise<void>;
      windowIsMaximized: () => Promise<boolean>;
      getPlatform: () => string;
      startWindowDrag: () => Promise<void>;
      stopWindowDrag: () => Promise<void>;
      setMainWindowInteractivity: (interactive: boolean) => Promise<void>;

      // App management
      appQuit: () => Promise<void>;
      cleanupApp: () => Promise<{ success: boolean; message: string }>;

      // Update operations
      checkForUpdates: () => Promise<UpdateCheckResult>;
      downloadUpdate: () => Promise<UpdateResult>;
      installUpdate: () => Promise<UpdateResult>;
      getAppVersion: () => Promise<AppVersionResult>;
      getUpdateStatus: () => Promise<UpdateStatusResult>;
      getUpdateInfo: () => Promise<UpdateInfoResult | null>;

      // Update event listeners
      onUpdateAvailable: (callback: (event: any, info: any) => void) => () => void;
      onUpdateNotAvailable: (callback: (event: any, info: any) => void) => () => void;
      onUpdateDownloaded: (callback: (event: any, info: any) => void) => () => void;
      onUpdateDownloadProgress: (callback: (event: any, progressObj: any) => void) => () => void;
      onUpdateError: (callback: (event: any, error: any) => void) => () => void;

      openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;

      // Hotkey management
      updateHotkey: (key: string) => Promise<{ success: boolean; message: string }>;
      updateClipboardHotkey?: (key: string) => Promise<{ success: boolean; message: string }>;
      setHotkeyListeningMode?: (
        enabled: boolean,
        newHotkey?: string | null,
        target?: "insert" | "clipboard"
      ) => Promise<{ success: boolean }>;
      getHotkeyModeInfo?: () => Promise<{ isUsingGnome: boolean }>;

      // Globe key listener for hotkey capture (macOS only)
      onGlobeKeyPressed?: (callback: () => void) => () => void;
      onGlobeKeyReleased?: (callback: () => void) => () => void;

      // Hotkey registration events
      onHotkeyFallbackUsed?: (
        callback: (data: { original: string; fallback: string; message: string }) => void
      ) => () => void;
      onHotkeyRegistrationFailed?: (
        callback: (data: { hotkey: string; error: string; suggestions: string[] }) => void
      ) => () => void;
      onWindowsPushToTalkUnavailable?: (
        callback: (data: { reason: string; message: string }) => void
      ) => () => void;

      // Gemini API key management
      getGeminiKey: () => Promise<string | null>;
      saveGeminiKey: (key: string) => Promise<void>;

      // Groq API key management
      getGroqKey: () => Promise<string | null>;
      saveGroqKey: (key: string) => Promise<void>;

      // Mistral API key management
      getMistralKey: () => Promise<string | null>;
      saveMistralKey: (key: string) => Promise<void>;
      proxyMistralTranscription: (data: {
        audioBuffer: ArrayBuffer;
        model?: string;
        language?: string;
        contextBias?: string[];
      }) => Promise<{ text: string }>;

      // Custom endpoint API keys
      getCustomTranscriptionKey?: () => Promise<string | null>;
      saveCustomTranscriptionKey?: (key: string) => Promise<void>;
      getCustomReasoningKey?: () => Promise<string | null>;
      saveCustomReasoningKey?: (key: string) => Promise<void>;

      // Dictation key persistence (file-based for reliable startup)
      getDictationKey?: () => Promise<string | null>;
      saveDictationKey?: (key: string) => Promise<void>;
      getDictationKeyClipboard?: () => Promise<string | null>;
      saveDictationKeyClipboard?: (key: string) => Promise<void>;

      // Activation mode persistence (file-based for reliable startup)
      getActivationMode?: () => Promise<"tap" | "push">;
      saveActivationMode?: (mode: "tap" | "push") => Promise<void>;

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
        logLevel: string;
      }>;
      setDebugLogging: (enabled: boolean) => Promise<{
        success: boolean;
        enabled?: boolean;
        logPath?: string | null;
        error?: string;
      }>;
      openLogsFolder: () => Promise<{ success: boolean; error?: string }>;

      // FFmpeg availability
      checkFFmpegAvailability: () => Promise<FFmpegAvailabilityResult>;
      getAudioDiagnostics: () => Promise<AudioDiagnosticsResult>;

      // System settings helpers
      requestMicrophoneAccess?: () => Promise<{ granted: boolean }>;
      openMicrophoneSettings?: () => Promise<{ success: boolean; error?: string }>;
      openSoundInputSettings?: () => Promise<{ success: boolean; error?: string }>;
      openAccessibilitySettings?: () => Promise<{ success: boolean; error?: string }>;
      openWhisperModelsFolder?: () => Promise<{ success: boolean; error?: string }>;

      // Windows Push-to-Talk notifications
      notifyActivationModeChanged?: (mode: "tap" | "push") => void;
      notifyHotkeyChanged?: (hotkey: string) => void;
      notifyClipboardHotkeyChanged?: (hotkey: string) => void;

      // Auto-start at login
      getAutoStartEnabled?: () => Promise<boolean>;
      setAutoStartEnabled?: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;

      // Auth
      authClearSession?: () => Promise<void>;

      // OpenWhispr Cloud API
      cloudTranscribe?: (
        audioBuffer: ArrayBuffer,
        opts: { language?: string; prompt?: string }
      ) => Promise<{
        success: boolean;
        text?: string;
        wordsUsed?: number;
        wordsRemaining?: number;
        limitReached?: boolean;
        error?: string;
        code?: string;
      }>;
      cloudReason?: (
        text: string,
        opts: { model?: string; agentName?: string; customDictionary?: string[] }
      ) => Promise<{
        success: boolean;
        text?: string;
        model?: string;
        provider?: string;
        error?: string;
        code?: string;
      }>;
      cloudUsage?: () => Promise<{
        success: boolean;
        wordsUsed?: number;
        wordsRemaining?: number;
        limit?: number;
        plan?: string;
        isSubscribed?: boolean;
        isTrial?: boolean;
        trialDaysLeft?: number | null;
        currentPeriodEnd?: string | null;
        resetAt?: string;
        error?: string;
        code?: string;
      }>;
      cloudCheckout?: () => Promise<{
        success: boolean;
        url?: string;
        error?: string;
        code?: string;
      }>;
      cloudBillingPortal?: () => Promise<{
        success: boolean;
        url?: string;
        error?: string;
        code?: string;
      }>;

      // Usage limit events
      notifyLimitReached?: (data: { wordsUsed: number; limit: number }) => void;
      onLimitReached?: (
        callback: (data: { wordsUsed: number; limit: number }) => void
      ) => () => void;

      // AssemblyAI Streaming
      assemblyAiStreamingWarmup?: (options?: {
        sampleRate?: number;
        language?: string;
      }) => Promise<{
        success: boolean;
        alreadyWarm?: boolean;
        error?: string;
        code?: string;
      }>;
      assemblyAiStreamingStart?: (options?: { sampleRate?: number; language?: string }) => Promise<{
        success: boolean;
        usedWarmConnection?: boolean;
        error?: string;
        code?: string;
      }>;
      assemblyAiStreamingSend?: (audioBuffer: ArrayBuffer) => Promise<{
        success: boolean;
        error?: string;
      }>;
      assemblyAiStreamingForceEndpoint?: () => void;
      assemblyAiStreamingStop?: () => Promise<{
        success: boolean;
        text?: string;
        error?: string;
      }>;
      assemblyAiStreamingStatus?: () => Promise<{
        isConnected: boolean;
        sessionId: string | null;
      }>;
      onAssemblyAiPartialTranscript?: (callback: (text: string) => void) => () => void;
      onAssemblyAiFinalTranscript?: (callback: (text: string) => void) => () => void;
      onAssemblyAiError?: (callback: (error: string) => void) => () => void;
      onAssemblyAiSessionEnd?: (
        callback: (data: { audioDuration?: number; text?: string }) => void
      ) => () => void;
    };

    api?: {
      sendDebugLog: (message: string) => void;
    };
  }
}
