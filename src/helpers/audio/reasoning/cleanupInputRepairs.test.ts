import { describe, expect, it } from "vitest";

import { repairMisrecognizedSpokenQuoteBoundary } from "./cleanupInputRepairs.js";

describe("repairMisrecognizedSpokenQuoteBoundary", () => {
  it("repairs an attributed end-quote marker misrecognized before a numbered list", () => {
    const source =
      "Charlie said, quote, we should keep all three options open, and, quote, first confirm the budget, second schedule the review, and third retain the caveat.";

    expect(repairMisrecognizedSpokenQuoteBoundary(source)).toBe(
      "Charlie said, quote, we should keep all three options open, end quote, first confirm the budget, second schedule the review, and third retain the caveat."
    );
  });

  it.each([
    "Quote the first line, and, quote, then save it.",
    "Charlie said, quote, keep option A, and quote option B.",
    "Charlie said, quote, keep A, and, quote, then quote the title.",
    "Charlie said, quote, keep A, and, quote, first choose option B.",
    "Charlie said, quote, keep A, and, quote, first choose B. The second version mentions a third party.",
    "Charlie said, quote, keep the first option, and, quote, because it is safer.",
  ])("leaves an ambiguous or ordinary quote phrase unchanged: %s", (source) => {
    expect(repairMisrecognizedSpokenQuoteBoundary(source)).toBe(source);
  });
});
