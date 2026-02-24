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

const makeStreamingSseResponse = (text: string, options: { includeDeltas?: boolean } = {}) => {
  const includeDeltas = options.includeDeltas !== false;
  const chunks: string[] = [];
  if (includeDeltas) {
    const parts = text.match(/\S+\s*|\s+/g) || [text];
    for (const part of parts) {
      chunks.push(`data: ${JSON.stringify({ type: "transcript.text.delta", delta: part })}\n\n`);
    }
  }
  chunks.push(`data: ${JSON.stringify({ type: "transcript.text.done", text })}\n\n`);
  chunks.push("data: [DONE]\n\n");

  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: (key: string) => (key.toLowerCase() === "content-type" ? "text/event-stream" : "") },
    ...makeReaderResponseFromChunks(chunks),
  };
};

const makeJsonResponse = (text: string) => ({
  ok: true,
  status: 200,
  statusText: "OK",
  headers: { get: (key: string) => (key.toLowerCase() === "content-type" ? "application/json" : "") },
  text: async () => JSON.stringify({ text }),
});

const LARGE_DICTIONARY = [
  "Hello Cashflow",
  "DbMcp",
  "SlackMcp",
  "MondayMcp",
  "AGENTS.md",
  "Codex",
  "PgSql",
  "DATABASE_DEV_URL",
  "scratchpad",
  "HelloCashflowNodeJs",
  "HelloCashflowApp",
  "HellocashflowAdmin",
  "HelloCashflowDomain",
  "organisationId",
  "MonthlySummary",
  "ProviderConnection",
  "QuickBooks",
  "Xero",
  "Cloudflare",
  "CloudShell",
  "logging",
  "Logging Mcp",
  "OpenWhispr",
  "Figma",
  "Partner Dashboard",
  "Help Center",
  "Bug Tracker",
  "My Targets",
  "Usage Tracking",
  "Financial Health Check",
  "Deep Dive",
  "Budget Editor",
  "Balance Sheet",
  "Playwright",
  "MCP",
  "Playwright MCP",
  "Slack",
  "Monday",
  "AWS",
  "S3",
  "PowerShell",
  "Git",
  "Codex CLI",
  "OpenAI",
  "Stripe",
  "TypeScript",
  "Node.js",
  "Postgres",
  "MUI",
  "Ciana",
];

