import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SAVED_KEY_PLACEHOLDER } from "../../config/apiKeys";
import { useApiKeySettings } from "./useApiKeySettings";

vi.mock("../../services/ReasoningService", () => ({
  default: { clearApiKeyCache: vi.fn() },
}));

const emptyStatus = {
  openai: false,
  anthropic: false,
  gemini: false,
  groq: false,
  mistral: false,
  customTranscription: false,
  customReasoning: false,
};

describe("useApiKeySettings", () => {
  beforeEach(() => {
    localStorage.clear();
    (window as any).electronAPI = {};
  });

  it("represents an existing key as status only and confirms a replacement after persistence", async () => {
    const saveOpenAIKey = vi.fn(async () => ({ success: true }));
    (window as any).electronAPI = {
      getApiKeyStatus: vi.fn(async () => ({ ...emptyStatus, openai: true })),
      saveOpenAIKey,
    };
    const { result } = renderHook(() => useApiKeySettings());
    await waitFor(() => expect(result.current.openaiApiKey).toBe(SAVED_KEY_PLACEHOLDER));

    await act(async () => result.current.setOpenaiApiKey("replacement-key"));

    expect(saveOpenAIKey).toHaveBeenCalledWith("replacement-key");
    expect(result.current.openaiApiKey).toBe(SAVED_KEY_PLACEHOLDER);
  });

  it("preserves saved status and rejects to the UI when persistence fails", async () => {
    const saveOpenAIKey = vi.fn(async () => ({ success: false }));
    (window as any).electronAPI = {
      getApiKeyStatus: vi.fn(async () => ({ ...emptyStatus, openai: true })),
      saveOpenAIKey,
    };
    const { result } = renderHook(() => useApiKeySettings());
    await waitFor(() => expect(result.current.openaiApiKey).toBe(SAVED_KEY_PLACEHOLDER));

    await expect(
      act(async () => result.current.setOpenaiApiKey("replacement-key"))
    ).rejects.toThrow("could not be saved");
    expect(result.current.openaiApiKey).toBe(SAVED_KEY_PLACEHOLDER);
  });
});
