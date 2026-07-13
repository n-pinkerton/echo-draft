import type { InsertionTargetSnapshot, PasteToolsResult } from "../electron";

export interface ElectronAPIClipboard {
  // Clipboard operations
  writeClipboard: (text: string) => Promise<{ success: boolean }>;
  captureInsertionTarget?: (sessionId: string) => Promise<{
    success: boolean;
    reason?: string;
    error?: string;
    target?: InsertionTargetSnapshot;
  }>;
  e2eCreateDictationSession?: (
    outputMode?: "insert" | "clipboard" | "file"
  ) => Promise<{ sessionId: string; outputMode: "insert" | "clipboard" | "file"; triggeredAt: number }>;
  checkPasteTools: () => Promise<PasteToolsResult>;
  checkAccessibilityPermission: () => Promise<boolean>;
}
