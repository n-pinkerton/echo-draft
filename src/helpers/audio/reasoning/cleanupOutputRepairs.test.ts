import { describe, expect, it } from "vitest";

import { repairRequestReasonFragment } from "./cleanupOutputRepairs.js";

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
