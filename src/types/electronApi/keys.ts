import type { LocalTranscriptionProvider } from "../electron";

export interface ElectronAPIKeys {
  // API key management
  getOpenAIKey: () => Promise<string>;
  saveOpenAIKey: (key: string) => Promise<{ success: boolean }>;
  createProductionEnvFile: (key: string) => Promise<void>;
  getAnthropicKey: () => Promise<string | null>;
  saveAnthropicKey: (key: string) => Promise<void>;
  saveAllKeysToEnv: () => Promise<{ success: boolean; path: string }>;
  syncStartupPreferences: (prefs: {
    useLocalWhisper: boolean;
    localTranscriptionProvider: LocalTranscriptionProvider;
    model?: string;
    reasoningProvider: string;
    reasoningModel?: string;
  }) => Promise<void>;

  // Gemini API key management
  getGeminiKey: () => Promise<string | null>;
  saveGeminiKey: (key: string) => Promise<void>;

  // Groq API key management
  getGroqKey: () => Promise<string | null>;
  saveGroqKey: (key: string) => Promise<void>;

  // Mistral API key management
  getMistralKey: () => Promise<string | null>;
  saveMistralKey: (key: string) => Promise<void>;
  proxyMistralTranscription: (data: {
    audioBuffer: ArrayBuffer;
    model?: string;
    language?: string;
    contextBias?: string[];
  }) => Promise<{ text: string }>;

  // Custom endpoint API keys
  getCustomTranscriptionKey?: () => Promise<string | null>;
  saveCustomTranscriptionKey?: (key: string) => Promise<void>;
  getCustomReasoningKey?: () => Promise<string | null>;
  saveCustomReasoningKey?: (key: string) => Promise<void>;

  // Dictation key persistence (file-based for reliable startup)
  getDictationKey?: () => Promise<string | null>;
  saveDictationKey?: (key: string) => Promise<void>;
  getDictationKeyClipboard?: () => Promise<string | null>;
  saveDictationKeyClipboard?: (key: string) => Promise<void>;

  // Activation mode persistence (file-based for reliable startup)
  getActivationMode?: () => Promise<"tap" | "push">;
  saveActivationMode?: (mode: "tap" | "push") => Promise<void>;
}

