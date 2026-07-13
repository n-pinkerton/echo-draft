import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useReasoningSettings } from "./useReasoningSettings";

describe("useReasoningSettings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("migrates a retired OpenAI cleanup model in state and storage", async () => {
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("reasoningModel", "gpt-5.5-mini");

    const { result } = renderHook(() => useReasoningSettings());

    await waitFor(() => expect(result.current.reasoningModel).toBe("gpt-5.6-terra"));
    expect(localStorage.getItem("reasoningModel")).toBe("gpt-5.6-terra");
  });

  it("preserves the same model ID for a custom endpoint", () => {
    localStorage.setItem("reasoningProvider", "custom");
    localStorage.setItem("reasoningModel", "gpt-4.1");

    const { result } = renderHook(() => useReasoningSettings());

    expect(result.current.reasoningModel).toBe("gpt-4.1");
    expect(localStorage.getItem("reasoningModel")).toBe("gpt-4.1");
  });

  it("defaults cleanup reasoning to low and persists explicit changes", () => {
    const { result } = renderHook(() => useReasoningSettings());

    expect(result.current.cleanupReasoningEffort).toBe("low");
    expect(localStorage.getItem("cleanupReasoningEffort")).toBe("low");

    act(() => result.current.setCleanupReasoningEffort("none"));

    expect(result.current.cleanupReasoningEffort).toBe("none");
    expect(localStorage.getItem("cleanupReasoningEffort")).toBe("none");
  });

  it("normalizes an unsupported cleanup reasoning value to low", () => {
    localStorage.setItem("cleanupReasoningEffort", "extreme");

    const { result } = renderHook(() => useReasoningSettings());

    expect(result.current.cleanupReasoningEffort).toBe("low");
    expect(localStorage.getItem("cleanupReasoningEffort")).toBe("low");
  });
});