const ASSISTANT_STYLE_REPLY = `Certainly, I understand the complexity and the comprehensive nature of what you're trying to achieve.

### Suggested Prompt

**Title:** Investigator Follow-up Agent

1. **Requirements Analysis:** Carefully review the original requirements and compare each item against implementation details.
2. **UI Best Practices:** Evaluate the current UI against established usability principles and navigation standards.
3. **Gap Analysis:** Log discrepancies, blockers, and quality issues with clear evidence and recommendations.
4. **Progress Tracking:** Continue reviewing changes and report status updates in an iterative workflow.

Let's refine this prompt together to ensure it meets all your requirements and sets clear expectations for the role.`;

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

  it("preserves long streamed text exactly (rules out SSE parser truncation)", async () => {
    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };
    const t = new OpenAiTranscriber({ logger });
    const dictionaryText = LARGE_DICTIONARY.join(", ");
    const response = makeStreamingSseResponse(dictionaryText, { includeDeltas: true });

    await expect(t.readTranscriptionStream(response as any)).resolves.toBe(dictionaryText);
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

  it("throws when dictionary echo retry is disabled (rules out save/cleanup overwrite as the trigger)", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "whisper-1");
    localStorage.setItem("customDictionary", JSON.stringify(LARGE_DICTIONARY));

    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };
    const t = new OpenAiTranscriber({ logger });

    globalThis.fetch = vi.fn(async () => makeJsonResponse(LARGE_DICTIONARY.join(", "))) as any;

    const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    await expect(
      t.processWithOpenAIAPI(audioBlob as any, { durationSeconds: 31.496 }, { allowPromptEchoRetry: false })
    ).rejects.toThrow(/dictionary prompt/i);
  });

  it("does not attach custom dictionary prompt for gpt-4o transcription models", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "gpt-4o-transcribe");
    localStorage.setItem("customDictionary", JSON.stringify(LARGE_DICTIONARY));

    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };
    const t = new OpenAiTranscriber({ logger });

    const fetchMock = vi.fn(async (_url: any, init: any) => {
      const body = init?.body as FormData;
      expect(body?.has("prompt")).toBe(false);
      return makeStreamingSseResponse("hello world");
    });

    globalThis.fetch = fetchMock as any;
    const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const result = await t.processWithOpenAIAPI(audioBlob as any, { durationSeconds: 10 });

    expect(result.rawText).toBe("hello world");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once when the transcript looks truncated for a long recording", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "gpt-4o-transcribe");

    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };
    const t = new OpenAiTranscriber({ logger });

    const fetchMock = vi.fn(async (_url: any, init: any) => {
      const formData = init?.body as FormData;
      const hasStream = typeof formData?.has === "function" ? formData.has("stream") : null;

      if (fetchMock.mock.calls.length === 1) {
        expect(hasStream).toBe(true);
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => "application/json" },
          text: async () => JSON.stringify({ text: "Hello" }),
        } as any;
      }

      expect(hasStream).toBe(false);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "application/json" },
        text: async () =>
          JSON.stringify({
            text: "Hello world this is a longer retry transcript that should be preferred",
          }),
      } as any;
    });

    globalThis.fetch = fetchMock as any;

    const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const result = await t.processWithOpenAIAPI(audioBlob as any, { durationSeconds: 20 });

    expect(result.rawText).toMatch(/longer retry transcript/);
    expect(result.text).toMatch(/longer retry transcript/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.timings.transcriptionAttemptCount).toBe(2);
    expect(result.timings.transcriptionRetried).toBe(true);
  });

  it("should reject unusable tiny transcripts after dictionary-echo + truncation retries for long audio", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "whisper-1");
    localStorage.setItem("customDictionary", JSON.stringify(LARGE_DICTIONARY));

    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };
    const t = new OpenAiTranscriber({ logger });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(LARGE_DICTIONARY.join(", "))) // primary: dictionary echo
      .mockResolvedValueOnce(makeJsonResponse("I love you.")) // primary-noprompt
      .mockResolvedValueOnce(makeJsonResponse("The sun is shining.")); // retry-truncation (forceNoStream)

    globalThis.fetch = fetchMock as any;

    const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    await expect(t.processWithOpenAIAPI(audioBlob as any, { durationSeconds: 31.496 })).rejects.toThrow(
      /suspiciously short|unusable|reliable/i
    );
  });

  it("should reject unusable tiny transcripts after dictionary-echo retry even when duration is unknown", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "whisper-1");
    localStorage.setItem("customDictionary", JSON.stringify(LARGE_DICTIONARY));

    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };
    const t = new OpenAiTranscriber({ logger });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(LARGE_DICTIONARY.join(", "))) // primary: dictionary echo
      .mockResolvedValueOnce(makeJsonResponse(".")); // primary-noprompt accepted today

    globalThis.fetch = fetchMock as any;

    const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    await expect(t.processWithOpenAIAPI(audioBlob as any, {})).rejects.toThrow(
      /suspiciously short|unusable|reliable/i
    );
  });

  it("retries when transcript looks assistant-generated and uses a better retry result", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "gpt-4o-transcribe");

    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };
    const t = new OpenAiTranscriber({ logger });

    const retryText =
      "Please continue checking the requirements carefully and list all blockers in the scratchpad, then verify each blocker against the original specification and document any missing requirements that still need implementation.";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeStreamingSseResponse(ASSISTANT_STYLE_REPLY))
      .mockResolvedValueOnce(makeJsonResponse(retryText));

    globalThis.fetch = fetchMock as any;

    const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const result = await t.processWithOpenAIAPI(audioBlob as any, { durationSeconds: 45 });

    expect(result.rawText).toBe(retryText);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.timings.transcriptionAttemptCount).toBe(2);
  });

  it("rejects assistant-style transcript when retry does not produce a reliable alternative", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "gpt-4o-transcribe");

    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };
    const t = new OpenAiTranscriber({ logger });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeStreamingSseResponse(ASSISTANT_STYLE_REPLY))
      .mockResolvedValueOnce(makeJsonResponse(ASSISTANT_STYLE_REPLY));

    globalThis.fetch = fetchMock as any;

    const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    await expect(t.processWithOpenAIAPI(audioBlob as any, { durationSeconds: 60 })).rejects.toThrow(
      /unreliable/i
    );
  });
});
