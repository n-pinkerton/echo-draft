import { describe, expect, it, vi, beforeEach } from "vitest";

import { warmupStreamingConnection } from "./assemblyAiStreamingWarmup";

describe("assemblyAiStreamingWarmup", () => {
  beforeEach(() => {
    (window as any).electronAPI = {};
    localStorage.clear();
  });

  it("skips warmup when shouldUseStreaming is false (but still triggers mic warmup)", async () => {
    const warmupMicrophoneDriver = vi.fn(async () => true);

    const manager: any = {
      warmupMicrophoneDriver,
      shouldUseStreaming: () => false,
    };

    await expect(warmupStreamingConnection(manager)).resolves.toBe(false);
    expect(warmupMicrophoneDriver).toHaveBeenCalledTimes(1);
  });
});

