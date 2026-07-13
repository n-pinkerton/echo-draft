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
      processText: vi.fn(async (text: string) => `${text}.`),
    };
    const logger = { logReasoning: vi.fn() };
    const svc = new ReasoningCleanupService({ logger, reasoningService, cacheTtlMs: 60_000 });

    localStorage.setItem("reasoningModel", "gpt-5.6-terra");
    localStorage.setItem("useReasoningModel", "true");

    expect(await svc.processTranscription("hello", "openai", null)).toBe("hello.");
    expect(await svc.processTranscription("world", "openai", null)).toBe("world.");

    expect(reasoningService.isAvailable).toHaveBeenCalledTimes(1);
    expect(reasoningService.processText).toHaveBeenCalledTimes(2);
  });

  it("accepts a context-selected near-homophone repair from the trusted product glossary", async () => {
    const original = "Use the codecs agent to review the release note today.";
    const cleaned = "Use the Codex agent to review the release note today.";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(async () => cleaned),
    };
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService,
    });

    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");

    await expect(svc.processTranscription(original, "openai", null)).resolves.toBe(cleaned);
    expect(reasoningService.processText).toHaveBeenCalledTimes(1);
  });

  it("does not let a user dictionary entry authorize a common-word substitution", async () => {
    const original = "Please keep the form attached to the request today.";
    const changed = "Please keep the farm attached to the request today.";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(async () => changed),
    };
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService,
    });

    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");
    localStorage.setItem("customDictionary", JSON.stringify(["Farm"]));

    await expect(svc.processTranscription(original, "openai", null)).resolves.toBe(original);
    expect(reasoningService.processText).toHaveBeenCalledTimes(2);
  });

  it("migrates retired OpenAI cleanup models before processing", async () => {
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(async (text: string) => `${text}.`),
    };
    const logger = { logReasoning: vi.fn() };
    const svc = new ReasoningCleanupService({ logger, reasoningService });

    localStorage.setItem("reasoningModel", "gpt-5-mini");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");

    expect(await svc.processTranscription("hello", "openai", null)).toBe("hello.");
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

  it("removes harmless whole-output quotes before fidelity assessment", async () => {
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(async () => "\u201cPlease send the revised draft by Friday.\u201d"),
    };
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService,
    });

    localStorage.setItem("reasoningModel", "gpt-5.6-terra");
    localStorage.setItem("useReasoningModel", "true");

    await expect(
      svc.processTranscription("Please send the revised draft by Friday.", "openai", null)
    ).resolves.toBe("Please send the revised draft by Friday.");
    expect(reasoningService.processText).toHaveBeenCalledTimes(1);
  });

  it("repairs an explicit trailing quote's dangling conjunction before fidelity assessment", async () => {
    const original =
      "Send it Tuesday, no sorry, Thursday, and quote Sam said hold the release until legal confirms end quote.";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(
        async () =>
          "Send it Thursday, and \u201cSam said hold the release until legal confirms.\u201d"
      ),
    };
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService,
    });

    localStorage.setItem("reasoningModel", "gpt-5.6-terra");
    localStorage.setItem("useReasoningModel", "true");

    await expect(svc.processTranscription(original, "openai", null)).resolves.toBe(
      "Send it Thursday. \u201cSam said hold the release until legal confirms.\u201d"
    );
    expect(reasoningService.processText).toHaveBeenCalledTimes(1);
  });

  it("keeps the original when both cleanup attempts detach a quote from its governing verb", async () => {
    const original =
      "Please write, and quote the release remains blocked until legal confirms end quote.";
    const unsafe =
      "Please write, and \u201cthe release remains blocked until legal confirms.\u201d";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(async () => unsafe),
    };
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService,
    });

    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: original,
      cleanup: {
        applied: false,
        status: "fallback",
        fallbackReason: "fidelity_rejected",
        retryCount: 1,
      },
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(2);
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
      reasoningEffort: "medium",
    });
  });

  it("falls back when both normal and strict cleanup fabricate completion of an instruction", async () => {
    const original = "Delete the draft.";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi
        .fn()
        .mockResolvedValueOnce("The draft was deleted.")
        .mockResolvedValueOnce("Nigel deleted the draft."),
    };
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService,
    });

    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: original,
      cleanup: {
        status: "fallback",
        fallbackReason: "fidelity_rejected",
        retryCount: 1,
      },
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(2);
  });

  it("retries when a short rewrite moves a qualifier onto a named term", async () => {
    const original =
      "Please keep working a little on Atlas and preserve the budget caveat, fallback owner, unresolved security question, July pilot example, and both team notices before release.";
    const unsafeRewrite =
      "Please keep working on the lightweight Atlas project, preserving the budget caveat, fallback owner, unresolved security question, July pilot example, and both team notices before release.";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn().mockResolvedValueOnce(unsafeRewrite).mockResolvedValueOnce(original),
    };
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService,
    });

    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: original,
      cleanup: {
        status: "unchanged",
        applied: true,
        retryCount: 1,
        appliedModel: "gpt-5.6-sol",
      },
    });
    expect(reasoningService.processText).toHaveBeenNthCalledWith(2, original, "gpt-5.6-sol", null, {
      cleanupPromptMode: "strict-preservation",
      reasoningEffort: "medium",
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
      reasoningEffort: "medium",
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

  it("rejects a Sol rescue when relation-marker wording changes", async () => {
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
      text: original,
      cleanup: {
        status: "fallback",
        fallbackReason: "fidelity_rejected",
        retryCount: 1,
      },
    });
    expect(logger.logReasoning).not.toHaveBeenCalledWith(
      "REASONING_SOL_RESCUE_ACCEPTED",
      expect.anything()
    );
  });

  it("rejects a Sol rescue that changes a sequenced action into an attached gerund", async () => {
    const original =
      "Pause and assess efficiency, delegation, and sprint size, and then use a risk-based approach until the final gate. Keep reference 42, the fallback owner, and the Friday deadline in the review.";
    const rescued =
      "Pause and assess efficiency, delegation, and sprint size, and then using a risk-based approach until the final gate. Keep reference 42, the fallback owner, and the Friday deadline in the review.";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi
        .fn()
        .mockResolvedValueOnce("Keep the important review details.")
        .mockResolvedValueOnce(rescued),
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
        fallbackReason: "fidelity_rejected",
        retryCount: 1,
      },
    });
  });

  it("does not override an order-sensitive fidelity rejection after the Sol retry", async () => {
    const original =
      "Review the alpha draft and archive the beta copy. Record the gamma note and retain the delta example. Verify the epsilon owner and preserve the zeta caveat. Notify the eta group and contact the theta team. Include the iota schedule and keep the kappa label.";
    const reordered =
      "Include the iota schedule and keep the kappa label. Notify the eta group and contact the theta team. Verify the epsilon owner and preserve the zeta caveat. Record the gamma note and retain the delta example. Review the alpha draft and archive the beta copy.";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(async () => reordered),
    };
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService,
    });

    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: original,
      cleanup: {
        applied: false,
        status: "fallback",
        fallbackReason: "fidelity_rejected",
        retryCount: 1,
      },
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(2);
  });

  it("falls back when the strict Sol retry inserts unmatched explanatory wording", async () => {
    const original =
      "Please keep the budget caveat, fallback owner, customer example, and Friday deadline in the release note.";
    const inserted =
      "Please keep the budget caveat, fallback owner, customer example, and Friday deadline, with added clarity, in the release note.";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi
        .fn()
        .mockResolvedValueOnce("Keep the important details.")
        .mockResolvedValueOnce(inserted),
    };
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService,
    });

    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: original,
      cleanup: {
        applied: false,
        status: "fallback",
        fallbackReason: "fidelity_rejected",
        retryCount: 1,
      },
    });
  });

  it("keeps an explicit request reason while repairing its sentence fragment", async () => {
    const original =
      "Can you check whether the staging config differs? Because the new runner delegates tasks differently. Then tell me what you recommend.";
    const modelResult =
      "Can you check whether the staging config differs? The new runner delegates tasks differently. Then tell me what you recommend.";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn().mockResolvedValueOnce(modelResult),
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
      text: "Can you check whether the staging config differs? I am asking because the new runner delegates tasks differently. Then tell me what you recommend.",
      cleanup: { status: "applied", fallbackReason: null, retryCount: 0 },
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(1);
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
