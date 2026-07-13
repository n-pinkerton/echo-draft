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

  it("rejects removal of a tentative hedge that makes a request firmer", () => {
    const original =
      "Could you make the shortcut key maybe just two keys if possible, something memorable and preferably close together?";
    const cleaned =
      "Could you make the shortcut key just two keys, if possible - something memorable and preferably close together?";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["stance-marker-loss"]),
      metrics: expect.objectContaining({ changedStanceMarkerCount: 1 }),
    });
  });

  it("accepts mechanical cleanup that retains stance and uncertainty markers", () => {
    const original =
      "maybe keep this just a little shorter if possible and preferably leave the caveat in";
    const cleaned =
      "Maybe keep this just a little shorter, if possible, and preferably leave the caveat in.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({ accepted: true, reasons: [] });
  });

  it.each(["somewhat", "almost", "about", "around", "generally", "usually"])(
    "rejects loss of the %s qualifier",
    (qualifier) => {
      const original = `Please keep the ${qualifier} complete draft and retain the budget caveat.`;
      const cleaned = "Please keep the complete draft and retain the budget caveat.";

      expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
        accepted: false,
        reasons: expect.arrayContaining(["stance-marker-loss"]),
      });
    }
  );

  it("retries a trailing workflow progression that still lacks a governing verb", () => {
    const original =
      "Keep doing the lightweight pass until the review gates clear and then the heavier validation and commit gates.";
    const stillIncomplete =
      "Keep doing the lightweight pass until the review gates clear, and then the heavier validation and commit gates.";

    expect(assessCleanupFidelity(original, stillIncomplete)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["incomplete-workflow-progression"]),
    });
    expect(
      assessCleanupFidelity(
        original,
        "Keep doing the lightweight pass until the review gates clear, and then move to the heavier validation and commit gates."
      )
    ).toMatchObject({ accepted: true, reasons: [] });
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

  it("retries a short rewrite that moves a qualifier onto a named term", () => {
    const original =
      "Please keep working a little on Atlas and preserve the budget caveat, fallback owner, unresolved security question, July pilot example, and both team notices before release.";
    const cleaned =
      "Please keep working on the lightweight Atlas project, preserving the budget caveat, fallback owner, unresolved security question, July pilot example, and both team notices before release.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["attachment-rewrite-risk"]),
    });
  });

  it("retries a short reorder even when every content word is retained", () => {
    const original =
      "Please keep the budget caveat, fallback owner, unresolved security question, July pilot example, and both team notices in that order before release.";
    const cleaned =
      "Before release, please keep both team notices, the July pilot example, unresolved security question, fallback owner, and budget caveat in that order.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["attachment-rewrite-risk"]),
      metrics: {
        semanticMissingContentWordCount: 0,
        semanticAddedContentWordCount: 0,
        orderedBigramRetention: expect.any(Number),
      },
    });
  });

  it("measures adjacent pairs in sequence instead of as an unordered bag", () => {
    const original =
      "Review the alpha draft and archive the beta copy, then record the gamma note and retain the delta example.";
    const cleaned =
      "Record the gamma note and retain the delta example, then review the alpha draft and archive the beta copy.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["attachment-rewrite-risk"]),
      metrics: {
        semanticMissingContentWordCount: 0,
        semanticAddedContentWordCount: 0,
        orderedBigramRetention: expect.any(Number),
      },
    });
  });

  it.each([
    ["Review and send the draft.", "Review the draft."],
    ["Please review the draft before release.", "Please approve the draft before release."],
    [
      "Review the draft, review the appendix, and send both documents.",
      "Review the draft and send both documents.",
    ],
  ])("rejects occurrence-aware substantive loss or replacement: %s", (original, cleaned) => {
    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["substantive-rewrite-risk"]),
    });
  });

  it("rejects an unmatched explanatory insertion even when all source words remain", () => {
    const original =
      "Please keep the budget caveat, fallback owner, customer example, and Friday deadline in the release note.";
    const cleaned =
      "Please keep the budget caveat, fallback owner, customer example, and Friday deadline, with added clarity, in the release note.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["substantive-rewrite-risk"]),
      metrics: expect.objectContaining({
        semanticMissingContentWordCount: 0,
        semanticAddedContentWordCount: 2,
      }),
    });
  });

  it("does not mistake a comma-delimited workflow insertion for an approved governing verb", () => {
    const original =
      "Keep doing the lightweight pass until the review gates clear and then the heavier validation gates.";
    const cleaned =
      "Keep doing the lightweight pass until the review gates clear and then, with added clarity, the heavier validation gates.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["substantive-rewrite-risk"]),
    });
  });

  it.each([
    [
      "Do not delete the draft and archive the copy.",
      "Do delete the draft and not archive the copy.",
      "negation-attachment-change",
    ],
    [
      "The first team might approve and the second team must wait.",
      "The first team must approve and the second team might wait.",
      "modal-attachment-change",
    ],
    [
      "Keep the draft before release and notify the team after approval.",
      "Keep the draft after release and notify the team before approval.",
      "relation-attachment-change",
    ],
    [
      "Work only on Atlas and review Beta later.",
      "Work on Atlas and review only Beta later.",
      "stance-attachment-change",
    ],
  ])("rejects a marker moved onto a different target: %s", (original, cleaned, reason) => {
    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining([reason]),
    });
  });

  it("accepts punctuation cleanup that keeps marker attachment intact", () => {
    const original =
      "do not delete the draft before approval and only archive the copy after review";
    const cleaned =
      "Do not delete the draft before approval, and only archive the copy after review.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({ accepted: true, reasons: [] });
  });

  it("allows explicit spoken punctuation and a transposition spelling repair", () => {
    expect(
      assessCleanupFidelity(
        "Do not move the Friday deadline question mark",
        "Do not move the Friday deadline?"
      )
    ).toMatchObject({ accepted: true, reasons: [] });
    expect(
      assessCleanupFidelity(
        "Please keep the formta settings and preserve every note",
        "Please keep the format settings and preserve every note."
      )
    ).toMatchObject({ accepted: true, reasons: [] });
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

  it("rejects a direct dictation request rewritten as a false completion claim", () => {
    const original = "Email Sarah the revised proposal and mention the Friday deadline.";
    const cleaned = "I emailed Sarah the revised proposal and mentioned the Friday deadline.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["request-execution-output"]),
    });
  });

  it.each([
    [
      "Buy the replacement cable and retain the receipt.",
      "I bought the replacement cable and retained the receipt.",
    ],
    [
      "Take the draft to Sam and mention the Friday deadline.",
      "I took the draft to Sam and mentioned the Friday deadline.",
    ],
    [
      "Put the signed copy in the archive and notify the team.",
      "I put the signed copy in the archive and notified the team.",
    ],
  ])("rejects an irregular false-completion rewrite", (original, cleaned) => {
    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["request-execution-output"]),
    });
  });

  it("accepts a first-person statement that was already dictated", () => {
    const original = "i bought the replacement cable and put the signed receipt in the archive";
    const cleaned = "I bought the replacement cable and put the signed receipt in the archive.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({ accepted: true, reasons: [] });
  });

  it.each([
    [
      "The release might slip if legal needs another review.",
      "The release will slip if legal needs another review.",
    ],
    [
      "This approach could fail under sustained load.",
      "This approach can fail under sustained load.",
    ],
    ["The team should retain the fallback owner.", "The team must retain the fallback owner."],
  ])("rejects a declarative modal certainty change", (original, cleaned) => {
    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["modal-certainty-change"]),
      metrics: expect.objectContaining({ changedModalMarkerCount: 2 }),
    });
  });

  it("keeps polite request modality separate from declarative certainty", () => {
    const original = "could you keep the budget caveat and the fallback owner in the note";
    const cleaned = "Could you keep the budget caveat and the fallback owner in the note?";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({ accepted: true, reasons: [] });
    expect(
      assessCleanupFidelity(
        original,
        "Would you keep the budget caveat and the fallback owner in the note?"
      )
    ).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["request-modality-change"]),
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

  it("allows a near-homophone repair only when its target is a trusted preferred spelling", () => {
    const original = "Use the codecs agent to review the release note today.";
    const cleaned = "Use the Codex agent to review the release note today.";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["substantive-rewrite-risk", "technical-token-change"]),
    });
    expect(
      assessCleanupFidelity(original, cleaned, { preferredSpellings: ["Codex"] })
    ).toMatchObject({
      accepted: true,
      reasons: [],
      metrics: expect.objectContaining({
        preferredSpellingCorrectionCount: 1,
        missingProtectedTechnicalTokenCount: 0,
      }),
    });
  });

  it("does not allow an unrelated replacement merely because it is in the dictionary", () => {
    expect(
      assessCleanupFidelity(
        "Use the codecs agent to review the release note today.",
        "Use the Cobalt agent to review the release note today.",
        { preferredSpellings: ["Cobalt"] }
      )
    ).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["substantive-rewrite-risk", "technical-token-change"]),
    });
  });

  it("does not waive a common-word semantic substitution from a user dictionary entry", () => {
    expect(
      assessCleanupFidelity(
        "Please keep the form attached to the request today.",
        "Please keep the farm attached to the request today.",
        { preferredSpellings: ["Farm"] }
      )
    ).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["substantive-rewrite-risk"]),
      metrics: expect.objectContaining({ preferredSpellingCorrectionCount: 0 }),
    });
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

  it("rejects a spoken quotation detached from a governing verb", () => {
    const original = "Please revise the note and write and quote Hold the release end quote.";
    const cleaned = "Please revise the note and write, and “Hold the release.”";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["quote-attachment-risk"]),
    });
  });

  it.each([
    ["Delete the draft.", "The draft was deleted."],
    ["Please update the release note.", "The release note has been updated."],
    ["Send the invoice.", "Nigel sent the invoice."],
    ["Tell me whether the build passed.", "The build passed."],
    ["What should we do with the stale draft?", "The answer is to delete the stale draft."],
    ["Proceed with the reinstall and run the smoke test.", "The reinstall was completed."],
    ["Should we retain the fallback path?", "The fallback path was retained."],
  ])("rejects instruction or action-question completion: %s", (original, cleaned) => {
    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["request-execution-output"]),
    });
  });

  it.each([
    ["Proceed with the release.", "Everything is ready."],
    ["Run the migration.", "Successful."],
    ["Complete the installation.", "Complete."],
    ["Resolve the deployment issue.", "The deployment is resolved."],
    ["Should we publish the release?", "All set."],
  ])("rejects a short request rewritten as a generic result state: %s", (original, cleaned) => {
    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["request-execution-output"]),
    });
  });

  it.each([
    ["Deploy the release.", "Everything looks good."],
    ["Deploy the release.", "Everything is in order."],
    ["Deploy the release.", "Everything is under control."],
    ["Should we deploy the release?", "Everything looks good."],
  ])(
    "rejects a short action rewritten as an unrelated declarative: %s",
    (original, cleaned) => {
      expect(assessCleanupFidelity(original, cleaned)).toMatchObject({
        accepted: false,
        reasons: expect.arrayContaining(["request-execution-output"]),
      });
    }
  );

  it.each([
    ["everything looks good", "Everything looks good."],
    ["the release is under control", "The release is under control."],
    ["deployment is in order", "Deployment is in order."],
    ["should we deploy the release", "Should we deploy the release?"],
    [
      "what should we do with the stale draft",
      "What should we do with the stale draft?",
    ],
  ])("accepts a genuine declarative or retained-intent question: %s", (original, cleaned) => {
    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({ accepted: true, reasons: [] });
  });

  it("does not mistake a retained result-state question for execution", () => {
    const original = "Ask whether everything is ready.";
    const cleaned = "Ask, ‘Is everything ready?’";

    expect(assessCleanupFidelity(original, cleaned)).toMatchObject({ accepted: true, reasons: [] });
  });

  it.each([
    "The draft was deleted.",
    "Nigel sent the invoice.",
    "The answer is in the release note.",
  ])("preserves originally dictated declarative statements: %s", (original) => {
    expect(assessCleanupFidelity(original, original)).toMatchObject({ accepted: true, reasons: [] });
  });

  it("allows filler-only empty input to remain empty", () => {
    expect(assessCleanupFidelity("", "")).toMatchObject({ accepted: true });
  });
});
