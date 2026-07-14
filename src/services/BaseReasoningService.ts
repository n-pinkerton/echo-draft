import { getSystemPrompt, type CleanupPromptMode } from "../config/prompts";
import { getCustomDictionaryArray } from "../helpers/audio/transcription/customDictionary";

export type CleanupReasoningEffort = "none" | "low" | "medium";

export interface ReasoningConfig {
  maxTokens?: number;
  temperature?: number;
  contextSize?: number;
  cleanupPromptMode?: CleanupPromptMode;
  reasoningEffort?: CleanupReasoningEffort;
  signal?: AbortSignal;
}

export abstract class BaseReasoningService {
  protected isProcessing = false;

  protected getPreferredLanguage(): string {
    if (typeof window === "undefined" || !window.localStorage) return "auto";
    return window.localStorage.getItem("preferredLanguage") || "auto";
  }

  protected getCustomDictionary(): string[] {
    const customEntries = getCustomDictionaryArray(
      typeof window !== "undefined" ? window.localStorage : null
    );
    return customEntries;
  }

  protected getSystemPrompt(
    agentName: string | null,
    modelId?: string | null,
    mode: CleanupPromptMode = "standard"
  ): string {
    const language = this.getPreferredLanguage();
    return getSystemPrompt(agentName, this.getCustomDictionary(), language, modelId, mode);
  }

  protected calculateMaxTokens(
    textLength: number,
    minTokens = 100,
    maxTokens = 2048,
    multiplier = 2
  ): number {
    return Math.max(minTokens, Math.min(textLength * multiplier, maxTokens));
  }

  abstract isAvailable(): Promise<boolean>;

  abstract processText(
    text: string,
    modelId: string,
    agentName?: string | null,
    config?: ReasoningConfig
  ): Promise<string>;
}
