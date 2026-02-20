import type { DictationTriggerPayload, InsertionTargetSnapshot } from "../electron";

export interface ElectronAPIWindow {
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

  // Window control operations
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
  getPlatform: () => string;
  startWindowDrag: () => Promise<void>;
  stopWindowDrag: () => Promise<void>;
  setMainWindowInteractivity: (interactive: boolean) => Promise<void>;

  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
}

