import { afterEach, describe, expect, it, vi } from "vitest";

import { StreamingWorkletManager } from "./streamingWorkletManager";

describe("StreamingWorkletManager", () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it("caches the worklet blob URL and revokes it on dispose", () => {
    const createObjectURL = vi.fn(() => "blob:worklet");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const manager = new StreamingWorkletManager({
      logger: { debug: vi.fn() },
      flushDoneMessage: "DONE",
      shouldForward: () => false,
      onAudioChunk: vi.fn(),
    });

    expect(manager.getWorkletBlobUrl()).toBe("blob:worklet");
    expect(manager.getWorkletBlobUrl()).toBe("blob:worklet");
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    manager.dispose();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:worklet");
  });

  it("resolves flush waiter when flush done message is received", async () => {
    const manager = new StreamingWorkletManager({
      logger: { debug: vi.fn() },
      flushDoneMessage: "DONE",
      shouldForward: () => true,
      onAudioChunk: vi.fn(),
    });

    const waiter = manager.createFlushWaiter();
    manager.handleMessage({ data: "DONE" });

    await expect(waiter.promise).resolves.toBeUndefined();
  });

  it("forwards ArrayBuffer chunks only when forwarding is enabled", () => {
    const onAudioChunk = vi.fn();
    let shouldForward = false;

    const manager = new StreamingWorkletManager({
      logger: { debug: vi.fn() },
      flushDoneMessage: "DONE",
      shouldForward: () => shouldForward,
      onAudioChunk,
    });

    const buf = new ArrayBuffer(4);
    manager.handleMessage({ data: buf });
    expect(onAudioChunk).not.toHaveBeenCalled();

    shouldForward = true;
    manager.handleMessage({ data: buf });
    expect(onAudioChunk).toHaveBeenCalledWith(buf);
  });
});

