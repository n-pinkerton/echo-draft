import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocalTranscriber } from "./localTranscriber";

const createLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
});

describe("LocalTranscriber", () => {
  beforeEach(() => {
    localStorage.clear();
    (window as any).electronAPI = {
      transcribeLocalWhisper: vi.fn(),
      transcribeLocalParakeet: vi.fn(),
    };
  });

  it("processWithLocalWhisper forwards language + custom dictionary prompt", async () => {
    localStorage.setItem("preferredLanguage", "en-US");
    localStorage.setItem("customDictionary", JSON.stringify(["Foo", "Bar"]));

    (window as any).electronAPI.transcribeLocalWhisper.mockResolvedValue({
      success: true,
      text: "Hello there",
    });

    const transcriber = new LocalTranscriber({
      logger: createLogger(),
      shouldApplyReasoningCleanup: () => false,
      reasoningCleanupService: { processTranscription: vi.fn() },
      openAiTranscriber: { processWithOpenAIAPI: vi.fn() },
    });

    const audioBlob = {
      type: "audio/webm",
      arrayBuffer: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
    } as any;
    const result = await transcriber.processWithLocalWhisper(audioBlob, "base", {});

    expect((window as any).electronAPI.transcribeLocalWhisper).toHaveBeenCalledTimes(1);
    const [_buffer, options] = (window as any).electronAPI.transcribeLocalWhisper.mock.calls[0];
    expect(options).toMatchObject({
      model: "base",
      language: "en",
      initialPrompt: "Foo, Bar",
    });

    expect(result).toMatchObject({
      success: true,
      text: "Hello there",
      rawText: "Hello there",
      source: "local",
    });
    expect(result.timings?.transcriptionProcessingDurationMs).toEqual(expect.any(Number));
  });

  it("processWithLocalWhisper applies reasoning cleanup when enabled", async () => {
    (window as any).electronAPI.transcribeLocalWhisper.mockResolvedValue({
      success: true,
      text: "Raw text",
    });

    const processTranscription = vi.fn(async () => "Cleaned text");
    const emitProgress = vi.fn();
    const transcriber = new LocalTranscriber({
      logger: createLogger(),
      emitProgress,
      shouldApplyReasoningCleanup: () => true,
      getCleanupEnabledOverride: () => null,
      reasoningCleanupService: { processTranscription },
      openAiTranscriber: { processWithOpenAIAPI: vi.fn() },
    });

    const audioBlob = {
      type: "audio/webm",
      arrayBuffer: vi.fn(async () => new Uint8Array([1]).buffer),
    } as any;
    const result = await transcriber.processWithLocalWhisper(audioBlob, "base", {});

    expect(emitProgress).toHaveBeenCalledWith({ stage: "cleaning", stageLabel: "Cleaning up" });
    expect(processTranscription).toHaveBeenCalledTimes(1);
    expect(result.text).toBe("Cleaned text");
    expect(result.rawText).toBe("Raw text");
    expect(result.timings?.reasoningProcessingDurationMs).toEqual(expect.any(Number));
  });

  it("propagates cancellation during local-transcription cleanup", async () => {
    (window as any).electronAPI.transcribeLocalWhisper.mockResolvedValue({
      success: true,
      text: "Raw text",
    });
    const controller = new AbortController();
    const processTranscriptionWithOutcome = vi.fn(
      async (_text: string, _source: string, _override: unknown, runtime: any) =>
        await new Promise((_resolve, reject) => {
          runtime.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );
    const transcriber = new LocalTranscriber({
      logger: createLogger(),
      shouldApplyReasoningCleanup: () => true,
      getCleanupEnabledOverride: () => null,
      reasoningCleanupService: { processTranscriptionWithOutcome },
      openAiTranscriber: { processWithOpenAIAPI: vi.fn() },
    });
    const pending = transcriber.processWithLocalWhisper(
      {
        type: "audio/webm",
        arrayBuffer: vi.fn(async () => new Uint8Array([1]).buffer),
      } as any,
      "base",
      {},
      { signal: controller.signal }
    );
    await vi.waitFor(() => expect(processTranscriptionWithOutcome).toHaveBeenCalledOnce());

    controller.abort();

    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
      code: "TRANSCRIPTION_CANCELLED",
      cancelled: true,
    });
  });

  it("cancels pending local Whisper IPC work without waiting for its reply", async () => {
    const controller = new AbortController();
    const cancelIpcRequest = vi.fn(async () => ({ success: true }));
    (window as any).electronAPI.cancelIpcRequest = cancelIpcRequest;
    (window as any).electronAPI.transcribeLocalWhisper.mockImplementation(
      async () => await new Promise(() => {})
    );
    const transcriber = new LocalTranscriber({
      logger: createLogger(),
      shouldApplyReasoningCleanup: () => false,
      reasoningCleanupService: { processTranscription: vi.fn() },
      openAiTranscriber: { processWithOpenAIAPI: vi.fn() },
    });
    const pending = transcriber.processWithLocalWhisper(
      {
        type: "audio/webm",
        arrayBuffer: vi.fn(async () => new Uint8Array([1]).buffer),
      } as any,
      "base",
      {},
      { signal: controller.signal }
    );
    await vi.waitFor(() =>
      expect((window as any).electronAPI.transcribeLocalWhisper).toHaveBeenCalledOnce()
    );
    const requestId = (window as any).electronAPI.transcribeLocalWhisper.mock.calls[0][2];

    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "TRANSCRIPTION_CANCELLED" });
    expect(cancelIpcRequest).toHaveBeenCalledWith(requestId);
  });

  it("processWithLocalWhisper falls back to OpenAI when configured", async () => {
    localStorage.setItem("allowOpenAIFallback", "true");
    localStorage.setItem("useLocalWhisper", "true");

    (window as any).electronAPI.transcribeLocalWhisper.mockRejectedValue(new Error("boom"));

    const openAiTranscriber = {
      processWithOpenAIAPI: vi.fn(async (_blob: any, metadata: any) => ({
        success: true,
        text: "Fallback",
        rawText: "Fallback",
        source: "openai",
        timings: { transcriptionProcessingDurationMs: 1 },
        echo: metadata?.echo,
      })),
    };

    const transcriber = new LocalTranscriber({
      logger: createLogger(),
      shouldApplyReasoningCleanup: () => false,
      reasoningCleanupService: { processTranscription: vi.fn() },
      openAiTranscriber,
    });

    const audioBlob = {
      type: "audio/webm",
      arrayBuffer: vi.fn(async () => new Uint8Array([1]).buffer),
    } as any;
    const result = await transcriber.processWithLocalWhisper(audioBlob, "base", { echo: true });

    expect(openAiTranscriber.processWithOpenAIAPI).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("openai-fallback");
    expect(result.text).toBe("Fallback");
  });

  it("processWithLocalWhisper surfaces no-audio as an error", async () => {
    (window as any).electronAPI.transcribeLocalWhisper.mockResolvedValue({
      success: false,
      message: "No audio detected",
    });

    const transcriber = new LocalTranscriber({
      logger: createLogger(),
      shouldApplyReasoningCleanup: () => false,
      reasoningCleanupService: { processTranscription: vi.fn() },
      openAiTranscriber: { processWithOpenAIAPI: vi.fn() },
    });

    const audioBlob = {
      type: "audio/webm",
      arrayBuffer: vi.fn(async () => new Uint8Array([1]).buffer),
    } as any;
    await expect(transcriber.processWithLocalWhisper(audioBlob, "base", {})).rejects.toThrow(
      "No audio detected"
    );
  });

  it("processWithLocalParakeet forwards model and IPC call", async () => {
    (window as any).electronAPI.transcribeLocalParakeet.mockResolvedValue({
      success: true,
      text: "Hello from Parakeet",
    });

    const transcriber = new LocalTranscriber({
      logger: createLogger(),
      shouldApplyReasoningCleanup: () => false,
      reasoningCleanupService: { processTranscription: vi.fn() },
      openAiTranscriber: { processWithOpenAIAPI: vi.fn() },
    });

    const audioBlob = {
      type: "audio/webm",
      arrayBuffer: vi.fn(async () => new Uint8Array([1, 2]).buffer),
    } as any;
    const result = await transcriber.processWithLocalParakeet(
      audioBlob,
      "parakeet-tdt-0.6b-v3",
      {}
    );

    expect((window as any).electronAPI.transcribeLocalParakeet).toHaveBeenCalledTimes(1);
    const [_buffer, options] = (window as any).electronAPI.transcribeLocalParakeet.mock.calls[0];
    expect(options.model).toBe("parakeet-tdt-0.6b-v3");
    expect(result.source).toBe("local-parakeet");
    expect(result.text).toBe("Hello from Parakeet");
  });
});
