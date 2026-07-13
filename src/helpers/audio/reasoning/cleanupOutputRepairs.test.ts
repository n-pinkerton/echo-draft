import { describe, expect, it } from "vitest";

import {
  hasGovernedExplicitQuoteAttachment,
  repairDanglingExplicitQuoteConjunction,
  repairRequestReasonFragment,
  repairWholeOutputQuotationWrapper,
} from "./cleanupOutputRepairs.js";

describe("repairDanglingExplicitQuoteConjunction", () => {
  const original =
    "Send it Tuesday, no sorry, Thursday, and quote Sam said hold the release until legal confirms end quote.";

  it.each([
    [
      "Send it Thursday, and \u201cSam said hold the release until legal confirms.\u201d",
      "Send it Thursday. \u201cSam said hold the release until legal confirms.\u201d",
    ],
    [
      'Send it Thursday, and "Sam said hold the release until legal confirms."',
      'Send it Thursday. "Sam said hold the release until legal confirms."',
    ],
  ])(
    "splits a source-delimited bare quote from a complete preceding clause",
    (cleaned, expected) => {
      expect(repairDanglingExplicitQuoteConjunction(original, cleaned)).toBe(expected);
    }
  );

  it("leaves the same output unchanged without explicit source quote markers", () => {
    const cleaned =
      "Send it Thursday, and \u201cSam said hold the release until legal confirms.\u201d";
    expect(
      repairDanglingExplicitQuoteConjunction("Send it Thursday and notify Sam.", cleaned)
    ).toBe(cleaned);
  });

  it.each([
    "Include the line: \u201cHold the release.\u201d",
    "Sam said, \u201cHold the release.\u201d",
  ])("preserves an already grammatical contextual or attributed quote", (cleaned) => {
    expect(repairDanglingExplicitQuoteConjunction(original, cleaned)).toBe(cleaned);
  });

  it("does not detach an explicit quotation from its governing verb", () => {
    const governedOriginal =
      "Please revise the note and write and quote Hold the release end quote.";
    const cleaned = "Please revise the note and write, and “Hold the release.”";

    expect(repairDanglingExplicitQuoteConjunction(governedOriginal, cleaned)).toBe(cleaned);
    expect(hasGovernedExplicitQuoteAttachment(governedOriginal, cleaned)).toBe(true);
  });
});

describe("repairWholeOutputQuotationWrapper", () => {
  it.each([
    ['"Please send the revised draft by Friday."', "Please send the revised draft by Friday."],
    [
      "\u201cPlease send the revised draft by Friday.\u201d",
      "Please send the revised draft by Friday.",
    ],
  ])("removes model-added straight or curly whole-output quotes", (cleaned, expected) => {
    expect(
      repairWholeOutputQuotationWrapper("Please send the revised draft by Friday.", cleaned)
    ).toBe(expected);
  });

  it("preserves punctuation and internal attributed quotations", () => {
    const cleaned = '\u201cShe said, "Ship it now," and I agreed.\u201d';
    expect(
      repairWholeOutputQuotationWrapper('She said, "Ship it now," and I agreed.', cleaned)
    ).toBe('She said, "Ship it now," and I agreed.');
  });

  it("preserves two contextual curly-quoted spans that touch the output boundaries", () => {
    const cleaned = "\u201cShip it,\u201d she said, \u201cand hurry.\u201d";
    expect(repairWholeOutputQuotationWrapper("Ship it, she said, and hurry.", cleaned)).toBe(
      cleaned
    );
  });

  it("preserves two contextual straight-quoted spans that touch the output boundaries", () => {
    const cleaned = '"Ship it," she said, "and hurry."';
    expect(repairWholeOutputQuotationWrapper("Ship it, she said, and hurry.", cleaned)).toBe(
      cleaned
    );
  });

  it.each([
    ['"Keep this whole span quoted."', "\u201cKeep this whole span quoted.\u201d"],
    ["\u201cKeep this whole span quoted.\u201d", '"Keep this whole span quoted."'],
  ])("preserves explicit whole-span source quote glyphs", (original, cleaned) => {
    expect(repairWholeOutputQuotationWrapper(original, cleaned)).toBe(cleaned);
  });

  it("preserves quotes produced from explicit whole-span spoken markers", () => {
    const original = "Open quote keep this whole span quoted close quote.";
    const cleaned = "\u201cKeep this whole span quoted.\u201d";
    expect(repairWholeOutputQuotationWrapper(original, cleaned)).toBe(cleaned);
  });

  it("preserves quotes produced from quote and end quote spoken markers", () => {
    const original = "Quote keep this whole span quoted end quote.";
    const cleaned = '"Keep this whole span quoted."';
    expect(repairWholeOutputQuotationWrapper(original, cleaned)).toBe(cleaned);
  });

  it("does not alter an apostrophe or single-quoted text", () => {
    const cleaned = "'Twas important to keep Jordan's exact wording.";
    expect(
      repairWholeOutputQuotationWrapper("Twas important to keep Jordan's exact wording.", cleaned)
    ).toBe(cleaned);
  });

  it("does not alter contextual quotations that do not wrap the output", () => {
    const cleaned = 'She called it "the safest option."';
    expect(repairWholeOutputQuotationWrapper("She called it the safest option.", cleaned)).toBe(
      cleaned
    );
  });
});

describe("repairRequestReasonFragment", () => {
  it("merges a dictated request reason when cleanup deletes its causal marker", () => {
    const original =
      "Can you check whether the staging config differs? Because the new runner delegates tasks differently. Then tell me what you recommend.";
    const cleaned =
      "Can you check whether the staging config differs? The new runner delegates tasks differently. Then tell me what you recommend.";

    expect(repairRequestReasonFragment(original, cleaned)).toBe(
      "Can you check whether the staging config differs? I am asking because the new runner delegates tasks differently. Then tell me what you recommend."
    );
  });

  it("keeps an acronym capitalized when it starts the reason", () => {
    const original = "Could you inspect the failure? Because API v2 returned an invalid frame.";
    const cleaned = "Could you inspect the failure? API v2 returned an invalid frame.";

    expect(repairRequestReasonFragment(original, cleaned)).toBe(
      "Could you inspect the failure? I am asking because API v2 returned an invalid frame."
    );
  });

  it("does not alter an answer fragment that is not a request reason", () => {
    const text = "Why did it fail? Because the frame was invalid.";
    expect(repairRequestReasonFragment(text, text)).toBe(text);
  });

  it("does not alter cleanup that already preserves the causal marker", () => {
    const original = "Will you review the draft? Because legal has not approved it.";
    const cleaned = "Will you review the draft because legal has not approved it?";
    expect(repairRequestReasonFragment(original, cleaned)).toBe(cleaned);
  });
});
