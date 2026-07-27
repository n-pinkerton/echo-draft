import { describe, expect, it, vi, beforeEach } from "vitest";

import { saveAudioCapture } from "./debugAudioCaptureClient";

describe("debugAudioCaptureClient", () => {
  beforeEach(() => {
    (window as any).electronAPI = {};
  });

  it("calls ipc debugSaveAudio for every completed recording", async () => {
    const debugSaveAudio = vi.fn(async () => ({
      success: true,
      bytes: 4,
      kept: 1,
      deleted: 0,
    }));

    (window as any).electronAPI = { debugSaveAudio };

    const fakeBlob = {
      type: "audio/webm",
      arrayBuffer: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
    };

    await saveAudioCapture(fakeBlob as any, { sessionId: "s1", jobId: 1 });

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

  it("does not skip capture when debug logging is disabled", async () => {
    const debugSaveAudio = vi.fn(async () => ({ success: true }));

    (window as any).electronAPI = { debugSaveAudio };

    const fakeBlob = {
      type: "audio/webm",
      arrayBuffer: vi.fn(async () => new Uint8Array([1]).buffer),
    };

    await saveAudioCapture(fakeBlob as any, { sessionId: "s2" });

    expect(debugSaveAudio).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the main process does not save the capture", async () => {
    const debugSaveAudio = vi.fn(async () => ({ success: false, error: "capture unavailable" }));
    (window as any).electronAPI = { debugSaveAudio };

    const fakeBlob = {
      type: "audio/webm",
      arrayBuffer: vi.fn(async () => new Uint8Array([1]).buffer),
    };

    await expect(saveAudioCapture(fakeBlob as any, { sessionId: "s3" })).rejects.toThrow(
      "capture unavailable"
    );
  });
});
