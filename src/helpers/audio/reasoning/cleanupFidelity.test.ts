import { describe, expect, it } from "vitest";

import { assessCleanupFidelity } from "./cleanupFidelity.js";

describe("assessCleanupFidelity", () => {
  it("accepts punctuation, spelling, and local clarity edits", () => {
    const original =
      "please check item 42 and ask did we preserve every caveat because i do not want the exception removed";
    const cleaned =
      'Please check item 42 and ask, "Did we preserve every caveat?" because I do not want the exception removed.';

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({ accepted: true, reasons: [] });
  });

  it("allows an explicit false start to be replaced by its correction", () => {
    const original =
      "send it Tuesday no sorry Thursday and quote Sam said hold the release until legal confirms end quote";
    const cleaned = 'Send it Thursday. Sam said, "Hold the release until legal confirms."';

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({ accepted: true, reasons: [] });
  });

  it("rejects material summarisation", () => {
    const original =
      "We need to keep the budget caveat, the Friday deadline, the fallback owner, the unresolved security question, and the requirement to notify both teams before release. Please preserve the example about the July pilot as well.";
    const cleaned = "Keep the key release details and notify everyone.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["material-compression"]),
    });
  });

  it("rejects a polished short rewrite that drops one substantive clause", () => {
    const original =
      "Please keep the release note, explain the customer impact, retain the budget caveat, name the fallback owner, mention the Friday deadline, and say that both teams still need to approve the final wording before publication.";
    const cleaned =
      "Please keep the release note, explain the customer impact, retain the budget caveat, name the fallback owner, and mention the Friday deadline before publication.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["material-compression"]),
    });
  });

  it("rejects execution-style answers that were not dictated", () => {
    const original = "Check the deployment notes and tell Sam to update the ticket.";
    const cleaned = "Certainly, I have checked the deployment notes and updated the ticket.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["assistant-action-output"]),
    });
  });

  it("rejects lost numbers, URLs, negations, and questions", () => {
    const original = "Do not change item 5.6. Is https://example.com ready?";
    const cleaned = "Change the item. The site is ready.";
    const assessment = assessCleanupFidelity(original, cleaned);

    expect(assessment.accepted).toBe(false);
    expect(assessment.reasons).toEqual(
      expect.arrayContaining(["critical-token-loss", "negation-loss", "question-loss"])
    );
  });

  it("rejects an added negation that reverses a condition", () => {
    const original = "Allow the exception if the file can meet the threshold.";
    const cleaned = "Allow the exception if the file cannot meet the threshold.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["negation-addition"]),
    });
  });

  it("does not treat a number embedded in a different number as preserved", () => {
    const original = "Keep reference 42 in the release note.";
    const cleaned = "Keep reference 142 in the release note.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["critical-token-loss"]),
    });
  });

  it("allows filler-only empty input to remain empty", () => {
    expect(assessCleanupFidelity("", "")).toMatchObject({ accepted: true });
  });
});
