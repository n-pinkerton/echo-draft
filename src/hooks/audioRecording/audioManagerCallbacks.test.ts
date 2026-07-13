import { describe, expect, it, vi } from "vitest";

import { createAudioManagerCallbacks } from "./audioManagerCallbacks";

describe("createAudioManagerCallbacks", () => {
  it("plays the process cue only from a confirmed recording-closed progress event", () => {
    const playStopCue = vi.fn();
    const callbacks = createAudioManagerCallbacks({
      activeSessionRef: { current: null },
      audioManagerRef: { current: null },
      recordingSessionIdRef: { current: null },
      removeJob: vi.fn(),
      setIsProcessing: vi.fn(),
      setIsRecording: vi.fn(),
      setIsStreaming: vi.fn(),
      setPartialTranscript: vi.fn(),
      setProgress: vi.fn(),
      toast: vi.fn(),
      updateStage: vi.fn(),
      upsertJob: vi.fn(),
      onTranscriptionComplete: vi.fn(),
      playErrorCue: vi.fn(),
      playStopCue,
    });

    callbacks.onProgress({ stage: "transcribing", recordingClosed: false });
    expect(playStopCue).not.toHaveBeenCalled();

    callbacks.onProgress({ stage: "transcribing", recordingClosed: true });
    expect(playStopCue).toHaveBeenCalledTimes(1);
  });
});
