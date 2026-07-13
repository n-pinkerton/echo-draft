import { beforeEach, describe, expect, it, vi } from "vitest";

import logger from "../../../utils/logger";
import { callChatCompletionsApi } from "./chatCompletionsApi";
import { processWithOpenAiProvider } from "./openaiProvider";

const SENTINEL = "PRIVATE_TRANSCRIPT_SENTINEL";
const CREDENTIAL_URL =
  "https://user-secret:password-secret@example.test/v1?client_secret=query-secret#signature";

const getSystemPrompt = () => "Clean dictation without changing meaning.";
const calculateMaxTokens = () => 4096;

describe("reasoning provider diagnostics", () => {
  let log: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    log = vi.fn(async () => undefined);
    (window as any).electronAPI = {
      getLogLevel: vi.fn(async () => "debug"),
      log,
    };
    logger.refreshLogLevel();
  });

  it("does not log chat provider endpoint credentials or provider error content", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 400,
      statusText: SENTINEL,
      text: async () =>
        JSON.stringify({ error: { message: SENTINEL, code: `${SENTINEL}\r\nInjected` } }),
    }));

    await expect(
      callChatCompletionsApi({
        endpoint: CREDENTIAL_URL,
        apiKey: "api-secret",
        model: "test-model",
        text: "Keep this dictation intact.",
        agentName: null,
        config: {},
        providerName: "Compatible provider",
        getSystemPrompt,
        calculateMaxTokens,
        fetchFn: fetchFn as any,
      })
    ).rejects.toThrow("Compatible provider cleanup request failed (HTTP 400).");

    await vi.waitFor(() => expect(log).toHaveBeenCalled());
    const diagnostics = JSON.stringify(log.mock.calls);
    expect(diagnostics).not.toContain(SENTINEL);
    expect(diagnostics).not.toMatch(/user-secret|password-secret|query-secret|api-secret/);
    expect(diagnostics).toContain("https://example.test/v1");
  });

  it("does not log OpenAI-compatible endpoint credentials or arbitrary provider fields", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: { message: SENTINEL, code: `${SENTINEL}\r\nInjected` },
        [SENTINEL]: SENTINEL,
      }),
    }));

    await expect(
      processWithOpenAiProvider({
        text: "Keep this dictation intact.",
        model: "test-model",
        agentName: null,
        config: {},
        apiKey: "api-secret",
        isCustomProvider: true,
        openAiBase: CREDENTIAL_URL,
        endpointCandidates: [{ url: `${CREDENTIAL_URL}/responses`, type: "responses" }],
        getSystemPrompt,
        calculateMaxTokens,
        getStoredOpenAiPreference: () => undefined,
        rememberOpenAiPreference: vi.fn(),
        fetchFn: fetchFn as any,
      })
    ).rejects.toThrow("Cleanup provider request failed (HTTP 400).");

    await vi.waitFor(() => expect(log).toHaveBeenCalled());
    const diagnostics = JSON.stringify(log.mock.calls);
    expect(diagnostics).not.toContain(SENTINEL);
    expect(diagnostics).not.toMatch(/user-secret|password-secret|query-secret|api-secret/);
    expect(diagnostics).toContain("https://example.test/v1");
  });
});
