import { describe, expect, it } from "vitest";

import { checkReasoningAvailability } from "./availability";

describe("checkReasoningAvailability", () => {
  it("returns true when any provider key is present", async () => {
    await expect(
      checkReasoningAvailability({
        getOpenAIKey: async () => "sk-test",
        getAnthropicKey: async () => null,
        getGeminiKey: async () => null,
        getGroqKey: async () => null,
        checkLocalReasoningAvailable: async () => false,
      })
    ).resolves.toBe(true);
  });

  it("returns false when no keys are present and local is unavailable", async () => {
    await expect(
      checkReasoningAvailability({
        getOpenAIKey: async () => null,
        getAnthropicKey: async () => undefined,
        getGeminiKey: async () => "",
        getGroqKey: async () => null,
        checkLocalReasoningAvailable: async () => false,
      })
    ).resolves.toBe(false);
  });

  it("returns false when electronAPI throws", async () => {
    await expect(
      checkReasoningAvailability({
        getOpenAIKey: async () => {
          throw new Error("boom");
        },
      })
    ).resolves.toBe(false);
  });
});

