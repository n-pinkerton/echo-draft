import { describe, expect, it } from "vitest";

const { parseParakeetResult } = require("./resultParser");

describe("parseParakeetResult", () => {
  it("returns no-audio when missing text", () => {
    expect(parseParakeetResult(null)).toEqual({ success: false, message: "No audio detected" });
    expect(parseParakeetResult({})).toEqual({ success: false, message: "No audio detected" });
    expect(parseParakeetResult({ text: "   " })).toEqual({ success: false, message: "No audio detected" });
  });

  it("returns trimmed text", () => {
    expect(parseParakeetResult({ text: " hello " })).toEqual({ success: true, text: "hello" });
  });
});

