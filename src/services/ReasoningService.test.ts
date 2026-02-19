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
      expect(body.model).toBe("gpt-4o-mini");
      expect(body.max_output_tokens).toBeGreaterThanOrEqual(4096);
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

    await expect(ReasoningService.processText("input", "gpt-4o-mini")).resolves.toBe(
      "I have also provided the rest."
    );
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

    await expect(ReasoningService.processText("input", "gpt-4o-mini")).rejects.toThrow(
      /max output tokens/i
    );
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
      expect(body.model).toBe("gpt-4o-mini");
      expect(body.max_tokens).toBeGreaterThanOrEqual(4096);

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

    await expect(ReasoningService.processText("input", "gpt-4o-mini")).rejects.toThrow(
      /truncated/i
    );
  });
});
