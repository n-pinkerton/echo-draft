import type { AudioDiagnosticsResult, FFmpegAvailabilityResult } from "../electron";

export interface ElectronAPISystem {
  // App management
  appQuit: () => Promise<void>;
  cleanupApp: () => Promise<{ success: boolean; message: string }>;

  // FFmpeg availability
  checkFFmpegAvailability: () => Promise<FFmpegAvailabilityResult>;
  getAudioDiagnostics: () => Promise<AudioDiagnosticsResult>;

  // System settings helpers
  requestMicrophoneAccess?: () => Promise<{ granted: boolean }>;
  openMicrophoneSettings?: () => Promise<{ success: boolean; error?: string }>;
  openSoundInputSettings?: () => Promise<{ success: boolean; error?: string }>;
  openAccessibilitySettings?: () => Promise<{ success: boolean; error?: string }>;
  openWhisperModelsFolder?: () => Promise<{ success: boolean; error?: string }>;

  // Auto-start at login
  getAutoStartEnabled?: () => Promise<boolean>;
  setAutoStartEnabled?: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;

  // Auth
  authClearSession?: () => Promise<void>;
}

