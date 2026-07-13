import { describe, expect, it, vi } from "vitest";

const { ModelManager } = require("./ModelManager");

const createManager = () => {
  const manager = new ModelManager();
  manager.ensureInitialized = vi.fn();
  manager.modelsDir = "C:\\models";
  manager.findModelById = vi.fn(() => ({
    model: { fileName: "cleanup.gguf", contextLength: 4096 },
    provider: { id: "local", name: "Local" },
  }));
  manager.checkModelValid = vi.fn(async () => true);
  return manager;
};

describe("ModelManager local reasoning cancellation", () => {
  it("passes cancellation into startup and stops a newly started server at the ready boundary", async () => {
    const manager = createManager();
    const controller = new AbortController();
    const stop = vi.fn(async () => {});
    const start = vi.fn(async (_path: string, options: { signal: AbortSignal }) => {
      expect(options.signal).toBe(controller.signal);
      controller.abort();
    });
    manager.serverManager = {
      ready: false,
      isAvailable: () => true,
      start,
      stop,
      inference: vi.fn(),
    };

    await expect(
      manager.runInference("cleanup", "private prompt", { signal: controller.signal })
    ).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });

    expect(start).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(manager.currentServerModelId).toBeNull();
    expect(manager.serverManager.inference).not.toHaveBeenCalled();
  });

  it("stops a server started for a request cancelled during inference", async () => {
    const manager = createManager();
    const controller = new AbortController();
    const stop = vi.fn(async () => {});
    const inference = vi.fn(
      async (_messages: unknown, options: { signal: AbortSignal }) =>
        await new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })),
            { once: true }
          );
        })
    );
    manager.serverManager = {
      ready: false,
      isAvailable: () => true,
      start: vi.fn(async () => {}),
      stop,
      inference,
      port: 8200,
    };

    const pending = manager.runInference("cleanup", "private prompt", {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(inference).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(stop).toHaveBeenCalledOnce();
    expect(manager.currentServerModelId).toBeNull();
  });

  it("does not stop a shared warm server when only inference is cancelled", async () => {
    const manager = createManager();
    const controller = new AbortController();
    const stop = vi.fn(async () => {});
    const inference = vi.fn(
      async (_messages: unknown, options: { signal: AbortSignal }) =>
        await new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })),
            { once: true }
          );
        })
    );
    manager.currentServerModelId = "cleanup";
    manager.serverManager = {
      ready: true,
      isAvailable: () => true,
      start: vi.fn(),
      stop,
      inference,
    };

    const pending = manager.runInference("cleanup", "private prompt", {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(inference).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(stop).not.toHaveBeenCalled();
    expect(manager.currentServerModelId).toBe("cleanup");
  });
});
