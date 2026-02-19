import { beforeEach, describe, expect, it, vi } from "vitest";

import { CloudTranscriber } from "./cloudTranscriber";

const createLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
});

const setOnline = (value: boolean) => {
  Object.defineProperty(navigator, "onLine", {
    value,
    configurable: true,
  });
};

describe("CloudTranscriber", () => {
  beforeEach(() => {
    localStorage.clear();
    setOnline(true);
    (window as any).electronAPI = {
      cloudTranscribe: vi.fn(),
      cloudReason: vi.fn(),
    };
  });

  it("throws OFFLINE when navigator is offline", async () => {
    setOnline(false);

    const transcriber = new CloudTranscriber({
      logger: createLogger(),
      withSessionRefresh: async (fn: any) => await fn(),
      reasoningCleanupService: { processWithReasoningModel: vi.fn() },
    });

    const audioBlob = { arrayBuffer: vi.fn(async () => new ArrayBuffer(4)) } as any;
    await expect(transcriber.processWithEchoDraftCloud(audioBlob)).rejects.toMatchObject({
      code: "OFFLINE",
    });
  });

  it("guards against dictionary prompt echo", async () => {
    const dictionaryEntries = Array.from({ length: 10 }, (_, i) => `Term ${i + 1}`);
    localStorage.setItem("customDictionary", JSON.stringify(dictionaryEntries));

    (window as any).electronAPI.cloudTranscribe.mockResolvedValue({
      success: true,
      text: dictionaryEntries.join(", "),
      limitReached: false,
      wordsUsed: 1,
      wordsRemaining: 1,
    });

    const transcriber = new CloudTranscriber({
      logger: createLogger(),
      withSessionRefresh: async (fn: any) => await fn(),
      reasoningCleanupService: { processWithReasoningModel: vi.fn() },
    });

    const audioBlob = { arrayBuffer: vi.fn(async () => new ArrayBuffer(4)) } as any;
    await expect(transcriber.processWithEchoDraftCloud(audioBlob)).rejects.toThrow(
      "dictionary prompt"
    );
  });

  it("applies cloud reasoning when enabled", async () => {
    localStorage.setItem("useReasoningModel", "true");
    localStorage.setItem("cloudReasoningMode", "openwhispr");

    (window as any).electronAPI.cloudTranscribe.mockResolvedValue({
      success: true,
      text: "raw",
      limitReached: false,
      wordsUsed: 1,
      wordsRemaining: 1,
    });
    (window as any).electronAPI.cloudReason.mockResolvedValue({
      success: true,
      text: "clean",
    });

    const emitProgress = vi.fn();
    const transcriber = new CloudTranscriber({
      logger: createLogger(),
      emitProgress,
      withSessionRefresh: async (fn: any) => await fn(),
      reasoningCleanupService: { processWithReasoningModel: vi.fn() },
      getCleanupEnabledOverride: () => null,
    });

    const audioBlob = { arrayBuffer: vi.fn(async () => new ArrayBuffer(4)) } as any;
    const result = await transcriber.processWithEchoDraftCloud(audioBlob);

    expect(emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "cleaning", stageLabel: "Cleaning up" })
    );
    expect((window as any).electronAPI.cloudReason).toHaveBeenCalledTimes(1);
    expect(result.text).toBe("clean");
    expect(result.rawText).toBe("raw");
    expect(result.source).toBe("openwhispr-reasoned");
    expect(result.timings?.transcriptionProcessingDurationMs).toEqual(expect.any(Number));
    expect(result.timings?.reasoningProcessingDurationMs).toEqual(expect.any(Number));
  });

  it("applies BYOK reasoning when configured", async () => {
    localStorage.setItem("useReasoningModel", "true");
    localStorage.setItem("cloudReasoningMode", "byok");
    localStorage.setItem("reasoningModel", "o1-mini");

    (window as any).electronAPI.cloudTranscribe.mockResolvedValue({
      success: true,
      text: "raw",
      limitReached: false,
      wordsUsed: 1,
      wordsRemaining: 1,
    });

    const processWithReasoningModel = vi.fn(async () => "clean");
    const transcriber = new CloudTranscriber({
      logger: createLogger(),
      withSessionRefresh: async (fn: any) => await fn(),
      reasoningCleanupService: { processWithReasoningModel },
      getCleanupEnabledOverride: () => null,
    });

    const audioBlob = { arrayBuffer: vi.fn(async () => new ArrayBuffer(4)) } as any;
    const result = await transcriber.processWithEchoDraftCloud(audioBlob);

    expect(processWithReasoningModel).toHaveBeenCalledTimes(1);
    expect((window as any).electronAPI.cloudReason).not.toHaveBeenCalled();
    expect(result.source).toBe("openwhispr-byok-reasoned");
    expect(result.text).toBe("clean");
  });
});
