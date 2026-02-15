import { describe, expect, it, vi } from "vitest";
import AudioManager from "../audioManager";

describe("AudioManager callback safety", () => {
  it("does not throw if onProgress throws", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const manager = new AudioManager();
    manager.setCallbacks({
      onStateChange: undefined,
      onError: undefined,
      onTranscriptionComplete: undefined,
      onPartialTranscript: undefined,
      onProgress: () => {
        throw new Error("progress handler boom");
      },
    });

    expect(() => manager.emitProgress({ stage: "listening" })).not.toThrow();

    consoleError.mockRestore();
  });

  it("does not throw if onStateChange throws", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const manager = new AudioManager();
    manager.setCallbacks({
      onStateChange: () => {
        throw new Error("state handler boom");
      },
      onError: undefined,
      onTranscriptionComplete: undefined,
      onPartialTranscript: undefined,
      onProgress: undefined,
    });

    expect(() =>
      manager.emitStateChange({ isRecording: true, isProcessing: false, isStreaming: false })
    ).not.toThrow();

    consoleError.mockRestore();
  });

  it("does not throw if onError throws", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const manager = new AudioManager();
    manager.setCallbacks({
      onStateChange: undefined,
      onError: () => {
        throw new Error("error handler boom");
      },
      onTranscriptionComplete: undefined,
      onPartialTranscript: undefined,
      onProgress: undefined,
    });

    expect(() =>
      manager.emitError({ title: "Test Error", description: "should not throw" })
    ).not.toThrow();

    consoleError.mockRestore();
  });
});
