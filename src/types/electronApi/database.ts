import type {
  AppStyleProfile,
  AppWritingStyle,
  CorrectionFlag,
  CorrectionReason,
  CorrectionRule,
  ReprocessingAlternative,
  ReprocessingMode,
  TodoItem,
  TranscriptionItem,
  TranscriptionMeta,
} from "../electron";

export interface ElectronAPIDatabase {
  // Database operations
  saveTranscription: (payload: {
    text: string;
    rawText: string;
    meta?: Record<string, any>;
  }) => Promise<{ id: number; success: boolean; transcription?: TranscriptionItem }>;
  getTranscriptions: (limit?: number) => Promise<TranscriptionItem[]>;
  getLatestTranscription?: () => Promise<TranscriptionItem | null>;
  getPendingTodos: (limit?: number) => Promise<TodoItem[]>;
  getArchivedTodos: (options?: {
    query?: string;
    cursor?: { sortEpoch: number; id: number } | null;
    limit?: number;
  }) => Promise<{
    items: TodoItem[];
    nextCursor: { sortEpoch: number; id: number } | null;
  }>;
  markTodoActioned: (
    id: number
  ) => Promise<{ success: boolean; alreadyActioned?: boolean; message?: string }>;
  saveReprocessingAlternative: (payload: {
    transcriptionId?: number;
    todoId?: number;
    mode: ReprocessingMode;
    text: string;
    meta?: Record<string, unknown>;
  }) => Promise<{ success: boolean; alternative: ReprocessingAlternative }>;
  getCorrectionRules: () => Promise<CorrectionRule[]>;
  getWritingPreferences: (processName?: string | null) => Promise<{
    correctionRules: CorrectionRule[];
    writingStyle: AppWritingStyle | null;
  }>;
  saveCorrectionRule: (payload: {
    id?: number;
    sourcePhrase: string;
    replacementText: string;
    enabled?: boolean;
  }) => Promise<{ success: boolean; id: number }>;
  deleteCorrectionRule: (id: number) => Promise<{ success: boolean }>;
  getAppStyleProfiles: () => Promise<AppStyleProfile[]>;
  saveAppStyleProfile: (payload: {
    id?: number;
    processName: string;
    style: AppWritingStyle;
    enabled?: boolean;
  }) => Promise<{ success: boolean; id: number }>;
  deleteAppStyleProfile: (id: number) => Promise<{ success: boolean }>;
  setCorrectionFlag: (payload: {
    transcriptionId?: number;
    todoId?: number;
    reason: CorrectionReason;
  }) => Promise<{ success: boolean; correctionFlag: CorrectionFlag }>;
  clearCorrectionFlag: (payload: {
    transcriptionId?: number;
    todoId?: number;
  }) => Promise<{ success: boolean; cleared: number }>;
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
    userDataPath: string;
    activationMode: "tap" | "push" | string;
    insertHotkey: string | null;
    clipboardHotkey: string | null;
    insertUsesNativeListener: boolean;
    clipboardUsesNativeListener: boolean;
    insertNativeReady: boolean;
    clipboardNativeReady: boolean;
    insertGlobalRegistered: boolean;
    clipboardGlobalRegistered: boolean;
    windowsPushToTalkAvailable: boolean;
  }>;
  e2eGetTrayStatus?: () => Promise<{
    stage?: string;
    stageLabel?: string;
    statusLabel?: string;
    message?: string;
    recordedMs?: number | null;
    elapsedMs?: number | null;
    generatedWords?: number | null;
  }>;
  clearTranscriptions: () => Promise<{ cleared: number; success: boolean }>;
  deleteTranscription: (id: number) => Promise<{ success: boolean }>;

  // Database event listeners
  onTranscriptionAdded?: (callback: (item: TranscriptionItem) => void) => () => void;
  onTranscriptionUpdated?: (callback: (item: TranscriptionItem) => void) => () => void;
  onTranscriptionDeleted?: (callback: (payload: { id: number }) => void) => () => void;
  onTranscriptionsCleared?: (callback: (payload: { cleared: number }) => void) => () => void;
  onRetentionDataChanged?: (callback: (payload: { reason: "retention" }) => void) => () => void;
}
