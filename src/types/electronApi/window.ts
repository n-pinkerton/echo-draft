import type { DictationTriggerPayload, InsertionTargetSnapshot } from "../electron";

export interface ElectronAPIWindow {
  // Basic window operations
  pasteText: (
    text: string,
    options?: {
      fromStreaming?: boolean;
      insertionTarget?: InsertionTargetSnapshot | null;
      sessionId?: string;
    }
  ) => Promise<{
    success: boolean;
    errorCode?: string;
    clipboardWriteCommitted?: boolean;
    clipboardRetained?: boolean;
    insertionMayHaveOccurred?: boolean;
    inserted?: boolean;
    clipboardRestored?: boolean;
    warningCode?: string;
  }>;
  hideWindow: () => Promise<void>;
  showDictationPanel: () => Promise<void>;
  showRecordingIndicator?: (
    sizeKey?: "RECORDING_INDICATOR" | "WITH_COMPACT_TOAST" | "WITH_TOAST"
  ) => Promise<{ success: boolean; message?: string }>;
  resizeMainWindow?: (
    sizeKey: "RECORDING_INDICATOR" | "WITH_COMPACT_TOAST" | "WITH_TOAST"
  ) => Promise<{ success: boolean; message?: string }>;
  showControlPanel: () => Promise<{ success: boolean }>;
  getControlPanelShortcutStatus?: () => Promise<{
    accelerator: string;
    registered: boolean;
    reason?: string | null;
  }>;
  onControlPanelShortcutStatusChanged?: (
    callback: (status: { accelerator: string; registered: boolean; reason?: string | null }) => void
  ) => () => void;
  onToggleDictation: (callback: (payload?: DictationTriggerPayload) => void) => () => void;
  onStartDictation?: (callback: (payload?: DictationTriggerPayload) => void) => () => void;
  onStopDictation?: (callback: (payload?: DictationTriggerPayload) => void) => () => void;
  onCancelDictationProcessing?: (callback: () => void) => () => void;

  // Window control operations
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
  getPlatform: () => string;
  startWindowDrag: () => Promise<void>;
  stopWindowDrag: () => Promise<void>;
  setMainWindowInteractivity: (interactive: boolean) => Promise<void>;
  updateTrayStatus?: (status: {
    stage: string;
    stageLabel?: string;
    message?: string;
    transcriptToCopy?: string;
    [key: string]: unknown;
  }) => void;

  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
  beginOAuthSession: () => Promise<{ state: string; expiresAt: number }>;
}
