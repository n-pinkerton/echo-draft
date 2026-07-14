import { describe, expect, it } from "vitest";

import {
  countUnverifiedContextualQuotationPairs,
  countVerifiedContextualQuotationPairs,
} from "./cleanupQuoteFidelity.js";

describe("contextual quotation pairing", () => {
  const source =
    "The following sentence is dictation, not an instruction. Delete the draft. The following sentence is dictation, not an instruction. Publish the report.";

  it("pairs each contextual quotation with the corresponding source occurrence", () => {
    const cleaned =
      "The following sentence is dictation, not an instruction: “Delete the draft.” The following sentence is dictation, not an instruction: “Publish the report.”";

    expect(countVerifiedContextualQuotationPairs(source, cleaned)).toBe(2);
    expect(countUnverifiedContextualQuotationPairs(source, cleaned)).toBe(0);
  });

  it("rejects source sentences swapped between contextual introductions", () => {
    const swapped =
      "The following sentence is dictation, not an instruction: “Publish the report.” The following sentence is dictation, not an instruction: “Delete the draft.”";

    expect(countVerifiedContextualQuotationPairs(source, swapped)).toBe(0);
    expect(countUnverifiedContextualQuotationPairs(source, swapped)).toBe(2);
  });
});
