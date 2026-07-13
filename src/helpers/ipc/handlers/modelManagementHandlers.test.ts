import { describe, expect, it, vi } from "vitest";

import { registerModelManagementHandlers } from "./modelManagementHandlers.js";

const createHarness = () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler);
    }),
  };
  const frame = { url: "file:///app/index.html?controlPanel=true" };
  const sender = { mainFrame: frame, getURL: () => frame.url, send: vi.fn() };
  const windowManager = {
    controlPanelWindow: {
      __echoDraftTrustedUrl: frame.url,
      webContents: sender,
      isDestroyed: () => false,
    },
    mainWindow: null,
  };
  const modelManager = {
    getModelsWithStatus: vi.fn(async () => [
      { id: "safe-model", name: "Safe model", path: "C:\\private\\models\\safe.gguf" },
    ]),
    isModelDownloaded: vi.fn(async () => true),
    downloadModel: vi.fn(async (_modelId: string, onProgress: (...args: number[]) => void) => {
      onProgress(50, 5, 10);
      return "C:\\private\\models\\safe.gguf";
    }),
    deleteModel: vi.fn(async () => {}),
    deleteAllModels: vi.fn(async () => {}),
    cancelDownload: vi.fn(() => true),
    ensureLlamaCpp: vi.fn(async () => {}),
  };

  registerModelManagementHandlers(
    { ipcMain } as any,
    { environmentManager: {}, windowManager, modelManager } as any
  );

  return {
    handlers,
    modelManager,
    sender,
    trustedEvent: { sender, senderFrame: frame },
    untrustedEvent: {
      sender: { mainFrame: { url: "https://attacker.invalid" } },
      senderFrame: { url: "https://attacker.invalid" },
    },
  };
};

describe("modelManagementHandlers", () => {
  it("rejects untrusted model reads and mutations before touching the model manager", async () => {
    const harness = createHarness();

    await expect(
      harness.handlers.get("model-get-all")?.(harness.untrustedEvent)
    ).rejects.toThrow(/renderer is not trusted/i);
    await expect(
      harness.handlers.get("model-delete-all")?.(harness.untrustedEvent)
    ).rejects.toThrow(/renderer is not trusted/i);
    expect(harness.modelManager.getModelsWithStatus).not.toHaveBeenCalled();
    expect(harness.modelManager.deleteAllModels).not.toHaveBeenCalled();
  });

  it("does not expose local model paths to the trusted control panel", async () => {
    const harness = createHarness();

    await expect(harness.handlers.get("model-get-all")?.(harness.trustedEvent)).resolves.toEqual([
      { id: "safe-model", name: "Safe model" },
    ]);
    await expect(
      harness.handlers.get("model-download")?.(harness.trustedEvent, "safe-model")
    ).resolves.toEqual({ success: true });
    expect(harness.sender.send).toHaveBeenCalledWith("model-download-progress", {
      modelId: "safe-model",
      progress: 50,
      downloadedSize: 5,
      totalSize: 10,
    });
  });
});
