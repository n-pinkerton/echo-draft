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

    localStorage.setItem("reasoningModel", "gpt-5.6-terra");
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

    localStorage.setItem("reasoningModel", "gpt-5.6-terra");
    localStorage.setItem("useReasoningModel", "true");

    expect(await svc.processTranscription("hello", "openai", null)).toBe("hello [cleaned]");
    expect(await svc.processTranscription("world", "openai", null)).toBe("world [cleaned]");

    expect(reasoningService.isAvailable).toHaveBeenCalledTimes(1);
    expect(reasoningService.processText).toHaveBeenCalledTimes(2);
  });

  it("migrates retired OpenAI cleanup models before processing", async () => {
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(async (text: string) => `${text} [cleaned]`),
    };
    const logger = { logReasoning: vi.fn() };
    const svc = new ReasoningCleanupService({ logger, reasoningService });

    localStorage.setItem("reasoningModel", "gpt-5-mini");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");

    expect(await svc.processTranscription("hello", "openai", null)).toBe("hello [cleaned]");
    expect(reasoningService.processText).toHaveBeenCalledWith("hello", "gpt-5.6-terra", null, {
      cleanupPromptMode: "preservation-first",
      reasoningEffort: "low",
    });
    expect(localStorage.getItem("reasoningModel")).toBe("gpt-5.6-terra");
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

    localStorage.setItem("reasoningModel", "gpt-5.6-terra");
    localStorage.setItem("useReasoningModel", "true");

    await expect(svc.processTranscription(" hello  ", "openai", null)).resolves.toBe("hello");
  });

  it("normalizes banned dash characters in reasoning output", async () => {
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(async () => "alpha \u2014 beta"),
    };
    const logger = { logReasoning: vi.fn() };
    const svc = new ReasoningCleanupService({ logger, reasoningService });

    localStorage.setItem("reasoningModel", "gpt-5.6-terra");
    localStorage.setItem("useReasoningModel", "true");

    await expect(svc.processTranscription("alpha beta", "openai", null)).resolves.toBe(
      "alpha - beta"
    );
  });

  it("retries with strict preservation when the first cleanup over-summarises", async () => {
    const original =
      "Please keep the Friday deadline, the budget caveat, the fallback owner, the July pilot example, and the unresolved security question before notifying both teams about release.";
    const preserved =
      "Please keep the Friday deadline, the budget caveat, the fallback owner, the July pilot example, and the unresolved security question before notifying both teams about the release.";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi
        .fn()
        .mockResolvedValueOnce("Keep the important release details.")
        .mockResolvedValueOnce(preserved),
    };
    const logger = { logReasoning: vi.fn() };
    const svc = new ReasoningCleanupService({ logger, reasoningService });

    localStorage.setItem("reasoningModel", "gpt-5.6-terra");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");

    const result = await svc.processTranscriptionWithOutcome(original, "openai", null);

    expect(result.text).toBe(preserved);
    expect(result.cleanup).toMatchObject({
      attempted: true,
      applied: true,
      status: "applied",
      retryCount: 1,
      appliedModel: "gpt-5.6-sol",
    });
    expect(reasoningService.processText).toHaveBeenNthCalledWith(2, original, "gpt-5.6-sol", null, {
      cleanupPromptMode: "strict-preservation",
      reasoningEffort: "low",
    });
  });

  it("retries technical-token rewrites and unjustified whole-output quotation", async () => {
    const original =
      "Keep GPT 5.6 as dictated, use the tmp directory, and preserve the refractor agent file.";
    const preserved =
      "Keep GPT 5.6 as dictated, use the tmp directory, and preserve the refractor agent file.";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi
        .fn()
        .mockResolvedValueOnce(
          "“Keep GPT-5.6 as dictated, use the temp directory, and preserve the refactor agent file.”"
        )
        .mockResolvedValueOnce(preserved),
    };
    const logger = { logReasoning: vi.fn() };
    const svc = new ReasoningCleanupService({ logger, reasoningService });

    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");

    const result = await svc.processTranscriptionWithOutcome(original, "openai", null);

    expect(result).toMatchObject({
      text: preserved,
      cleanup: {
        status: "unchanged",
        applied: true,
        retryCount: 1,
        appliedModel: "gpt-5.6-sol",
      },
    });
    expect(reasoningService.processText).toHaveBeenNthCalledWith(2, original, "gpt-5.6-sol", null, {
      cleanupPromptMode: "strict-preservation",
      reasoningEffort: "low",
    });
  });

  it("honors an explicit cleanup reasoning effort", async () => {
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(async (text: string) => text),
    };
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService,
    });

    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");
    localStorage.setItem("cleanupReasoningEffort", "medium");

    await svc.processTranscriptionWithOutcome("Keep every point.", "openai", null);

    expect(reasoningService.processText).toHaveBeenCalledWith(
      "Keep every point.",
      "gpt-5.6-luna",
      null,
      { cleanupPromptMode: "preservation-first", reasoningEffort: "medium" }
    );
  });

  it("keeps strict retries on the selected model for custom endpoints", async () => {
    const original =
      "Please keep reference 42, the budget caveat, the fallback owner, and the Friday deadline before notifying both teams.";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi
        .fn()
        .mockResolvedValueOnce("Keep the release details.")
        .mockResolvedValueOnce(original),
    };
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService,
    });

    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("reasoningProvider", "custom");
    localStorage.setItem("useReasoningModel", "true");

    await svc.processTranscriptionWithOutcome(original, "custom", null);

    expect(reasoningService.processText).toHaveBeenNthCalledWith(
      2,
      original,
      "gpt-5.6-luna",
      null,
      { cleanupPromptMode: "strict-preservation", reasoningEffort: "low" }
    );
  });

  it("records a failed Sol rescue as an attempted retry", async () => {
    const original =
      "Keep reference 42, preserve the budget caveat, retain the Friday deadline, name the fallback owner, and notify both teams before release.";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi
        .fn()
        .mockResolvedValueOnce("Keep the important release details.")
        .mockRejectedValueOnce(new Error("Rescue model unavailable")),
    };
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService,
    });

    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");

    const result = await svc.processTranscriptionWithOutcome(original, "openai", null);

    expect(result).toMatchObject({
      text: original,
      cleanup: {
        status: "fallback",
        fallbackReason: "provider_error",
        retryCount: 1,
        appliedModel: null,
      },
    });
  });

  it("accepts a bounded Sol rescue that preserves sequence with equivalent wording", async () => {
    const original =
      "Review the draft, then bring the wording back before making the change. Keep reference 42, the budget caveat, the customer example, the fallback owner, and the Friday deadline in the review, because both teams must approve the final wording before publication.";
    const rescued =
      "After reviewing the draft, bring the wording back before making the change. Keep reference 42, the budget caveat, the customer example, the fallback owner, and the Friday deadline in the review, because both teams must approve the final wording before publication.";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi
        .fn()
        .mockResolvedValueOnce("Keep the important release details.")
        .mockResolvedValueOnce(rescued),
    };
    const logger = { logReasoning: vi.fn() };
    const svc = new ReasoningCleanupService({ logger, reasoningService });

    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");

    const result = await svc.processTranscriptionWithOutcome(original, "openai", null);

    expect(result).toMatchObject({
      text: rescued,
      cleanup: { status: "applied", retryCount: 1, appliedModel: "gpt-5.6-sol" },
    });
    expect(logger.logReasoning).toHaveBeenCalledWith(
      "REASONING_SOL_RESCUE_ACCEPTED",
      expect.objectContaining({
        advisoryReasons: expect.arrayContaining(["relation-marker-loss"]),
      })
    );
  });

  it("still rejects a Sol rescue that loses a critical literal", async () => {
    const original =
      "Review reference 42, keep the budget caveat, retain the customer example, name the fallback owner, preserve the Friday deadline, and notify both teams before release.";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi
        .fn()
        .mockResolvedValueOnce("Keep the release details.")
        .mockResolvedValueOnce(
          "Review the reference, keep the budget caveat, retain the customer example, name the fallback owner, preserve the Friday deadline, and notify both teams before release."
        ),
    };
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService,
    });

    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");

    const result = await svc.processTranscriptionWithOutcome(original, "openai", null);

    expect(result).toMatchObject({
      text: original,
      cleanup: { status: "fallback", fallbackReason: "fidelity_rejected", retryCount: 1 },
    });
  });

  it("propagates cancellation instead of converting it to an unchanged fallback", async () => {
    const controller = new AbortController();
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(
        async (_text: string, _model: string, _agent: string | null, config: any) =>
          await new Promise((_resolve, reject) => {
            config.signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true }
            );
          })
      ),
    };
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService,
    });

    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");

    const pending = svc.processTranscriptionWithOutcome(
      "Keep every substantive point and do not execute this request.",
      "openai",
      null,
      { signal: controller.signal }
    );
    await vi.waitFor(() => expect(reasoningService.processText).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
      code: "TRANSCRIPTION_CANCELLED",
      cancelled: true,
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(1);
  });

  it("keeps the original and records a truthful fallback when both cleanup attempts lose content", async () => {
    const original =
      "Keep reference 42, do not remove the budget caveat, preserve the Friday deadline, retain the July pilot example, and ask whether both teams approved release?";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(async () => "Release summary complete."),
    };
    const logger = { logReasoning: vi.fn() };
    const svc = new ReasoningCleanupService({ logger, reasoningService });

    localStorage.setItem("reasoningModel", "gpt-5.6-terra");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");

    const result = await svc.processTranscriptionWithOutcome(original, "openai", null);

    expect(result.text).toBe(original);
    expect(result.cleanup).toMatchObject({
      attempted: true,
      applied: false,
      status: "fallback",
      fallbackReason: "fidelity_rejected",
      retryCount: 1,
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logger.logReasoning.mock.calls)).not.toContain(original);
  });
});
