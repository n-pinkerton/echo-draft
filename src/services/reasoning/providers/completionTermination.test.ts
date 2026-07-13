import { describe, expect, it, vi } from "vitest";

import { callChatCompletionsApi } from "./chatCompletionsApi";
import { processWithGeminiProvider } from "./geminiProvider";

const commonOptions = {
  text: "Keep every substantive point in this dictation.",
  model: "test-model",
  agentName: null,
  config: {},
  apiKey: "test-key",
  getSystemPrompt: () => "Clean dictation without changing meaning.",
  calculateMaxTokens: () => 4096,
};

describe("cleanup provider termination handling", () => {
  it.each(["length", "content_filter", "tool_calls"])(
    "rejects chat-completions text with finish_reason=%s",
    async (finishReason) => {
      const fetchFn = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: { content: "Partial cleanup that must not be accepted." },
              finish_reason: finishReason,
            },
          ],
        }),
      }));

      await expect(
        callChatCompletionsApi({
          ...commonOptions,
          endpoint: "https://example.test/chat/completions",
          providerName: "Compatible provider",
          fetchFn: fetchFn as any,
        })
      ).rejects.toMatchObject({ code: "CLEANUP_INCOMPLETE", finishReason });
    }
  );

  it.each(["MAX_TOKENS", "SAFETY", "RECITATION"])(
    "rejects Gemini text with finishReason=%s",
    async (finishReason) => {
      const fetchFn = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: { parts: [{ text: "Partial cleanup that must not be accepted." }] },
              finishReason,
            },
          ],
        }),
      }));

      await expect(
        processWithGeminiProvider({ ...commonOptions, fetchFn: fetchFn as any })
      ).rejects.toMatchObject({ code: "CLEANUP_INCOMPLETE", finishReason });
    }
  );
});
