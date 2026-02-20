import type {
  ParakeetCheckResult,
  ParakeetDiagnosticsResult,
  ParakeetDownloadProgressData,
  ParakeetModelDeleteResult,
  ParakeetModelResult,
  ParakeetModelsListResult,
  ParakeetTranscriptionResult,
  WhisperCheckResult,
  WhisperDownloadProgressData,
  WhisperModelDeleteResult,
  WhisperModelResult,
  WhisperModelsListResult,
} from "../electron";

export interface ElectronAPIModels {
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
}
