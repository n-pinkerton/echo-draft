import { describe, expect, it } from "vitest";

import { shouldSuppressWindowPresentation } from "./e2eWindowPresentation.js";

describe("window E2E presentation policy", () => {
  it("keeps ordinary window presentation enabled", () => {
    expect(shouldSuppressWindowPresentation({})).toBe(false);
    expect(
      shouldSuppressWindowPresentation({
        OPENWHISPR_E2E_SUPPRESS_WINDOW_FOCUS: "true",
      })
    ).toBe(false);
  });

  it("suppresses window presentation only in explicitly safe E2E mode", () => {
    expect(
      shouldSuppressWindowPresentation({
        OPENWHISPR_E2E: "true",
        OPENWHISPR_E2E_SUPPRESS_WINDOW_FOCUS: "true",
      })
    ).toBe(true);
  });
});
