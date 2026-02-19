import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_ENDPOINTS } from "../../../config/constants";
import { OpenAiTranscriber } from "./openAiTranscriber.js";

const encoder = new TextEncoder();

const makeReaderResponseFromChunks = (chunks: string[]) => {
  let index = 0;
  return {
    body: {
      getReader: () => ({
        read: async () => {
          if (index >= chunks.length) {
            return { value: undefined, done: true };
          }
          return { value: encoder.encode(chunks[index++]), done: false };
        },
      }),
    },
  };
};

describe("OpenAiTranscriber", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    (window as any).electronAPI = {
      getOpenAIKey: vi.fn(async () => "sk-test"),
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("getTranscriptionModel returns provider-appropriate defaults when model mismatches", () => {
    const t = new OpenAiTranscriber({ logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } });

    localStorage.setItem("cloudTranscriptionProvider", "groq");
    localStorage.setItem("cloudTranscriptionModel", "gpt-4o-mini-transcribe");
    expect(t.getTranscriptionModel()).toBe("whisper-large-v3-turbo");

    localStorage.setItem("cloudTranscriptionProvider", "custom");
    localStorage.setItem("cloudTranscriptionModel", "");
    expect(t.getTranscriptionModel()).toBe("whisper-1");
  });

  it("getTranscriptionEndpoint enforces https for custom endpoints and invalidates cache on change", () => {
    const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const t = new OpenAiTranscriber({ logger });

    localStorage.setItem("cloudTranscriptionProvider", "custom");
    localStorage.setItem("cloudTranscriptionBaseUrl", "http://example.com/v1");
    expect(t.getTranscriptionEndpoint()).toBe(API_ENDPOINTS.TRANSCRIPTION);

    localStorage.setItem("cloudTranscriptionBaseUrl", "https://example.com/v1");
    expect(t.getTranscriptionEndpoint()).toBe("https://example.com/v1/audio/transcriptions");
  });

  it("readTranscriptionStream returns collected deltas and emits transcribing progress", async () => {
    const emitProgress = vi.fn();
    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };
    const t = new OpenAiTranscriber({ logger, emitProgress });

    const response = makeReaderResponseFromChunks([
      'data: {"type":"transcript.text.delta","delta":"Hello"}\n\n',
      'data: {"type":"transcript.text.delta","delta":" world"}\n\n',
      "data: [DONE]\n\n",
    ]);

    await expect(t.readTranscriptionStream(response as any)).resolves.toBe("Hello world");

    expect(emitProgress).toHaveBeenCalledTimes(2);
    expect(emitProgress.mock.calls[0][0]).toEqual({
      stage: "transcribing",
      stageLabel: "Transcribing",
      generatedChars: 5,
      generatedWords: 1,
    });
    expect(emitProgress.mock.calls[1][0]).toEqual({
      stage: "transcribing",
      stageLabel: "Transcribing",
      generatedChars: 11,
      generatedWords: 2,
    });
  });

  it("processWithOpenAIAPI parses JSON and applies reasoning cleanup when enabled", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "whisper-1");

    const emitProgress = vi.fn();
    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };
    const reasoningCleanupService = {
      processTranscription: vi.fn(async () => "hello [cleaned]"),
    };

    const t = new OpenAiTranscriber({
      logger,
      emitProgress,
      shouldApplyReasoningCleanup: () => true,
      getCleanupEnabledOverride: () => null,
      reasoningCleanupService,
    });

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: (key: string) => (key.toLowerCase() === "content-type" ? "application/json" : "") },
      text: async () => JSON.stringify({ text: "hello" }),
    })) as any;

    const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const result = await t.processWithOpenAIAPI(audioBlob as any, {});

    expect(result.success).toBe(true);
    expect(result.rawText).toBe("hello");
    expect(result.text).toBe("hello [cleaned]");
    expect(result.source).toBe("openai-reasoned");
    expect(emitProgress).toHaveBeenCalledWith({ stage: "cleaning", stageLabel: "Cleaning up" });
    expect(reasoningCleanupService.processTranscription).toHaveBeenCalledTimes(1);
  });

  it("retries without prompt when the transcript matches the custom dictionary prompt", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "whisper-1");
    localStorage.setItem(
      "customDictionary",
      JSON.stringify(["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa"])
    );

    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };
    const t = new OpenAiTranscriber({ logger });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "application/json" },
        text: async () =>
          JSON.stringify({ text: "Alpha, Beta, Gamma, Delta, Epsilon, Zeta, Eta, Theta, Iota, Kappa" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify({ text: "Real transcription" }),
      });

    globalThis.fetch = fetchMock as any;

    const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const result = await t.processWithOpenAIAPI(audioBlob as any, {});

    expect(result.text).toBe("Real transcription");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

