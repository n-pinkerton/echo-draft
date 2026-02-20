import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/neonAuth", () => ({
  withSessionRefresh: async (fn: any) => await fn(),
}));

vi.mock("../../services/ReasoningService", () => ({
  default: {
    processText: vi.fn(async (text: string) => text),
    isAvailable: vi.fn(async () => true),
  },
}));

import AudioManager from "../audioManager.js";

describe("AudioManager.saveDebugAudioCaptureIfEnabled", () => {
  beforeEach(() => {
    localStorage.clear();
    (window as any).electronAPI = {};
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("calls ipc when debug is enabled", async () => {
    const manager = new AudioManager();

    const getDebugState = vi.fn(async () => ({ enabled: true, logPath: null, logLevel: "debug" }));
    const debugSaveAudio = vi.fn(async () => ({
      success: true,
      filePath: "/tmp/openwhispr-audio.webm",
      bytes: 4,
      kept: 1,
      deleted: 0,
    }));

    (window as any).electronAPI = { getDebugState, debugSaveAudio };

    const fakeBlob = {
      type: "audio/webm",
      arrayBuffer: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
    };
    await manager.saveDebugAudioCaptureIfEnabled(fakeBlob as any, {
      sessionId: "test-session",
      jobId: 123,
      outputMode: "clipboard",
      durationSeconds: 1.23,
      stopReason: "manual",
      stopSource: "manual",
    });

    expect(getDebugState).toHaveBeenCalledTimes(1);
    expect(debugSaveAudio).toHaveBeenCalledTimes(1);
    expect(debugSaveAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: "audio/webm",
        sessionId: "test-session",
        jobId: 123,
        outputMode: "clipboard",
        audioBuffer: expect.any(ArrayBuffer),
      })
    );

    manager.cleanup();
  });

  it("is a no-op when debug is disabled", async () => {
    const manager = new AudioManager();

    const getDebugState = vi.fn(async () => ({ enabled: false, logPath: null, logLevel: "info" }));
    const debugSaveAudio = vi.fn(async () => ({ success: true }));

    (window as any).electronAPI = { getDebugState, debugSaveAudio };

    const fakeBlob = {
      type: "audio/webm",
      arrayBuffer: vi.fn(async () => new Uint8Array([1]).buffer),
    };
    await manager.saveDebugAudioCaptureIfEnabled(fakeBlob as any, { sessionId: "test-session" });

    expect(getDebugState).toHaveBeenCalledTimes(1);
    expect(debugSaveAudio).not.toHaveBeenCalled();

    manager.cleanup();
  });
});

