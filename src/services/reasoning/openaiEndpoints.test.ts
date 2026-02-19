import { beforeEach, describe, expect, it } from "vitest";

import { API_ENDPOINTS } from "../../config/constants";
import { OpenAiEndpointResolver } from "./openaiEndpoints";

describe("OpenAiEndpointResolver", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the default OpenAI base when no storage is provided", () => {
    const resolver = new OpenAiEndpointResolver("test-openai-pref");
    expect(resolver.getConfiguredBase()).toBe(API_ENDPOINTS.OPENAI_BASE);
  });

  it("returns the default OpenAI base when provider is not custom", () => {
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("cloudReasoningBaseUrl", "https://example.com/v1");

    const resolver = new OpenAiEndpointResolver("test-openai-pref");
    expect(resolver.getConfiguredBase(localStorage)).toBe(API_ENDPOINTS.OPENAI_BASE);
  });

  it("returns the default OpenAI base when custom URL is empty", () => {
    localStorage.setItem("reasoningProvider", "custom");
    localStorage.setItem("cloudReasoningBaseUrl", "   ");

    const resolver = new OpenAiEndpointResolver("test-openai-pref");
    expect(resolver.getConfiguredBase(localStorage)).toBe(API_ENDPOINTS.OPENAI_BASE);
  });

  it("accepts secure custom OpenAI-compatible endpoints", () => {
    localStorage.setItem("reasoningProvider", "custom");
    localStorage.setItem("cloudReasoningBaseUrl", "https://example.com/v1/responses");

    const resolver = new OpenAiEndpointResolver("test-openai-pref");
    expect(resolver.getConfiguredBase(localStorage)).toBe("https://example.com/v1");
  });

  it("rejects known non-OpenAI provider URLs", () => {
    localStorage.setItem("reasoningProvider", "custom");
    localStorage.setItem("cloudReasoningBaseUrl", "https://api.groq.com/openai/v1");

    const resolver = new OpenAiEndpointResolver("test-openai-pref");
    expect(resolver.getConfiguredBase(localStorage)).toBe(API_ENDPOINTS.OPENAI_BASE);
  });

  it("rejects insecure public HTTP URLs", () => {
    localStorage.setItem("reasoningProvider", "custom");
    localStorage.setItem("cloudReasoningBaseUrl", "http://example.com/v1");

    const resolver = new OpenAiEndpointResolver("test-openai-pref");
    expect(resolver.getConfiguredBase(localStorage)).toBe(API_ENDPOINTS.OPENAI_BASE);
  });

  it("allows HTTP for private hosts (localhost)", () => {
    localStorage.setItem("reasoningProvider", "custom");
    localStorage.setItem("cloudReasoningBaseUrl", "http://localhost:1234/v1");

    const resolver = new OpenAiEndpointResolver("test-openai-pref");
    expect(resolver.getConfiguredBase(localStorage)).toBe("http://localhost:1234/v1");
  });

  it("returns endpoint candidates in preferred order", () => {
    const resolver = new OpenAiEndpointResolver("test-openai-pref");

    const base = "https://example.com/v1";
    expect(resolver.getEndpointCandidates(base)).toEqual([
      { url: "https://example.com/v1/responses", type: "responses" },
      { url: "https://example.com/v1/chat/completions", type: "chat" },
    ]);

    resolver.rememberPreference(base, "chat", localStorage);
    expect(resolver.getEndpointCandidates(base, localStorage)).toEqual([
      { url: "https://example.com/v1/chat/completions", type: "chat" },
    ]);
  });

  it("handles explicit endpoint URLs (already /responses or /chat/completions)", () => {
    const resolver = new OpenAiEndpointResolver("test-openai-pref");

    expect(resolver.getEndpointCandidates("https://example.com/v1/responses")).toEqual([
      { url: "https://example.com/v1/responses", type: "responses" },
    ]);

    expect(resolver.getEndpointCandidates("https://example.com/v1/chat/completions")).toEqual([
      { url: "https://example.com/v1/chat/completions", type: "chat" },
    ]);
  });
});

