import { describe, expect, it, vi, beforeEach } from "vitest";

import { saveDebugAudioCaptureIfEnabled } from "./debugAudioCaptureClient";

describe("debugAudioCaptureClient", () => {
  beforeEach(() => {
    (window as any).electronAPI = {};
  });

  it("calls ipc debugSaveAudio when debug is enabled", async () => {
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

    await saveDebugAudioCaptureIfEnabled(fakeBlob as any, { sessionId: "s1", jobId: 1 });

    expect(getDebugState).toHaveBeenCalledTimes(1);
    expect(debugSaveAudio).toHaveBeenCalledTimes(1);

    expect(debugSaveAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: "audio/webm",
        sessionId: "s1",
        jobId: 1,
        audioBuffer: expect.any(ArrayBuffer),
      })
    );
  });

  it("is a no-op when debug is disabled", async () => {
    const getDebugState = vi.fn(async () => ({ enabled: false, logPath: null, logLevel: "info" }));
    const debugSaveAudio = vi.fn(async () => ({ success: true }));

    (window as any).electronAPI = { getDebugState, debugSaveAudio };

    const fakeBlob = {
      type: "audio/webm",
      arrayBuffer: vi.fn(async () => new Uint8Array([1]).buffer),
    };

    await saveDebugAudioCaptureIfEnabled(fakeBlob as any, { sessionId: "s2" });

    expect(getDebugState).toHaveBeenCalledTimes(1);
    expect(debugSaveAudio).not.toHaveBeenCalled();
  });
});
