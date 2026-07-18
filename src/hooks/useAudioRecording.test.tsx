import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callbacks: null as any,
  manager: null as any,
  mobileInboxHandler: null as null | ((payload: any) => void),
  toggleHandler: null as null | ((payload: any) => void),
}));

vi.mock("../helpers/audioManager", () => ({
  default: vi.fn(function MockAudioManager() {
    return mocks.manager;
  }),
}));

vi.mock("../utils/dictationCues", () => ({
  playCancelCue: vi.fn(),
  playCompletionCue: vi.fn(),
  playErrorCue: vi.fn(),
  playWarningCue: vi.fn(),
  playStartCue: vi.fn(),
  playStopCue: vi.fn(),
}));

import { useAudioRecording } from "./useAudioRecording";

describe("useAudioRecording stacked hotkey routing", () => {
  beforeEach(() => {
    mocks.callbacks = null;
    mocks.mobileInboxHandler = null;
    mocks.toggleHandler = null;
    mocks.manager = {
      activeProcessingContext: null,
      cancelProcessing: vi.fn(() => {
        mocks.manager.activeProcessingContext = null;
        return true;
      }),
      getState: vi.fn(() => ({
        isRecording: false,
        isProcessing: true,
        isStreaming: false,
        queuedProcessingJobs: 0,
      })),
      setCallbacks: vi.fn((callbacks) => {
        mocks.callbacks = callbacks;
      }),
      shouldUseStreaming: vi.fn(() => true),
      startRecording: vi.fn(async () => true),
      startStreamingRecording: vi.fn(async () => true),
      cancelStreamingStartup: vi.fn(() => false),
      enqueueProcessingJob: vi.fn(),
      warmupStreamingConnection: vi.fn(),
      cleanup: vi.fn(),
    };

    (window as any).electronAPI = {
      captureInsertionTarget: vi.fn(async () => ({ success: false })),
      onToggleDictation: vi.fn((handler: (payload: any) => void) => {
        mocks.toggleHandler = handler;
        return vi.fn();
      }),
      onStartDictation: vi.fn(() => vi.fn()),
      onStopDictation: vi.fn(() => vi.fn()),
      onCancelDictationProcessing: vi.fn(() => vi.fn()),
      onMobileInboxProcess: vi.fn((handler: (payload: any) => void) => {
        mocks.mobileInboxHandler = handler;
        return vi.fn();
      }),
      onNoAudioDetected: vi.fn(() => vi.fn()),
      completeMobileInboxItem: vi.fn(async () => ({ success: true })),
      mobileInboxRendererReady: vi.fn(async () => ({ success: true })),
    };
  });

  it("starts a queued insert recording while an earlier job is processing", async () => {
    const toast = vi.fn();
    const { unmount } = renderHook(() => useAudioRecording(toast));

    expect(mocks.toggleHandler).toBeTypeOf("function");
    await act(async () => {
      mocks.toggleHandler?.({
        sessionId: "stacked-hotkey",
        outputMode: "insert",
        triggeredAt: Date.now(),
      });
    });

    await waitFor(() => expect(mocks.manager.startRecording).toHaveBeenCalledOnce());
    expect(mocks.manager.startRecording).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "stacked-hotkey", outputMode: "insert" })
    );
    expect(mocks.manager.startStreamingRecording).not.toHaveBeenCalled();

    unmount();
  });

  it("settles a cancelled mobile inbox request so the desktop can retry it", async () => {
    const requestId = "550e8400-e29b-41d4-a716-446655440000";
    const externalId = "5f8d2d0e-3792-48cc-b8df-bf651c365a17";
    const toast = vi.fn();
    const { result, unmount } = renderHook(() => useAudioRecording(toast));
    await waitFor(() => expect(mocks.callbacks).toBeTruthy());

    act(() => {
      mocks.mobileInboxHandler?.({
        requestId,
        externalId,
        mimeType: "audio/mp4",
        createdAt: "2026-07-18T01:00:00.000Z",
        data: new Uint8Array([1, 2, 3]),
      });
    });
    const context = mocks.manager.enqueueProcessingJob.mock.calls[0][2];
    mocks.manager.activeProcessingContext = context;

    act(() => {
      mocks.callbacks.onProgress({ stage: "transcribing", context });
    });
    await waitFor(() => expect(result.current.progress.stage).toBe("transcribing"));

    let cancelled = false;
    act(() => {
      cancelled = result.current.cancelProcessing();
    });

    expect(cancelled).toBe(true);
    expect(mocks.manager.cancelProcessing).toHaveBeenCalledOnce();
    expect((window as any).electronAPI.completeMobileInboxItem).toHaveBeenCalledWith(requestId, {
      success: false,
    });

    unmount();
  });

  it("settles an active mobile inbox request before renderer hook cleanup", async () => {
    const requestId = "550e8400-e29b-41d4-a716-446655440000";
    const externalId = "5f8d2d0e-3792-48cc-b8df-bf651c365a17";
    const toast = vi.fn();
    const { unmount } = renderHook(() => useAudioRecording(toast));
    await waitFor(() => expect(mocks.callbacks).toBeTruthy());

    act(() => {
      mocks.mobileInboxHandler?.({
        requestId,
        externalId,
        mimeType: "audio/mp4",
        createdAt: "2026-07-18T01:00:00.000Z",
        data: new Uint8Array([1, 2, 3]),
      });
    });
    mocks.manager.activeProcessingContext = mocks.manager.enqueueProcessingJob.mock.calls[0][2];

    unmount();

    expect((window as any).electronAPI.completeMobileInboxItem).toHaveBeenCalledWith(requestId, {
      success: false,
    });
    expect(mocks.manager.cleanup).toHaveBeenCalledOnce();
  });

  it("does not fail a mobile inbox request again after successful completion", async () => {
    const requestId = "550e8400-e29b-41d4-a716-446655440000";
    const externalId = "5f8d2d0e-3792-48cc-b8df-bf651c365a17";
    const toast = vi.fn();
    const { unmount } = renderHook(() => useAudioRecording(toast));
    await waitFor(() => expect(mocks.callbacks).toBeTruthy());

    act(() => {
      mocks.mobileInboxHandler?.({
        requestId,
        externalId,
        mimeType: "audio/mp4",
        createdAt: "2026-07-18T01:00:00.000Z",
        data: new Uint8Array([1, 2, 3]),
      });
    });
    const context = mocks.manager.enqueueProcessingJob.mock.calls[0][2];

    await act(async () => {
      await mocks.callbacks.onTranscriptionComplete({
        success: true,
        title: "Call Taylor",
        text: "Call Taylor tomorrow.",
        rawText: "call taylor tomorrow",
        source: "openai",
        cleanup: { requested: true, status: "applied" },
        context,
      });
    });

    expect((window as any).electronAPI.completeMobileInboxItem).toHaveBeenCalledOnce();
    expect((window as any).electronAPI.completeMobileInboxItem).toHaveBeenCalledWith(
      requestId,
      expect.objectContaining({ success: true, title: "Call Taylor" })
    );

    unmount();

    expect((window as any).electronAPI.completeMobileInboxItem).toHaveBeenCalledOnce();
  });

  it("falls back to a failed result when a mobile success payload is rejected", async () => {
    const requestId = "550e8400-e29b-41d4-a716-446655440000";
    const externalId = "5f8d2d0e-3792-48cc-b8df-bf651c365a17";
    const completeMobileInboxItem = (window as any).electronAPI.completeMobileInboxItem;
    completeMobileInboxItem.mockRejectedValueOnce(new Error("Invalid completion text"));
    const toast = vi.fn();
    const { unmount } = renderHook(() => useAudioRecording(toast));
    await waitFor(() => expect(mocks.callbacks).toBeTruthy());

    act(() => {
      mocks.mobileInboxHandler?.({
        requestId,
        externalId,
        mimeType: "audio/mp4",
        createdAt: "2026-07-18T01:00:00.000Z",
        data: new Uint8Array([1, 2, 3]),
      });
    });
    const context = mocks.manager.enqueueProcessingJob.mock.calls[0][2];

    await act(async () => {
      await mocks.callbacks.onTranscriptionComplete({
        success: true,
        text: "x".repeat(20_001),
        rawText: "raw memo",
        source: "openai",
        context,
      });
    });

    expect(completeMobileInboxItem).toHaveBeenCalledTimes(2);
    expect(completeMobileInboxItem).toHaveBeenLastCalledWith(requestId, { success: false });

    unmount();

    expect(completeMobileInboxItem).toHaveBeenCalledTimes(2);
  });

  it("retains a mobile request for cleanup when both completion attempts reject", async () => {
    const requestId = "550e8400-e29b-41d4-a716-446655440000";
    const externalId = "5f8d2d0e-3792-48cc-b8df-bf651c365a17";
    const completeMobileInboxItem = (window as any).electronAPI.completeMobileInboxItem;
    completeMobileInboxItem
      .mockRejectedValueOnce(new Error("Invalid completion text"))
      .mockRejectedValueOnce(new Error("IPC unavailable"));
    const toast = vi.fn();
    const { unmount } = renderHook(() => useAudioRecording(toast));
    await waitFor(() => expect(mocks.callbacks).toBeTruthy());

    act(() => {
      mocks.mobileInboxHandler?.({
        requestId,
        externalId,
        mimeType: "audio/mp4",
        createdAt: "2026-07-18T01:00:00.000Z",
        data: new Uint8Array([1, 2, 3]),
      });
    });
    const context = mocks.manager.enqueueProcessingJob.mock.calls[0][2];

    await act(async () => {
      await mocks.callbacks.onTranscriptionComplete({
        success: true,
        text: "x".repeat(20_001),
        rawText: "raw memo",
        source: "openai",
        context,
      });
    });
    expect(completeMobileInboxItem).toHaveBeenCalledTimes(2);

    unmount();

    expect(completeMobileInboxItem).toHaveBeenCalledTimes(3);
    expect(completeMobileInboxItem).toHaveBeenLastCalledWith(requestId, { success: false });
  });

  it("settles a queued mobile inbox request when the renderer closes", async () => {
    const requestId = "550e8400-e29b-41d4-a716-446655440000";
    mocks.manager.activeProcessingContext = {
      sessionId: "desktop-dictation",
      outputMode: "insert",
    };
    const toast = vi.fn();
    const { unmount } = renderHook(() => useAudioRecording(toast));
    await waitFor(() => expect(mocks.mobileInboxHandler).toBeTypeOf("function"));

    act(() => {
      mocks.mobileInboxHandler?.({
        requestId,
        externalId: "5f8d2d0e-3792-48cc-b8df-bf651c365a17",
        mimeType: "audio/mp4",
        createdAt: "2026-07-18T01:00:00.000Z",
        data: new Uint8Array([1, 2, 3]),
      });
    });
    expect(mocks.manager.enqueueProcessingJob).toHaveBeenCalledOnce();

    unmount();

    expect((window as any).electronAPI.completeMobileInboxItem).toHaveBeenCalledTimes(1);
    expect((window as any).electronAPI.completeMobileInboxItem).toHaveBeenCalledWith(requestId, {
      success: false,
    });
    expect(mocks.manager.cleanup).toHaveBeenCalledOnce();
  });
});
