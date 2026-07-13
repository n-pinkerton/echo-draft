import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useReasoningSettings } from "./useReasoningSettings";

describe("useReasoningSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    (window as any).electronAPI = {};
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

  it("keeps the previous custom endpoint when approval is cancelled", async () => {
    localStorage.setItem("reasoningProvider", "custom");
    localStorage.setItem("cloudReasoningBaseUrl", "https://approved.example/v1");
    const approve = vi.fn(async () => ({ success: false, cancelled: true }));
    (window as any).electronAPI = { approveCustomProviderEndpoint: approve };
    const { result } = renderHook(() => useReasoningSettings());

    let approved: Awaited<ReturnType<typeof result.current.setCloudReasoningBaseUrl>> | undefined;
    await act(async () => {
      approved = await result.current.setCloudReasoningBaseUrl("https://rejected.example/v1");
    });

    expect(approved).toEqual({
      status: "cancelled",
      message: "Endpoint approval was cancelled. Your previous endpoint is unchanged.",
    });
    expect(localStorage.getItem("cloudReasoningBaseUrl")).toBe("https://approved.example/v1");
    expect(approve).toHaveBeenCalledWith("reasoning", "https://rejected.example/v1");
  });

  it("returns actionable validation feedback for a rejected endpoint", async () => {
    localStorage.setItem("reasoningProvider", "custom");
    const approve = vi.fn(async () => {
      throw new Error("Custom endpoints must use HTTPS (except localhost)");
    });
    (window as any).electronAPI = { approveCustomProviderEndpoint: approve };
    const { result } = renderHook(() => useReasoningSettings());

    let outcome;
    await act(async () => {
      outcome = await result.current.setCloudReasoningBaseUrl("http://remote.example/v1");
    });

    expect(outcome).toEqual({
      status: "invalid",
      message: "Enter a valid HTTPS endpoint (HTTP is allowed only for localhost).",
    });
  });

  it("stores only the normalized endpoint returned by main-process approval", async () => {
    localStorage.setItem("reasoningProvider", "custom");
    const approve = vi.fn(async () => ({
      success: true,
      endpoint: "https://approved.example/v1",
    }));
    (window as any).electronAPI = { approveCustomProviderEndpoint: approve };
    const { result } = renderHook(() => useReasoningSettings());

    await act(async () => {
      await result.current.setCloudReasoningBaseUrl("https://approved.example/v1/?ignored=yes");
    });

    expect(localStorage.getItem("cloudReasoningBaseUrl")).toBe("https://approved.example/v1");
  });

  it("does not prompt for a standard endpoint selected in the same update", async () => {
    localStorage.setItem("reasoningProvider", "custom");
    const approve = vi.fn();
    (window as any).electronAPI = { approveCustomProviderEndpoint: approve };
    const { result } = renderHook(() => useReasoningSettings());

    await act(async () => {
      result.current.setReasoningProvider("openai");
      await result.current.setCloudReasoningBaseUrl("https://api.openai.com/v1");
    });

    expect(approve).not.toHaveBeenCalled();
    expect(localStorage.getItem("cloudReasoningBaseUrl")).toBe("https://api.openai.com/v1");
  });
});
