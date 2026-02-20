import type { TranscriptionItem, TranscriptionMeta } from "../electron";

export interface ElectronAPIDatabase {
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

  // Database event listeners
  onTranscriptionAdded?: (callback: (item: TranscriptionItem) => void) => () => void;
  onTranscriptionUpdated?: (callback: (item: TranscriptionItem) => void) => () => void;
  onTranscriptionDeleted?: (callback: (payload: { id: number }) => void) => () => void;
  onTranscriptionsCleared?: (callback: (payload: { cleared: number }) => void) => () => void;
}

