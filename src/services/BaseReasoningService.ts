import { getSystemPrompt, type CleanupPromptMode } from "../config/prompts";

export interface ReasoningConfig {
  maxTokens?: number;
  temperature?: number;
  contextSize?: number;
  cleanupPromptMode?: CleanupPromptMode;
}

export abstract class BaseReasoningService {
  protected isProcessing = false;

  protected getCustomDictionary(): string[] {
    if (typeof window === "undefined" || !window.localStorage) return [];
    try {
      const raw = window.localStorage.getItem("customDictionary");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  protected getPreferredLanguage(): string {
    if (typeof window === "undefined" || !window.localStorage) return "auto";
    return window.localStorage.getItem("preferredLanguage") || "auto";
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
