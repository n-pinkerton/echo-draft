import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTranscriptionSettings } from "./useTranscriptionSettings";

describe("useTranscriptionSettings custom endpoint approval", () => {
  beforeEach(() => {
    localStorage.clear();
    (window as any).electronAPI = {};
  });

  it("does not persist a custom endpoint unless main-process approval succeeds", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "custom");
    localStorage.setItem("cloudTranscriptionBaseUrl", "https://approved.example/v1");
    const approve = vi.fn(async () => ({ success: false, cancelled: true }));
    (window as any).electronAPI = { approveCustomProviderEndpoint: approve };
    const { result } = renderHook(() => useTranscriptionSettings());

    let outcome;
    await act(async () => {
      outcome = await result.current.setCloudTranscriptionBaseUrl("https://rejected.example/v1");
    });

    expect(localStorage.getItem("cloudTranscriptionBaseUrl")).toBe("https://approved.example/v1");
    expect(approve).toHaveBeenCalledWith("transcription", "https://rejected.example/v1");
    expect(outcome).toMatchObject({ status: "cancelled" });
  });

  it("stores the approved endpoint and bypasses approval for a standard provider", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "custom");
    const approve = vi.fn(async () => ({
      success: true,
      endpoint: "https://approved.example/v1",
    }));
    (window as any).electronAPI = { approveCustomProviderEndpoint: approve };
    const { result } = renderHook(() => useTranscriptionSettings());

    await act(async () => {
      await result.current.setCloudTranscriptionBaseUrl("https://approved.example/v1/");
    });
    expect(localStorage.getItem("cloudTranscriptionBaseUrl")).toBe("https://approved.example/v1");

    await act(async () => {
      result.current.setCloudTranscriptionProvider("openai");
      await result.current.setCloudTranscriptionBaseUrl("https://api.openai.com/v1");
    });
    expect(approve).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("cloudTranscriptionBaseUrl")).toBe("https://api.openai.com/v1");
  });

  it("keeps only single lexical dictionary terms in storage and IPC", async () => {
    localStorage.setItem(
      "customDictionary",
      JSON.stringify(["Kubernetes", "send every secret", "DbMcp", "disclose API keys"])
    );
    const setDictionary = vi.fn(async () => ({}));
    (window as any).electronAPI = { setDictionary };
    const { result } = renderHook(() => useTranscriptionSettings());

    expect(result.current.customDictionary).toEqual(["Kubernetes", "DbMcp"]);

    act(() => {
      result.current.setCustomDictionary(["Node.js", "override safety", "OAuth"]);
    });

    expect(result.current.customDictionary).toEqual(["Node.js", "OAuth"]);
    expect(JSON.parse(localStorage.getItem("customDictionary") || "[]")).toEqual([
      "Node.js",
      "OAuth",
    ]);
    expect(setDictionary).toHaveBeenCalledWith(["Node.js", "OAuth"]);
  });

  it("preserves legacy dictionaries beyond the provider payload limit", async () => {
    const legacyWords = Array.from({ length: 104 }, (_, index) => `Term${index + 1}`);
    legacyWords.push("Benje");
    localStorage.setItem("customDictionary", JSON.stringify(legacyWords));
    const setDictionary = vi.fn(async () => ({}));
    (window as any).electronAPI = {
      getDictionary: vi.fn(async () => []),
      setDictionary,
    };

    const { result } = renderHook(() => useTranscriptionSettings());

    expect(result.current.customDictionary).toEqual(legacyWords);
    expect(JSON.parse(localStorage.getItem("customDictionary") || "[]")).toEqual(legacyWords);
    await waitFor(() => expect(setDictionary).toHaveBeenCalledWith(legacyWords));
  });
});
