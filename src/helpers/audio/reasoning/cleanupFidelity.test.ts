import { describe, expect, it } from "vitest";

import { assessCleanupFidelity } from "./cleanupFidelity.js";

describe("assessCleanupFidelity", () => {
  it("accepts punctuation, spelling, and local clarity edits", () => {
    const original =
      "please check item 42 and ask did we preserve every caveat because i do not want the exception removed";
    const cleaned =
      'Please check item 42 and ask, "Did we preserve every caveat?" because I do not want the exception removed.';

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: true,
      reasons: [],
      metrics: {
        semanticMissingContentWordCount: 0,
        semanticAddedContentWordCount: 0,
      },
    });
  });

  it("allows an explicit false start to be replaced by its correction", () => {
    const original =
      "send it Tuesday no sorry Thursday and quote Sam said hold the release until legal confirms end quote";
    const cleaned = "Send it Thursday. “Sam said hold the release until legal confirms.”";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({ accepted: true, reasons: [] });
  });

  it("rejects inferred nested attribution inside explicit quote boundaries", () => {
    const original =
      "send it Tuesday no sorry Thursday and quote Sam said hold the release until legal confirms end quote";
    const cleaned =
      "Send it Thursday, and quote: “Sam said, ‘Hold the release until legal confirms.’”";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["nested-quotation-inference"]),
    });
  });

  it("does not mistake an apostrophe inside an explicit quotation for nested speech", () => {
    const original = "quote I don't know whether it's ready end quote";
    const cleaned = "“I don’t know whether it’s ready.”";

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

  it("retries a long rewrite with high attachment risk even when its length is preserved", () => {
    const original =
      "Please revise the workflow so it keeps the reviewers operating the way we agreed, preserves the policy exception, records who approved each stage, and brings the proposed wording back before anyone makes the change. Keep the customer example, the fallback owner, and the unresolved timing question attached to that request.";
    const cleaned =
      "Please update the workflow for reviewers according to our agreement and policy. Record approval at every stage, then make the change before returning the proposed wording. The customer example should identify a fallback owner and resolve the timing question.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["high-rewrite-risk"]),
    });
  });

  it("accepts punctuation-only cleanup in a long dictation", () => {
    const original =
      "please keep the release note the customer example the fallback owner and the unresolved timing question then ask both teams whether they still approve the friday plan because legal has not confirmed the final wording and we need every caveat preserved before publication";
    const cleaned =
      "Please keep the release note, the customer example, the fallback owner, and the unresolved timing question. Then ask both teams whether they still approve the Friday plan, because legal has not confirmed the final wording and we need every caveat preserved before publication.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({ accepted: true, reasons: [] });
  });

  it("retries a long rewrite that introduces multiple new content terms", () => {
    const original =
      "Please review the current workflow, keep every existing caveat, preserve the risk-based approach, retain the customer example, name the fallback owner, record the unresolved timing question, and bring the proposed wording back before making any change because both teams still need to approve the final version before publication. Keep the legal condition, the July pilot example, and the notification requirement in their original sequence as well.";
    const cleaned =
      "Please review the current workflow, keep every existing caveat, evaluate the risk-based approach, retain the customer example, name the fallback owner, resolve the timing question, and bring the proposed wording back before making any change because both teams still need to approve the final version before publication. Keep the legal condition, the July pilot example, and the notification requirement in their original sequence as well.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["high-rewrite-risk"]),
      metrics: expect.objectContaining({
        addedContentWordCount: 2,
        semanticAddedContentWordCount: 2,
      }),
    });
  });

  it("allows harmless inflection and one-character spelling repairs in long text", () => {
    const original =
      "Please keep the reviewers work aligned with the agreed workflow, preserve every caveat, record the customer examples, name the fallback owner, retain the unresolved timing question, and bring the proposed wording back before making a change. The teams has asked that grammer errors be corrected while every substantive point remains in its original sequence.";
    const cleaned =
      "Please keep the reviewers' work aligned with the agreed workflow, preserve every caveat, record the customer example, name the fallback owner, retain the unresolved timing question, and bring the proposed wording back before making a change. The teams have asked that grammar errors be corrected while every substantive point remains in its original sequence.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: true,
      reasons: [],
      metrics: {
        semanticMissingContentWordCount: 0,
        semanticAddedContentWordCount: 0,
      },
    });
  });

  it("rejects loss of an explicit sequencing relationship", () => {
    const original = "Review the draft, then bring the wording back before making the change.";
    const cleaned = "Review the draft and bring the wording back before making the change.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["relation-marker-loss"]),
    });
  });

  it("rejects a sequenced action changed into an attached gerund", () => {
    const original =
      "Pause and assess efficiency, delegation, and sprint size, and then use a risk-based approach until the final gate.";
    const cleaned =
      "Pause and assess efficiency, delegation, sprint size, and then using a risk-based approach until the final gate.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["relation-verb-form-change"]),
    });
  });

  it("allows a sequenced action to retain its verb form while fixing mechanics", () => {
    const original = "check the options and then use the safer approach";
    const cleaned = "Check the options, and then use the safer approach.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({ accepted: true, reasons: [] });
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

  it("rejects rewritten model, directory, and agent-file tokens", () => {
    const original =
      "Keep GPT 5.6 as written, then open the tmp directory and the refractor agent file.";
    const cleaned =
      "Keep GPT-5.6 as written, then open the temp directory and the refactor agent file.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["technical-token-change"]),
      metrics: expect.objectContaining({ missingProtectedTechnicalTokenCount: 4 }),
    });
  });

  it("allows capitalization while preserving a technical token", () => {
    const original = "Use gpt model output in the tmp directory.";
    const cleaned = "Use GPT model output in the tmp directory.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({ accepted: true, reasons: [] });
  });

  it("does not freeze ordinary prose hyphenation", () => {
    const original = "Please make this user-facing explanation easier to read.";
    const cleaned = "Please make this user facing explanation easier to read.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({ accepted: true, reasons: [] });
  });

  it("rejects quotation marks wrapped around the whole dictation without a quote instruction", () => {
    const original = "Please keep this request as dictated and send it in the final response.";
    const cleaned = "“Please keep this request as dictated and send it in the final response.”";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["added-whole-output-quotation"]),
    });
  });

  it("allows explicit whole-output quotation", () => {
    const original =
      "Open quote please keep this request exactly as written for the final response close quote";
    const cleaned = "“Please keep this request exactly as written for the final response.”";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({ accepted: true, reasons: [] });
  });

  it("allows filler-only empty input to remain empty", () => {
    expect(assessCleanupFidelity("", "")).toMatchObject({ accepted: true });
  });
});
