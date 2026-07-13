import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ECHO_DRAFT_BYOK_REASONED_SOURCE,
  ECHO_DRAFT_CLOUD_MODE,
  ECHO_DRAFT_CLOUD_SOURCE,
  ECHO_DRAFT_REASONED_SOURCE,
} from "../../../utils/branding";
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
    localStorage.setItem("cloudReasoningMode", ECHO_DRAFT_CLOUD_MODE);

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
      reasoningCleanupService: {
        processWithReasoningModel: vi.fn(),
        validateCleanupCandidate: (_raw: string, text: string) => ({
          text,
          assessment: { metrics: {} },
        }),
      },
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
    expect(result.source).toBe(ECHO_DRAFT_REASONED_SOURCE);
    expect(result.timings?.transcriptionProcessingDurationMs).toEqual(expect.any(Number));
    expect(result.timings?.reasoningProcessingDurationMs).toEqual(expect.any(Number));
  });

  it("propagates cancellation during managed cloud cleanup", async () => {
    localStorage.setItem("useReasoningModel", "true");
    localStorage.setItem("cloudReasoningMode", ECHO_DRAFT_CLOUD_MODE);
    const controller = new AbortController();
    (window as any).electronAPI.cloudTranscribe.mockResolvedValue({
      success: true,
      text: "raw",
    });
    (window as any).electronAPI.cloudReason.mockImplementation(
      async () => await new Promise(() => {})
    );
    const transcriber = new CloudTranscriber({
      logger: createLogger(),
      withSessionRefresh: async (fn: any) => await fn(),
      reasoningCleanupService: { validateCleanupCandidate: vi.fn() },
    });
    const pending = transcriber.processWithEchoDraftCloud(
      { arrayBuffer: vi.fn(async () => new ArrayBuffer(4)) } as any,
      {},
      { signal: controller.signal }
    );
    await vi.waitFor(() => expect((window as any).electronAPI.cloudReason).toHaveBeenCalledOnce());

    controller.abort();

    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
      code: "TRANSCRIPTION_CANCELLED",
      cancelled: true,
    });
  });

  it("preserves raw cloud text when cleanup fails fidelity validation", async () => {
    localStorage.setItem("useReasoningModel", "true");
    localStorage.setItem("cloudReasoningMode", ECHO_DRAFT_CLOUD_MODE);

    (window as any).electronAPI.cloudTranscribe.mockResolvedValue({
      success: true,
      text: "Keep the Friday deadline, budget caveat, and reference 42.",
    });
    (window as any).electronAPI.cloudReason.mockResolvedValue({
      success: true,
      text: "Release summary.",
    });
    const fidelityError = Object.assign(new Error("changed too much"), {
      code: "CLEANUP_FIDELITY_REJECTED",
      assessment: { metrics: { wordRatio: 0.2 } },
    });
    const transcriber = new CloudTranscriber({
      logger: createLogger(),
      withSessionRefresh: async (fn: any) => await fn(),
      reasoningCleanupService: {
        validateCleanupCandidate: vi.fn(() => {
          throw fidelityError;
        }),
      },
    });

    const result = await transcriber.processWithEchoDraftCloud({
      arrayBuffer: vi.fn(async () => new ArrayBuffer(4)),
    } as any);

    expect(result.text).toBe("Keep the Friday deadline, budget caveat, and reference 42.");
    expect(result.cleanup).toMatchObject({
      status: "fallback",
      fallbackReason: "fidelity_rejected",
      applied: false,
    });
  });

  it("does not accept text from an unsuccessful managed cleanup response", async () => {
    localStorage.setItem("useReasoningModel", "true");
    localStorage.setItem("cloudReasoningMode", ECHO_DRAFT_CLOUD_MODE);

    (window as any).electronAPI.cloudTranscribe.mockResolvedValue({
      success: true,
      text: "Keep the complete original transcript.",
    });
    (window as any).electronAPI.cloudReason.mockResolvedValue({
      success: false,
      text: "Partial provider output.",
    });
    const validateCleanupCandidate = vi.fn();
    const transcriber = new CloudTranscriber({
      logger: createLogger(),
      withSessionRefresh: async (fn: any) => await fn(),
      reasoningCleanupService: { validateCleanupCandidate },
    });

    const result = await transcriber.processWithEchoDraftCloud({
      arrayBuffer: vi.fn(async () => new ArrayBuffer(4)),
    } as any);

    expect(result.text).toBe("Keep the complete original transcript.");
    expect(validateCleanupCandidate).not.toHaveBeenCalled();
    expect(result.cleanup).toMatchObject({
      status: "fallback",
      fallbackReason: "provider_error",
      applied: false,
      model: null,
      provider: ECHO_DRAFT_CLOUD_SOURCE,
    });
  });

  it("reports the configured provider and model for BYOK cleanup failures", async () => {
    localStorage.setItem("useReasoningModel", "true");
    localStorage.setItem("cloudReasoningMode", "byok");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("reasoningModel", "gpt-5.6-terra");
    (window as any).electronAPI.cloudTranscribe.mockResolvedValue({
      success: true,
      text: "Keep the complete original transcript.",
    });

    const transcriber = new CloudTranscriber({
      logger: createLogger(),
      withSessionRefresh: async (fn: any) => await fn(),
      reasoningCleanupService: {
        processTranscriptionWithOutcome: vi.fn(async () => {
          throw new Error("provider unavailable");
        }),
      },
    });

    const result = await transcriber.processWithEchoDraftCloud({
      arrayBuffer: vi.fn(async () => new ArrayBuffer(4)),
    } as any);

    expect(result.text).toBe("Keep the complete original transcript.");
    expect(result.cleanup).toMatchObject({
      status: "fallback",
      model: "gpt-5.6-terra",
      provider: "openai",
    });
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
    expect(result.source).toBe(ECHO_DRAFT_BYOK_REASONED_SOURCE);
    expect(result.text).toBe("clean");
  });
});
