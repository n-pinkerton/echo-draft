export interface ElectronAPIHotkeys {
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

  // Windows Push-to-Talk notifications
  notifyActivationModeChanged?: (mode: "tap" | "push") => void;
  notifyHotkeyChanged?: (hotkey: string) => void;
  notifyClipboardHotkeyChanged?: (hotkey: string) => void;
}

