export interface ElectronAPIAssemblyAiStreaming {
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
}

