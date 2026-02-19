import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReasoningCleanupService } from "./reasoningCleanupService.js";

describe("ReasoningCleanupService", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns normalized text when no reasoning model is selected", async () => {
    const reasoningService = { isAvailable: vi.fn(), processText: vi.fn() };
    const logger = { logReasoning: vi.fn() };
    const svc = new ReasoningCleanupService({ logger, reasoningService });

    localStorage.setItem("useReasoningModel", "true");

    const out = await svc.processTranscription(" hello  ", "openai", null);
    expect(out).toBe("hello");
    expect(reasoningService.isAvailable).not.toHaveBeenCalled();
    expect(reasoningService.processText).not.toHaveBeenCalled();
  });

  it("skips reasoning when disabled via storage or override", async () => {
    const reasoningService = { isAvailable: vi.fn(async () => true), processText: vi.fn() };
    const logger = { logReasoning: vi.fn() };
    const svc = new ReasoningCleanupService({ logger, reasoningService });

    localStorage.setItem("reasoningModel", "gpt-5-mini");
    localStorage.setItem("useReasoningModel", "false");

    const out = await svc.processTranscription(" hello  ", "openai", null);
    expect(out).toBe("hello");
    expect(reasoningService.isAvailable).not.toHaveBeenCalled();
    expect(reasoningService.processText).not.toHaveBeenCalled();

    localStorage.setItem("useReasoningModel", "true");
    const outOverride = await svc.processTranscription(" hello  ", "openai", false);
    expect(outOverride).toBe("hello");
    expect(reasoningService.isAvailable).not.toHaveBeenCalled();
    expect(reasoningService.processText).not.toHaveBeenCalled();
  });

  it("processes text when reasoning is enabled and available (with caching)", async () => {
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(async (text: string) => `${text} [cleaned]`),
    };
    const logger = { logReasoning: vi.fn() };
    const svc = new ReasoningCleanupService({ logger, reasoningService, cacheTtlMs: 60_000 });

    localStorage.setItem("reasoningModel", "gpt-5-mini");
    localStorage.setItem("useReasoningModel", "true");

    expect(await svc.processTranscription("hello", "openai", null)).toBe("hello [cleaned]");
    expect(await svc.processTranscription("world", "openai", null)).toBe("world [cleaned]");

    expect(reasoningService.isAvailable).toHaveBeenCalledTimes(1);
    expect(reasoningService.processText).toHaveBeenCalledTimes(2);
  });

  it("falls back to raw text when reasoning service throws", async () => {
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const logger = { logReasoning: vi.fn() };
    const svc = new ReasoningCleanupService({ logger, reasoningService });

    localStorage.setItem("reasoningModel", "gpt-5-mini");
    localStorage.setItem("useReasoningModel", "true");

    await expect(svc.processTranscription(" hello  ", "openai", null)).resolves.toBe("hello");
  });
});

