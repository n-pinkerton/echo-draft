import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ReasoningService from "./ReasoningService";

describe("ReasoningService (OpenAI)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    ReasoningService.clearApiKeyCache();
    (ReasoningService as any).isProcessing = false;

    (window as any).electronAPI = {
      getOpenAIKey: vi.fn(async () => "sk-test"),
    };
  });

  afterEach(() => {
    localStorage.clear();
    ReasoningService.clearApiKeyCache();
    (ReasoningService as any).isProcessing = false;

    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
    } else {
      delete (globalThis as any).fetch;
    }

    vi.restoreAllMocks();
  });

  it("aggregates all Responses API output_text parts and requests max_output_tokens", async () => {
    const fetchMock = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      expect(body.model).toBe("gpt-5.6-terra");
      expect(body.input[0].role).toBe("developer");
      expect(body.input[0].content).toContain("Selected cleanup model: GPT-5.6 Terra");
      expect(body.input[1].content).toContain("<echodraft_gpt56_terra_untrusted_dictation>");
      expect(body.reasoning).toEqual({ effort: "low" });
      expect(body.text).toEqual({ verbosity: "medium" });
      expect(body.truncation).toBe("disabled");
      expect(body.max_output_tokens).toBeGreaterThanOrEqual(2048);
      return {
        ok: true,
        json: async () => ({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                { type: "output_text", text: "I have also provided " },
                { type: "output_text", text: "the rest." },
              ],
            },
          ],
          usage: { total_tokens: 123 },
        }),
      } as any;
    });

    vi.stubGlobal("fetch", fetchMock as any);

    await expect(
      ReasoningService.processText("input", "gpt-5.6-terra", null, {
        reasoningEffort: "low",
      })
    ).resolves.toBe("I have also provided the rest.");
  });

  it("aborts OpenAI cleanup without retrying and releases the processing lock", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) =>
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );
    vi.stubGlobal("fetch", fetchMock as any);

    const pending = ReasoningService.processText("input", "gpt-5.6-terra", null, {
      reasoningEffort: "low",
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((ReasoningService as any).isProcessing).toBe(false);
  });

  it("throws when Responses API is incomplete due to max_output_tokens (avoids returning partial text)", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "I have also provided" }],
            },
          ],
        }),
      } as any;
    });

    vi.stubGlobal("fetch", fetchMock as any);

    await expect(ReasoningService.processText("input", "gpt-5.6-terra")).rejects.toThrow(
      /max output tokens/i
    );
  });

  it("rejects any non-completed Responses status even when partial text is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: "failed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "Partial cleanup" }],
            },
          ],
        }),
      })) as any
    );

    await expect(ReasoningService.processText("input", "gpt-5.6-terra")).rejects.toThrow(
      /non-complete cleanup response/i
    );
  });

  it("does not retry or switch endpoints when the selected model is unavailable", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({
        error: { code: "model_not_found", message: "The selected model does not exist." },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock as any);

    await expect(ReasoningService.processText("input", "gpt-5.6-terra")).rejects.toThrow(
      /does not exist/i
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to chat completions when /responses is unsupported, and throws on finish_reason=length", async () => {
    const fetchMock = vi.fn(async (url: any, init: any) => {
      const endpoint = String(url);
      if (endpoint.endsWith("/responses")) {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: async () => ({ error: { message: "Not Found" } }),
        } as any;
      }

      expect(endpoint.endsWith("/chat/completions")).toBe(true);

      const body = JSON.parse(init.body);
      expect(body.model).toBe("gpt-5.6-terra");
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1].content).toContain("<echodraft_gpt56_terra_untrusted_dictation>");
      expect(body.max_completion_tokens).toBeGreaterThanOrEqual(2048);
      expect(body.reasoning_effort).toBe("none");

      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: { content: "I have also provided" },
              finish_reason: "length",
            },
          ],
          usage: { total_tokens: 123 },
        }),
      } as any;
    });

    vi.stubGlobal("fetch", fetchMock as any);

    await expect(ReasoningService.processText("input", "gpt-5.6-terra")).rejects.toThrow(
      /truncated/i
    );
  });
});
