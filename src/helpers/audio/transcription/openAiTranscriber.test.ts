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
    headers: {
      get: (key: string) => (key.toLowerCase() === "content-type" ? "text/event-stream" : ""),
    },
    ...makeReaderResponseFromChunks(chunks),
  };
};

const makeJsonResponse = (text: string) => ({
  ok: true,
  status: 200,
  statusText: "OK",
  headers: {
    get: (key: string) => (key.toLowerCase() === "content-type" ? "application/json" : ""),
  },
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
  "EchoDraft",
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
    vi.useRealTimers();
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
    expect(emitProgress.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        stage: "transcribing",
        stageLabel: "Transcribing",
        generatedChars: 5,
        generatedWords: 1,
        isSlow: false,
      })
    );
    expect(emitProgress.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        stage: "transcribing",
        stageLabel: "Transcribing",
        generatedChars: 11,
        generatedWords: 2,
        isSlow: false,
      })
    );
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
      headers: {
        get: (key: string) => (key.toLowerCase() === "content-type" ? "application/json" : ""),
      },
      text: async () => JSON.stringify({ text: "hello" }),
    })) as any;

    const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const result = await t.processWithOpenAIAPI(audioBlob as any, {});

    expect(result.success).toBe(true);
    expect(result.rawText).toBe("hello");
    expect(result.text).toBe("hello [cleaned]");
    expect(result.source).toBe("openai-reasoned");
    expect(emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "cleaning",
        stageLabel: "Cleaning up",
        canCancel: true,
      })
    );
    expect(reasoningCleanupService.processTranscription).toHaveBeenCalledTimes(1);
    expect(reasoningCleanupService.processTranscription).toHaveBeenCalledWith(
      "hello",
      "openai",
      null,
      { signal: null }
    );
  });

  it("aborts an in-flight cleanup request and returns cancellation", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "whisper-1");
    const controller = new AbortController();
    let cleanupSignal: AbortSignal | null = null;
    const reasoningCleanupService = {
      processTranscriptionWithOutcome: vi.fn(
        async (_text: string, _source: string, _override: unknown, runtime: any) =>
          await new Promise((_resolve, reject) => {
            cleanupSignal = runtime.signal;
            runtime.signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true }
            );
          })
      ),
    };
    const transcriber = new OpenAiTranscriber({
      logger: { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() },
      shouldApplyReasoningCleanup: () => true,
      getCleanupEnabledOverride: () => null,
      reasoningCleanupService,
    });
    globalThis.fetch = vi.fn(async () => makeJsonResponse("hello")) as any;

    const pending = transcriber.processWithOpenAIAPI(
      new Blob(["audio"], { type: "audio/webm" }) as any,
      {},
      { signal: controller.signal }
    );
    await vi.waitFor(() =>
      expect(reasoningCleanupService.processTranscriptionWithOutcome).toHaveBeenCalledOnce()
    );

    controller.abort();

    await expect(pending).rejects.toMatchObject({
      code: "TRANSCRIPTION_CANCELLED",
      cancelled: true,
    });
    expect(cleanupSignal?.aborted).toBe(true);
  });

  it("aborts an in-flight request without retrying or falling back", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "whisper-1");
    localStorage.setItem("allowLocalFallback", "true");
    const controller = new AbortController();
    const t = new OpenAiTranscriber({
      logger: { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() },
    });

    const fetchMock = vi.fn(
      async (_url: string, init: RequestInit) =>
        await new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );
    globalThis.fetch = fetchMock as any;
    const pending = t.processWithOpenAIAPI(
      new Blob(["audio"], { type: "audio/webm" }) as any,
      {},
      { signal: controller.signal }
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    controller.abort();

    await expect(pending).rejects.toMatchObject({
      code: "TRANSCRIPTION_CANCELLED",
      cancelled: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((window as any).electronAPI.transcribeLocalWhisper).toBeUndefined();
  });

  it("retries one transient HTTP failure sequentially and records phase telemetry", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "whisper-1");
    const emitProgress = vi.fn();
    const t = new OpenAiTranscriber({
      logger: { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() },
      emitProgress,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Unavailable",
        headers: { get: () => null },
        text: async () => JSON.stringify({ error: { message: "Temporarily unavailable" } }),
      })
      .mockResolvedValueOnce({
        ...makeJsonResponse("Recovered transcript"),
        headers: {
          get: (key: string) => {
            if (key.toLowerCase() === "content-type") return "application/json";
            if (key.toLowerCase() === "x-request-id") return "request-recovered";
            return null;
          },
        },
      });
    globalThis.fetch = fetchMock as any;

    const result = await t.processWithOpenAIAPI(
      new Blob(["audio"], { type: "audio/webm" }) as any,
      {},
      { transportRetryDelayMs: 0 }
    );

    expect(result.text).toBe("Recovered transcript");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.timings).toMatchObject({
      transcriptionTransportAttemptCount: 2,
      transcriptionTransportRetried: true,
      transcriptionRequestId: expect.stringMatching(/^req-[a-f0-9]{8}$/),
    });
    expect(result.timings.transcriptionTransportAttempts).toHaveLength(2);
    expect(result.timings.transcriptionTransportAttempts[0]).toMatchObject({
      status: 503,
      retryable: true,
    });
    expect(result.timings.transcriptionTransportAttempts[1]).toMatchObject({
      status: 200,
      requestId: expect.stringMatching(/^req-[a-f0-9]{8}$/),
      outcome: "success",
    });
    expect(emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        stageLabel: "Retrying transcription",
        transportRetrying: true,
        transportAttempt: 2,
      })
    );
  });

  it("does not retry a non-transient HTTP error", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "whisper-1");
    const t = new OpenAiTranscriber({
      logger: { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() },
    });
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      headers: { get: () => null },
      text: async () => JSON.stringify({ error: { message: "Invalid audio" } }),
    }));
    globalThis.fetch = fetchMock as any;

    await expect(
      t.processWithOpenAIAPI(new Blob(["audio"], { type: "audio/webm" }) as any)
    ).rejects.toMatchObject({ code: "TRANSCRIPTION_HTTP_ERROR", httpStatus: 400 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("drops malformed provider request IDs from logs and stored timings", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "whisper-1");
    const sentinel = "PRIVATE_TRANSCRIPT_SENTINEL\r\nInjected: yes";
    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };
    const transcriber = new OpenAiTranscriber({ logger });
    globalThis.fetch = vi.fn(async () => ({
      ...makeJsonResponse("Safe transcript"),
      statusText: sentinel,
      headers: {
        get: (key: string) => {
          if (key.toLowerCase() === "content-type") return "application/json";
          if (key.toLowerCase() === "x-request-id") return sentinel;
          return null;
        },
      },
    })) as any;

    const result = await transcriber.processWithOpenAIAPI(
      new Blob(["audio"], { type: "audio/webm" }) as any
    );

    expect(result.timings.transcriptionRequestId).toBeUndefined();
    expect(result.timings.transcriptionRequestIds).toBeUndefined();
    expect(JSON.stringify(logger)).not.toContain("PRIVATE_TRANSCRIPT_SENTINEL");
  });

  it("never exposes provider error messages or malformed codes", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "whisper-1");
    const sentinel = "PRIVATE_TRANSCRIPT_SENTINEL";
    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };
    const transcriber = new OpenAiTranscriber({ logger });
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      statusText: sentinel,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({ error: { message: sentinel, code: `${sentinel}\r\nInjected` } }),
    })) as any;

    const pending = transcriber.processWithOpenAIAPI(
      new Blob(["audio"], { type: "audio/webm" }) as any
    );

    await expect(pending).rejects.toMatchObject({
      code: "TRANSCRIPTION_HTTP_ERROR",
      message: "Transcription provider request failed (HTTP 400).",
    });
    expect(JSON.stringify(logger)).not.toContain(sentinel);
  });

  it("spends at most one transport retry budget for a dictation", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "whisper-1");
    const t = new OpenAiTranscriber({
      logger: { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() },
    });
    const transientResponse = () => ({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: { get: () => null },
      text: async () => JSON.stringify({ error: { message: "Try later" } }),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(transientResponse())
      .mockResolvedValueOnce(transientResponse())
      .mockResolvedValueOnce(makeJsonResponse("Must not be requested"));
    globalThis.fetch = fetchMock as any;

    await expect(
      t.processWithOpenAIAPI(
        new Blob(["audio"], { type: "audio/webm" }) as any,
        {},
        { transportRetryDelayMs: 0 }
      )
    ).rejects.toMatchObject({ code: "TRANSCRIPTION_HTTP_ERROR", httpStatus: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries one network error and never overlaps transport attempts", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "whisper-1");
    const t = new OpenAiTranscriber({
      logger: { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() },
    });
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        activeRequests -= 1;
        throw new TypeError("network unavailable");
      })
      .mockImplementationOnce(async () => {
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        activeRequests -= 1;
        return makeJsonResponse("Network recovered");
      });
    globalThis.fetch = fetchMock as any;

    const result = await t.processWithOpenAIAPI(
      new Blob(["audio"], { type: "audio/webm" }) as any,
      {},
      { transportRetryDelayMs: 0 }
    );

    expect(result.text).toBe("Network recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(maxActiveRequests).toBe(1);
  });

  it("retries once after a request timeout", async () => {
    vi.useFakeTimers();
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "whisper-1");
    const t = new OpenAiTranscriber({
      logger: { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() },
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        async (_url: string, init: RequestInit) =>
          await new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true }
            );
          })
      )
      .mockResolvedValueOnce(makeJsonResponse("Recovered after timeout"));
    globalThis.fetch = fetchMock as any;

    const pending = t.processWithOpenAIAPI(
      new Blob(["audio"], { type: "audio/webm" }) as any,
      {},
      { requestTimeoutMs: 1_000, transportRetryDelayMs: 0 }
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toMatchObject({ text: "Recovered after timeout" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("announces a slow provider after ten seconds and clears the slow state on success", async () => {
    vi.useFakeTimers();
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "whisper-1");
    const emitProgress = vi.fn();
    const t = new OpenAiTranscriber({
      logger: { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() },
      emitProgress,
    });
    let resolveFetch: ((value: any) => void) | null = null;
    globalThis.fetch = vi.fn(
      async () =>
        await new Promise((resolve) => {
          resolveFetch = resolve;
        })
    ) as any;

    const pending = t.processWithOpenAIAPI(
      new Blob(["audio"], { type: "audio/webm" }) as any,
      {},
      { slowRequestThresholdMs: 10_000 }
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(resolveFetch).toBeTypeOf("function");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        stageLabel: "Still transcribing",
        message: "OpenAI is taking longer than usual",
        isSlow: true,
        canCancel: true,
      })
    );

    resolveFetch?.(makeJsonResponse("Eventually completed"));
    await expect(pending).resolves.toMatchObject({ text: "Eventually completed" });
    expect(emitProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ isSlow: false, message: null })
    );
  });

  it("retries without prompt when the transcript matches the custom dictionary prompt", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "whisper-1");
    localStorage.setItem(
      "customDictionary",
      JSON.stringify([
        "Alpha",
        "Beta",
        "Gamma",
        "Delta",
        "Epsilon",
        "Zeta",
        "Eta",
        "Theta",
        "Iota",
        "Kappa",
      ])
    );

    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };
    const t = new OpenAiTranscriber({ logger });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "application/json" },
        text: async () =>
          JSON.stringify({
            text: "Alpha, Beta, Gamma, Delta, Epsilon, Zeta, Eta, Theta, Iota, Kappa",
          }),
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
      t.processWithOpenAIAPI(
        audioBlob as any,
        { durationSeconds: 31.496 },
        { allowPromptEchoRetry: false }
      )
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

  it("retries non-streaming when an OpenAI stream closes before its completion marker", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "gpt-4o-transcribe");

    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };
    const t = new OpenAiTranscriber({ logger });
    const incompleteStream = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: (key: string) => (key.toLowerCase() === "content-type" ? "text/event-stream" : ""),
      },
      ...makeReaderResponseFromChunks([
        'data: {"type":"transcript.text.delta","delta":"This partial text must not be accepted"}\n\n',
      ]),
    };
    const completeText =
      "This complete non-streaming retry contains the whole dictated sentence and its ending.";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(incompleteStream)
      .mockImplementationOnce(async (_url: any, init: any) => {
        const formData = init?.body as FormData;
        expect(formData.has("stream")).toBe(false);
        return makeJsonResponse(completeText);
      });

    globalThis.fetch = fetchMock as any;

    const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const result = await t.processWithOpenAIAPI(audioBlob as any, { durationSeconds: 10 });

    expect(result.rawText).toBe(completeText);
    expect(result.text).toBe(completeText);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.timings.transcriptionAttemptCount).toBe(2);
    expect(result.timings.transcriptionRetried).toBe(true);
    expect(result.timings.transcriptionStreamRecovery).toBe(true);
  });

  it("recovers a truncated transcript after an independent corroborating attempt", async () => {
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
          text: async () => JSON.stringify({ text: "Hello world this is a longer retry" }),
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.timings.transcriptionAttemptCount).toBe(3);
    expect(result.timings.transcriptionRetried).toBe(true);
  });

  it("rejects a longer truncation retry that disagrees with the primary transcript", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "gpt-4o-transcribe");

    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };
    const t = new OpenAiTranscriber({ logger });
    const primaryText = "Please send the revised budget to Sam Friday.";
    const unrelatedRetry =
      "The garden fence needs painting before winter, and the spare brushes are stored beside the old bicycle in the shed.";
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(primaryText))
      .mockResolvedValueOnce(makeJsonResponse(unrelatedRetry)) as any;

    const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    await expect(t.processWithOpenAIAPI(audioBlob as any, { durationSeconds: 30 })).rejects.toThrow(
      /attempts disagreed/i
    );
  });

  it("rejects a retry that appends an unrelated tail to the complete primary transcript", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "gpt-4o-transcribe");

    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };
    const t = new OpenAiTranscriber({ logger });
    const primaryText = "Please send the revised budget to Sam Friday.";
    const appendedTail =
      `${primaryText} The garden fence needs painting before winter, and the spare brushes ` +
      "are stored beside the old bicycle in the shed.";
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(primaryText))
      .mockResolvedValueOnce(makeJsonResponse(appendedTail))
      .mockResolvedValueOnce(makeJsonResponse(primaryText)) as any;

    const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    await expect(t.processWithOpenAIAPI(audioBlob as any, { durationSeconds: 30 })).rejects.toThrow(
      /attempts disagreed/i
    );
  });

  it("rejects a short material tail unless a third attempt corroborates it", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "gpt-4o-transcribe");

    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };
    const t = new OpenAiTranscriber({ logger });
    const primaryText = "Please send the revised budget to Sam before lunch on Friday.";
    const appendedTail = `${primaryText} Keep it confidential.`;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(primaryText))
      .mockResolvedValueOnce(makeJsonResponse(appendedTail))
      .mockResolvedValueOnce(makeJsonResponse(primaryText)) as any;

    const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    await expect(t.processWithOpenAIAPI(audioBlob as any, { durationSeconds: 30 })).rejects.toThrow(
      /attempts disagreed/i
    );
  });

  it("accepts sparse speech when an independent retry corroborates it", async () => {
    localStorage.setItem("cloudTranscriptionProvider", "openai");
    localStorage.setItem("cloudTranscriptionModel", "gpt-4o-transcribe");

    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };
    const t = new OpenAiTranscriber({ logger });
    const sparseText = "First point: call Sam on Friday morning.";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(sparseText))
      .mockResolvedValueOnce(makeJsonResponse("First point, call Sam on Friday morning."));
    globalThis.fetch = fetchMock as any;

    const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const result = await t.processWithOpenAIAPI(audioBlob as any, { durationSeconds: 60 });

    expect(result.rawText).toBe(sparseText);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    await expect(
      t.processWithOpenAIAPI(audioBlob as any, { durationSeconds: 31.496 })
    ).rejects.toThrow(/suspiciously short|unusable|reliable|disagreed/i);
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
