import type { InsertionTargetSnapshot, PasteToolsResult } from "../electron";

export interface ElectronAPIClipboard {
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
}

