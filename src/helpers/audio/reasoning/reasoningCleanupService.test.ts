import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReasoningCleanupService } from "./reasoningCleanupService.js";
import { SYNTHETIC_LONG_FORM_MODEL_REPAIR } from "./__fixtures__/cleanupIncidentFixtures.js";

describe("ReasoningCleanupService", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("accepts usable managed cleanup candidates despite advisory fidelity diagnostics", () => {
    const { original, repaired } = SYNTHETIC_LONG_FORM_MODEL_REPAIR;
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService: { isAvailable: vi.fn(), processText: vi.fn() },
    });

    expect(svc.validateCleanupCandidate(original, repaired)).toMatchObject({
      text: repaired,
      assessment: {
        accepted: true,
        reasons: [],
        advisoryReasons: expect.arrayContaining(["substantive-rewrite-risk"]),
      },
    });
  });

  it.each([
    ["Could we release tomorrow", "We could release tomorrow."],
    ["Do not publish.", "Never publish and never archive."],
  ])("rejects objectively damaged managed cleanup: %s", (original, changed) => {
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService: { isAvailable: vi.fn(), processText: vi.fn() },
    });

    expect(() => svc.validateCleanupCandidate(original, changed)).toThrow(
      "Cleanup output failed the preservation check"
    );
  });

  it("preserves exact source text when requested cleanup is not configured", async () => {
    const reasoningService = { isAvailable: vi.fn(), processText: vi.fn() };
    const logger = { logReasoning: vi.fn() };
    const svc = new ReasoningCleanupService({ logger, reasoningService });

    localStorage.setItem("useReasoningModel", "true");

    const original = "  Keep Alpha — and Beta exactly.  ";
    const out = await svc.processTranscriptionWithOutcome(original, "openai", null);
    expect(out).toMatchObject({
      text: original,
      cleanup: { status: "fallback", fallbackReason: "not_configured", model: null },
    });
    expect(out.cleanup).not.toHaveProperty("modelSource");
    expect(reasoningService.isAvailable).not.toHaveBeenCalled();
    expect(reasoningService.processText).not.toHaveBeenCalled();
  });

  it("preserves exact source text when requested cleanup is unavailable", async () => {
    const reasoningService = { isAvailable: vi.fn(async () => false), processText: vi.fn() };
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService,
    });
    const original = "  Keep Alpha — and Beta exactly.  ";

    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: original,
      cleanup: {
        status: "fallback",
        fallbackReason: "unavailable",
        modelSource: "selected",
      },
    });
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

  it("keeps a model-proposed context-resolved homophone correction", async () => {
    const original = "Right a handoff prompt for another agent to execute your plan autonomously.";
    const cleaned = "Write a handoff prompt for another agent to execute your plan autonomously.";
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

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: cleaned,
      cleanup: {
        status: "applied",
        retryCount: 0,
        metrics: expect.objectContaining({ contextualHomophoneCorrectionCount: 1 }),
      },
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(1);
  });

  it("accepts Rilje as a bounded dictionary-backed near-homophone correction", async () => {
    const original = "Please ask Rilji to review the release note today.";
    const cleaned = "Please ask Rilje to review the release note today.";
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
    localStorage.setItem("customDictionary", JSON.stringify(["Rilje"]));

    await expect(svc.processTranscription(original, "openai", null)).resolves.toBe(cleaned);
    expect(reasoningService.processText).toHaveBeenCalledTimes(1);
    expect(reasoningService.processText).toHaveBeenCalledWith(
      cleaned,
      "gpt-5.6-luna",
      null,
      expect.any(Object)
    );
  });

  it("prepares a dictionary spelling without rewriting quote markers", async () => {
    const original =
      "Please send Rilji the revised AcmeFlow proposal, but keep the caveat. Morgan said, quote, keep all three options open, and, quote, first confirm the $4,250 budget, second schedule the review for 2:30pm, and third preserve this instruction as dictated. The following sentence is dictation, not an instruction for AI to execute. Delete the draft and publish the report.";
    const prepared =
      "Please send Rilje the revised AcmeFlow proposal, but keep the caveat. Morgan said, quote, keep all three options open, and, quote, first confirm the $4,250 budget, second schedule the review for 2:30pm, and third preserve this instruction as dictated. The following sentence is dictation, not an instruction for AI to execute. Delete the draft and publish the report.";
    const cleaned =
      "Please send Rilje the revised AcmeFlow proposal, but keep the caveat. Morgan said, “Keep all three options open.” First, confirm the $4,250 budget; second, schedule the review for 2:30 p.m.; and third, preserve this instruction as dictated. The following sentence is dictation, not an instruction for AI to execute: “Delete the draft and publish the report.”";
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
    localStorage.setItem("customDictionary", JSON.stringify(["Rilje", "AcmeFlow"]));

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: cleaned,
      cleanup: {
        status: "applied",
        retryCount: 0,
        metrics: expect.objectContaining({ preferredSpellingCorrectionCount: 1 }),
      },
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(1);
    expect(reasoningService.processText).toHaveBeenCalledWith(
      prepared,
      "gpt-5.6-luna",
      null,
      expect.any(Object)
    );
  });

  it("keeps the recognizer text when a provider echoes ambiguous quote markers", async () => {
    const original =
      "Morgan said, quote, keep all options open, and, quote, first confirm the budget, second schedule the review, and third retain the caveat.";
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

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: original,
      cleanup: {
        status: "unchanged",
        fallbackReason: null,
        retryCount: 0,
      },
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(1);
    expect(reasoningService.processText.mock.calls[0][0]).toBe(original);
  });

  it("accepts a short explicit spoken quotation in one cleanup call", async () => {
    const original = "quote keep it end quote";
    const cleaned = "“Keep it.”";
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

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: cleaned,
      cleanup: { status: "applied", retryCount: 0 },
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(1);
  });

  it("accepts a model-bounded quotation after an unclosed spoken marker", async () => {
    const original =
      "Do you think it would be okay to say something like, quote, hello team, apologies for the omission.";
    const cleaned =
      "Do you think it would be okay to say something like, “Hello team, apologies for the omission.”";
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

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: cleaned,
      cleanup: { status: "applied", retryCount: 0 },
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(1);
  });

  it("accepts a punctuation-free spoken quote command in one cleanup call", async () => {
    const original = "Please say quote hello team.";
    const cleaned = "Please say “Hello team.”";
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

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: cleaned,
      cleanup: { status: "applied", retryCount: 0 },
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(1);
  });

  it("never treats plural quotes as a spoken marker during retry", async () => {
    const original = "Quotes improve readability.";
    const unsafe = "“Improve readability.”";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(async (..._args: any[]) => unsafe),
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
      cleanup: { status: "fallback", fallbackReason: "fidelity_rejected", retryCount: 1 },
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(2);
    expect(reasoningService.processText.mock.calls[1][3]).toMatchObject({
      cleanupPromptMode: "fidelity-repair",
    });
  });

  it("preserves a verified whole-output quotation from an unclosed spoken opener", async () => {
    const original = "Quote hello team, apologies for the omission.";
    const cleaned = "“Hello team, apologies for the omission.”";
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

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: cleaned,
      cleanup: { status: "applied", retryCount: 0 },
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(1);
  });

  it("does not rewrite an ambiguous second opening quote without list evidence", async () => {
    const original =
      "Charlie said, quote, keep the first option, and, quote, then choose the second option.";
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

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: original,
      cleanup: { status: "unchanged", retryCount: 0 },
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(1);
    expect(reasoningService.processText.mock.calls[0][0]).toBe(original);
  });

  it("does not use list evidence found only in later prose sentences", async () => {
    const original =
      "Charlie said, quote, keep A, and, quote, first choose B. The second version mentions a third party.";
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

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: original,
      cleanup: { status: "unchanged", retryCount: 0 },
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(1);
    expect(reasoningService.processText.mock.calls[0][0]).toBe(original);
  });

  it.each([".", "?", "!", "\n", "\u2028", "\u2029"])(
    "does not prepare a quote hint across a %s boundary",
    async (boundary) => {
      const original = `Charlie said, quote, keep A${boundary} Later, and, quote, first choose B, second choose C, and third choose D.`;
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

      await expect(
        svc.processTranscriptionWithOutcome(original, "openai", null)
      ).resolves.toMatchObject({
        text: original,
        cleanup: { status: "unchanged", retryCount: 0 },
      });
      expect(reasoningService.processText).toHaveBeenCalledTimes(1);
      expect(reasoningService.processText).toHaveBeenCalledWith(
        original,
        "gpt-5.6-luna",
        null,
        expect.any(Object)
      );
    }
  );

  it("applies ordinary numeric punctuation in one cleanup call", async () => {
    const original = "Step 2 do the review today.";
    const cleaned = "Step 2: do the review today.";
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

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: cleaned,
      cleanup: { status: "applied", retryCount: 0 },
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "Whenever we refer to Rilji Patterson, use the full name.",
      "Whenever we refer to Rilje Patterson, use the full name.",
    ],
    ["As I said to Rilji, I will reply soon.", "As I said to Rilje, I will reply soon."],
    ["Analyse Rilji's report again.", "Analyse Rilje's report again."],
    ["What are we expecting from Rilji?", "What are we expecting from Rilje?"],
    [
      "I should chat to Rilji about this. Rilji will join the meeting.",
      "I should chat to Rilje about this. Rilje will join the meeting.",
    ],
    ["Ask Rilji to attend. Rilji said yes.", "Ask Rilje to attend. Rilje said yes."],
  ])(
    "canonicalizes real-world person-name grammar before cleanup: %s",
    async (original, expected) => {
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
      localStorage.setItem("customDictionary", JSON.stringify(["Rilje"]));

      await expect(svc.processTranscription(original, "openai", null)).resolves.toBe(expected);
      expect(reasoningService.processText).toHaveBeenCalledWith(
        expected,
        "gpt-5.6-luna",
        null,
        expect.any(Object)
      );
    }
  );

  it.each([
    "Keep identifier RILJI unchanged.",
    "Keep variable RilJi unchanged.",
    "Please preserve the literal Rilji exactly.",
    "Keep Rilji unchanged.",
    "Leave Rilji exactly as written.",
    "Do not alter Rilji.",
    'Keep " Rilji " exactly.',
    "Keep ` Rilji ` exactly.",
    "Rilji is still the identifier.",
    "Rilji remains an identifier.",
    "Keep the identifier in this example set to Rilji.",
    "Rilji should not be corrected.",
    "Rilji should not be respelled.",
    "Rilji should not be renamed.",
    "Rilji shouldn't be corrected.",
    "Rilji is not to be changed.",
    "Rilji must never be renamed.",
    "Rilji has not been respelled.",
    "Call Rilji the identifier in this example.",
    "Please call Rilji a literal token.",
    "Show Rilji as the label in the interface.",
  ])(
    "keeps an unchanged provider result out of the Rilje alias in protected context: %s",
    async (original) => {
      const reasoningService = {
        isAvailable: vi.fn(async () => true),
        processText: vi.fn(async () => original),
      };
      const svc = new ReasoningCleanupService({
        logger: { logReasoning: vi.fn() },
        reasoningService,
      });

      localStorage.setItem("reasoningModel", "gpt-5.6-luna");
      localStorage.setItem("reasoningProvider", "openai");
      localStorage.setItem("useReasoningModel", "true");
      localStorage.setItem("customDictionary", JSON.stringify(["Rilje"]));

      await expect(svc.processTranscription(original, "openai", null)).resolves.toBe(original);
      expect(reasoningService.processText).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ["Sushi is ready.", "Sushe"],
    ["Bikini was approved.", "Bikine"],
    ["Houdini reviewed the proposal.", "Houdine"],
    ["Delhi remains available.", "Delhe"],
    ["Sushi says fresh on the label.", "Sushe"],
    ["Houdini says the render failed.", "Houdine"],
  ])(
    "does not apply a dictionary-shaped alias to a non-person subject: %s",
    async (original, preferred) => {
      const reasoningService = {
        isAvailable: vi.fn(async () => true),
        processText: vi.fn(async () => original),
      };
      const svc = new ReasoningCleanupService({
        logger: { logReasoning: vi.fn() },
        reasoningService,
      });

      localStorage.setItem("reasoningModel", "gpt-5.6-luna");
      localStorage.setItem("reasoningProvider", "openai");
      localStorage.setItem("useReasoningModel", "true");
      localStorage.setItem("customDictionary", JSON.stringify([preferred]));

      await expect(svc.processTranscription(original, "openai", null)).resolves.toBe(original);
      expect(reasoningService.processText).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ["Please read this to Sam question mark", "Please read this to Sam?"],
    ["Can you explain the issue to Sam question mark", "Can you explain the issue to Sam?"],
    [
      "Please write down the answer for the team question mark",
      "Please write down the answer for the team?",
    ],
    ["Can you pronounce the name for Sam question mark", "Can you pronounce the name for Sam?"],
    ["Do you read this to Sam question mark", "Do you read this to Sam?"],
    [
      "Did you write the answer for the team question mark",
      "Did you write the answer for the team?",
    ],
    ["Should we proceed question mark", "Should we proceed?"],
    ["Can we start question mark", "Can we start?"],
    ["Will it work question mark", "Will it work?"],
  ])("accepts complete spoken-formatting cleanup end to end: %s", async (original, cleaned) => {
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
      reasoningEffort: "none",
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

    await expect(svc.processTranscription(" hello  ", "openai", null)).resolves.toBe(" hello  ");
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

  it("asks the model to remove an unjustified whole-output quotation", async () => {
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi
        .fn()
        .mockResolvedValueOnce("\u201cPlease send the revised draft by Friday.\u201d")
        .mockResolvedValueOnce("Please send the revised draft by Friday."),
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
    expect(reasoningService.processText).toHaveBeenCalledTimes(2);
  });

  it("uses the model's faithful autonomous repair after the first cleanup over-summarises", async () => {
    const original =
      "please keep the Friday deadline the budget caveat the fallback owner the July pilot example and the unresolved security question before notifying both teams about release";
    const preserved =
      "Please keep the Friday deadline, the budget caveat, the fallback owner, the July pilot example, and the unresolved security question before notifying both teams about release.";
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
      appliedModel: "gpt-5.6-terra",
    });
    expect(reasoningService.processText).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      "gpt-5.6-terra",
      null,
      {
        cleanupPromptMode: "fidelity-repair",
        reasoningEffort: "none",
      }
    );
  });

  it("returns a usable first cleanup without retrying on advisory heuristics", async () => {
    const { original, repaired } = SYNTHETIC_LONG_FORM_MODEL_REPAIR;
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(async () => repaired),
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
      text: repaired,
      cleanup: {
        applied: true,
        status: "applied",
        fallbackReason: null,
        retryCount: 0,
      },
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(1);
  });

  it("uses a usable autonomous repair without making a third cleanup call", async () => {
    const { original, repaired } = SYNTHETIC_LONG_FORM_MODEL_REPAIR;
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi
        .fn()
        .mockResolvedValueOnce("Keep the plan and follow the repository standards.")
        .mockResolvedValueOnce(repaired),
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
      text: repaired,
      cleanup: {
        applied: true,
        status: "applied",
        fallbackReason: null,
        retryCount: 1,
      },
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(2);
  });

  it("does not waive an objective negation reversal in a long-form repair", async () => {
    const { original, repaired } = SYNTHETIC_LONG_FORM_MODEL_REPAIR;
    const unsafeRepair = repaired.replace(
      "the developer will run this sample workflow",
      "the developer will not run this sample workflow"
    );
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi
        .fn()
        .mockResolvedValueOnce("Keep the plan and follow the repository standards.")
        .mockResolvedValueOnce(unsafeRepair)
        .mockResolvedValueOnce(unsafeRepair),
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
        appliedModel: "gpt-5.6-luna",
      },
    });
    expect(reasoningService.processText).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      "gpt-5.6-luna",
      null,
      {
        cleanupPromptMode: "fidelity-repair",
        reasoningEffort: "none",
      }
    );
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

  it("keeps fidelity repairs on the selected model for custom endpoints", async () => {
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
      expect.any(String),
      "gpt-5.6-luna",
      null,
      { cleanupPromptMode: "fidelity-repair", reasoningEffort: "none" }
    );
  });

  it("records a failed selected-model retry as an attempted retry", async () => {
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

  it("preserves exact source punctuation and whitespace on provider fallback", async () => {
    const original = "  Keep Alpha — and Beta exactly.  ";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(async () => {
        throw new Error("Provider unavailable");
      }),
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
      cleanup: { status: "fallback", fallbackReason: "provider_error" },
    });
  });

  it("keeps a verified dictionary spelling when provider cleanup falls back", async () => {
    const original = "  Please send the dashboard to Rilji, then set the variable Rilji to true.  ";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(async () => {
        throw new Error("Provider unavailable");
      }),
    };
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService,
    });

    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");
    localStorage.setItem("customDictionary", JSON.stringify(["Rilje"]));

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: "  Please send the dashboard to Rilje, then set the variable Rilji to true.  ",
      cleanup: {
        applied: false,
        status: "fallback",
        fallbackReason: "provider_error",
        preferredSpellingApplied: true,
        metrics: { preferredSpellingCorrectionCount: 1 },
      },
    });
  });

  it.each(["under", "over", "via", "amid"])(
    "does not cross a %s adjunct when applying a dictionary spelling on provider fallback",
    async (preposition) => {
      const original = `Send Rilji ${preposition} the report metadata.`;
      const reasoningService = {
        isAvailable: vi.fn(async () => true),
        processText: vi.fn(async () => {
          throw new Error("Provider unavailable");
        }),
      };
      const svc = new ReasoningCleanupService({
        logger: { logReasoning: vi.fn() },
        reasoningService,
      });

      localStorage.setItem("reasoningModel", "gpt-5.6-luna");
      localStorage.setItem("reasoningProvider", "openai");
      localStorage.setItem("useReasoningModel", "true");
      localStorage.setItem("customDictionary", JSON.stringify(["Rilje"]));

      await expect(
        svc.processTranscriptionWithOutcome(original, "openai", null)
      ).resolves.toMatchObject({
        text: original,
        cleanup: {
          status: "fallback",
          fallbackReason: "provider_error",
          preferredSpellingApplied: false,
        },
      });
    }
  );

  it.each(["in-depth", "up-to-date", "over-the-counter"])(
    "keeps a %s object modifier attached while applying dictionary spelling on provider fallback",
    async (modifier) => {
      const original = `Please send Rilji the ${modifier} report today.`;
      const expected = `Please send Rilje the ${modifier} report today.`;
      const reasoningService = {
        isAvailable: vi.fn(async () => true),
        processText: vi.fn(async () => {
          throw new Error("Provider unavailable");
        }),
      };
      const svc = new ReasoningCleanupService({
        logger: { logReasoning: vi.fn() },
        reasoningService,
      });

      localStorage.setItem("reasoningModel", "gpt-5.6-luna");
      localStorage.setItem("reasoningProvider", "openai");
      localStorage.setItem("useReasoningModel", "true");
      localStorage.setItem("customDictionary", JSON.stringify(["Rilje"]));

      await expect(
        svc.processTranscriptionWithOutcome(original, "openai", null)
      ).resolves.toMatchObject({
        text: expected,
        cleanup: {
          status: "fallback",
          fallbackReason: "provider_error",
          preferredSpellingApplied: true,
        },
      });
    }
  );

  it("keeps a verified dictionary spelling when fidelity cleanup falls back", async () => {
    const original =
      "Please ask Rilji to keep reference 42, and set the variable Rilji to true before Friday.";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(async () => "Keep the important details."),
    };
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService,
    });

    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");
    localStorage.setItem("customDictionary", JSON.stringify(["Rilje"]));

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: "Please ask Rilje to keep reference 42, and set the variable Rilji to true before Friday.",
      cleanup: {
        applied: false,
        status: "fallback",
        fallbackReason: "fidelity_rejected",
        retryCount: 1,
        preferredSpellingApplied: true,
        metrics: { preferredSpellingCorrectionCount: 1 },
      },
    });
    expect(reasoningService.processText).toHaveBeenCalledTimes(2);
  });

  it("keeps mixed person and technical occurrences separate on accepted no-op cleanup", async () => {
    const original =
      "Email Rilji, then check whether the variable used in production is called Rilji.";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(async (text) => text),
    };
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService,
    });

    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");
    localStorage.setItem("customDictionary", JSON.stringify(["Rilje"]));

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: "Email Rilje, then check whether the variable used in production is called Rilji.",
      cleanup: {
        applied: true,
        status: "applied",
        modelSource: "selected",
        metrics: { preferredSpellingCorrectionCount: 1 },
      },
    });
    expect(reasoningService.processText).toHaveBeenCalledWith(
      "Email Rilje, then check whether the variable used in production is called Rilji.",
      "gpt-5.6-luna",
      null,
      expect.any(Object)
    );
  });

  it("does not apply a dictionary spelling in protected fallback context", async () => {
    const original = "Keep identifier Rilji unchanged.";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn(async () => {
        throw new Error("Provider unavailable");
      }),
    };
    const svc = new ReasoningCleanupService({
      logger: { logReasoning: vi.fn() },
      reasoningService,
    });

    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("reasoningProvider", "openai");
    localStorage.setItem("useReasoningModel", "true");
    localStorage.setItem("customDictionary", JSON.stringify(["Rilje"]));

    await expect(
      svc.processTranscriptionWithOutcome(original, "openai", null)
    ).resolves.toMatchObject({
      text: original,
      cleanup: {
        applied: false,
        status: "fallback",
        fallbackReason: "provider_error",
        preferredSpellingApplied: false,
      },
    });
  });

  it.each([
    "Please send Rilji after reviewing the proposal today.",
    "Please send Rilji before revising the report today.",
    "Please send Rilji using the revised proposal today.",
  ])(
    "keeps an adjunct-adjacent dictionary token byte-identical on provider failure: %s",
    async (original) => {
      const reasoningService = {
        isAvailable: vi.fn(async () => true),
        processText: vi.fn(async () => {
          throw new Error("Provider unavailable");
        }),
      };
      const svc = new ReasoningCleanupService({
        logger: { logReasoning: vi.fn() },
        reasoningService,
      });

      localStorage.setItem("reasoningModel", "gpt-5.6-luna");
      localStorage.setItem("reasoningProvider", "openai");
      localStorage.setItem("useReasoningModel", "true");
      localStorage.setItem("customDictionary", JSON.stringify(["Rilje"]));

      await expect(
        svc.processTranscriptionWithOutcome(original, "openai", null)
      ).resolves.toMatchObject({
        text: original,
        cleanup: {
          preferredSpellingApplied: false,
          status: "fallback",
          fallbackReason: "provider_error",
        },
      });
      expect(reasoningService.processText).toHaveBeenCalledWith(
        original,
        "gpt-5.6-luna",
        null,
        expect.any(Object)
      );
    }
  );

  it("still rejects a fidelity repair that loses a critical literal", async () => {
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
      "Keep reference 42 — do not remove the budget caveat, preserve the Friday deadline, retain the July pilot example, and ask whether both teams approved release?";
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

  it("asks the model to repair a rejected cleanup with the original and rejection evidence", async () => {
    const original =
      "Can you check whether the staging config differs? Because the new runner delegates tasks differently. Then tell me what you recommend.";
    const rejected = "Please check the staging configuration and report back.";
    const repaired =
      "Can you check whether the staging config differs because the new runner delegates tasks differently? Then tell me what you recommend.";
    const reasoningService = {
      isAvailable: vi.fn(async () => true),
      processText: vi.fn().mockResolvedValueOnce(rejected).mockResolvedValueOnce(repaired),
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
      text: repaired,
      cleanup: { status: "applied", fallbackReason: null, retryCount: 1 },
    });

    const retryPacket = JSON.parse(reasoningService.processText.mock.calls[1][0]);
    expect(retryPacket).toEqual({
      originalTranscript: original,
      rejectedCleanup: rejected,
      rejectionReasons: expect.any(Array),
    });
    expect(retryPacket.rejectionReasons.length).toBeGreaterThan(0);
    expect(reasoningService.processText.mock.calls[1][3]).toMatchObject({
      cleanupPromptMode: "fidelity-repair",
    });
  });
});
