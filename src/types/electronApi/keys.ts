import type { CleanupPromptMode } from "../../config/prompts";
import type { LocalTranscriptionProvider } from "../electron";

export interface ElectronAPIKeys {
  // API key management
  getApiKeyStatus: () => Promise<{
    openai: boolean;
    anthropic: boolean;
    gemini: boolean;
    groq: boolean;
    mistral: boolean;
    customTranscription: boolean;
    customReasoning: boolean;
  }>;
  saveOpenAIKey: (key: string) => Promise<{ success: boolean }>;
  saveAnthropicKey: (key: string) => Promise<{ success: boolean }>;
  saveAllKeysToEnv: () => Promise<{ success: boolean; path: string }>;
  syncStartupPreferences: (prefs: {
    useLocalWhisper: boolean;
    localTranscriptionProvider: LocalTranscriptionProvider;
    model?: string;
    reasoningProvider: string;
    reasoningModel?: string;
  }) => Promise<void>;

  // Gemini API key management
  saveGeminiKey: (key: string) => Promise<{ success: boolean }>;

  // Groq API key management
  saveGroqKey: (key: string) => Promise<{ success: boolean }>;

  // Mistral API key management
  saveMistralKey: (key: string) => Promise<{ success: boolean }>;
  // Custom endpoint API keys
  saveCustomTranscriptionKey?: (key: string) => Promise<{ success: boolean }>;
  saveCustomReasoningKey?: (key: string) => Promise<{ success: boolean }>;
  approveCustomProviderEndpoint?: (
    purpose: "transcription" | "reasoning",
    endpoint: string
  ) => Promise<{ success: boolean; endpoint?: string; cancelled?: boolean }>;
  providerCleanupRequest?: (
    payload: {
      provider: string;
      endpoint: string;
      operation: {
        kind: "cleanup";
        variant: "responses" | "chat-completions" | "gemini-generate";
        model: string;
        userPrompt: string;
        cleanupPromptMode?: CleanupPromptMode;
        language?: string;
        maxOutputTokens: number;
        temperature?: number;
        reasoningEffort?: string;
      };
    },
    requestId: string,
    onProgress?: (progress: {
      generatedChars: number;
      generatedWords: number;
      isComplete: boolean;
    }) => void
  ) => Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
    timings?: { timeToHeadersMs: number; bodyReadDurationMs: number };
  }>;
  providerModelsRequest?: (
    payload: {
      purpose: "transcription" | "reasoning";
      endpoint: string;
    },
    requestId: string,
    onProgress?: (progress: {
      generatedChars: number;
      generatedWords: number;
      isComplete: boolean;
    }) => void
  ) => Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
    timings?: { timeToHeadersMs: number; bodyReadDurationMs: number };
  }>;
  providerTranscriptionRequest?: (
    payload: {
      provider: string;
      endpoint: string;
      audioBuffer: ArrayBuffer;
      mimeType?: string;
      model: string;
      language?: string;
      stream?: boolean;
      contextBias?: string[];
    },
    requestId: string
  ) => Promise<{ status: number; headers: Record<string, string>; body: string }>;

  // Dictation key persistence (file-based for reliable startup)
  getDictationKey?: () => Promise<string | null>;
  saveDictationKey?: (key: string) => Promise<void>;
  getDictationKeyClipboard?: () => Promise<string | null>;
  saveDictationKeyClipboard?: (key: string) => Promise<void>;

  // Activation mode persistence (file-based for reliable startup)
  getActivationMode?: () => Promise<"tap" | "push">;
  saveActivationMode?: (mode: "tap" | "push") => Promise<void>;
}
