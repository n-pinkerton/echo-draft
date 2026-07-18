import { describe, expect, it } from "vitest";

import {
  MAX_CLEANUP_TITLE_LENGTH,
  normalizeCleanupTitle,
  parseCleanupOutput,
} from "./cleanupOutputContract.cjs";

describe("cleanup output contract", () => {
  it("extracts a title and cleaned body from the exact JSON contract", () => {
    expect(
      parseCleanupOutput(
        JSON.stringify({ title: "Follow up with Sam", text: "Please follow up with Sam." })
      )
    ).toEqual({
      title: "Follow up with Sam",
      text: "Please follow up with Sam.",
      contractSucceeded: true,
    });
  });

  it("accepts a fenced contract and normalizes harmless title whitespace", () => {
    expect(
      parseCleanupOutput(
        '```json\n{"title":"  Review   Friday\\nrelease ","text":"Review the Friday release."}\n```'
      )
    ).toEqual({
      title: "Review Friday release",
      text: "Review the Friday release.",
      contractSucceeded: true,
    });
  });

  it("keeps cleaned text when the title contract is missing or invalid", () => {
    expect(parseCleanupOutput('{"text":"Keep the cleaned text."}')).toEqual({
      title: null,
      text: "Keep the cleaned text.",
      contractSucceeded: false,
    });
    expect(
      parseCleanupOutput({
        title: "x".repeat(MAX_CLEANUP_TITLE_LENGTH + 1),
        text: "Keep this too.",
      })
    ).toEqual({ title: null, text: "Keep this too.", contractSucceeded: false });
  });

  it("recovers the cleaned text field from a malformed envelope", () => {
    expect(
      parseCleanupOutput('{"title":"Release note","text":"Keep \\"all\\" details.",}')
    ).toEqual({
      title: null,
      text: 'Keep "all" details.',
      contractSucceeded: false,
    });
  });

  it("treats plain model output as usable cleaned text without a title", () => {
    expect(parseCleanupOutput("Please follow up tomorrow.")).toEqual({
      title: null,
      text: "Please follow up tomorrow.",
      contractSucceeded: false,
    });
  });

  it("preserves a non-JSON labelled response without accepting a title contract", () => {
    const output = "Title: Release note\nText: Keep every detail.";
    expect(parseCleanupOutput(output)).toEqual({
      title: null,
      text: output,
      contractSucceeded: false,
    });
  });

  it("recovers a labelled body when source context proves the labels are a wrapper", () => {
    expect(
      parseCleanupOutput("Title: Release note\nText: Keep every detail.", "Keep every detail.")
    ).toEqual({
      title: null,
      text: "Keep every detail.",
      contractSucceeded: false,
      formatRecovery: {
        kind: "labelled",
        originalOutput: "Title: Release note\nText: Keep every detail.",
      },
    });
  });

  it.each([
    "Text: Keep every detail.",
    "Opening paragraph.\nText: Keep this literal labelled line.",
    "Title: Quarterly note\nText: Keep this complete labelled note.",
    'Explain the example field "text": "without parsing this prose".',
  ])("preserves ambiguous plain-text output byte for byte", (output) => {
    expect(parseCleanupOutput(output)).toEqual({
      title: null,
      text: output,
      contractSucceeded: false,
    });
  });

  it("rejects unsafe or oversized titles", () => {
    expect(normalizeCleanupTitle("\u0000Unsafe")).toBe("Unsafe");
    expect(normalizeCleanupTitle("x".repeat(MAX_CLEANUP_TITLE_LENGTH + 1))).toBeNull();
    expect(normalizeCleanupTitle("   ")).toBeNull();
  });
});
