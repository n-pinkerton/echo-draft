import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  manager: null as any,
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
    mocks.toggleHandler = null;
    mocks.manager = {
      getState: vi.fn(() => ({
        isRecording: false,
        isProcessing: true,
        isStreaming: false,
        queuedProcessingJobs: 0,
      })),
      setCallbacks: vi.fn(),
      shouldUseStreaming: vi.fn(() => true),
      startRecording: vi.fn(async () => true),
      startStreamingRecording: vi.fn(async () => true),
      cancelStreamingStartup: vi.fn(() => false),
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
      onNoAudioDetected: vi.fn(() => vi.fn()),
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
});
