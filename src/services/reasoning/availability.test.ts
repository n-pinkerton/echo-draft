import { describe, expect, it } from "vitest";

import { checkReasoningAvailability } from "./availability";

describe("checkReasoningAvailability", () => {
  it("returns true when any provider key is present", async () => {
    await expect(
      checkReasoningAvailability({
        getApiKeyStatus: async () => ({ openai: true }),
        checkLocalReasoningAvailable: async () => false,
      })
    ).resolves.toBe(true);
  });

  it("returns false when no keys are present and local is unavailable", async () => {
    await expect(
      checkReasoningAvailability({
        getApiKeyStatus: async () => ({}),
        checkLocalReasoningAvailable: async () => false,
      })
    ).resolves.toBe(false);
  });

  it("checks the selected provider instead of treating an unrelated key as available", async () => {
    const electronAPI = {
      getApiKeyStatus: async () => ({ openai: true }),
      checkLocalReasoningAvailable: async () => false,
    };

    await expect(checkReasoningAvailability(electronAPI, "openai")).resolves.toBe(true);
    await expect(checkReasoningAvailability(electronAPI, "anthropic")).resolves.toBe(false);
  });

  it("allows custom endpoints that do not require an API key", async () => {
    await expect(checkReasoningAvailability({}, "custom")).resolves.toBe(true);
  });

  it("returns false when electronAPI throws", async () => {
    await expect(
      checkReasoningAvailability({
        getApiKeyStatus: async () => {
          throw new Error("boom");
        },
      })
    ).resolves.toBe(false);
  });
});
