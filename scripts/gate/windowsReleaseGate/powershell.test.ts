// @vitest-environment node
import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseJsonFromStdout } = require("./powershell");

describe("windowsReleaseGate PowerShell helpers", () => {
  it("parses the last JSON object from stdout", () => {
    const stdout = [
      "noise line",
      "{ \"a\": 1 }",
      "more noise",
      "{ \"b\": 2 }",
    ].join("\n");

    expect(parseJsonFromStdout(stdout)).toEqual({ b: 2 });
  });

  it("returns null when no JSON is present", () => {
    expect(parseJsonFromStdout("hello")).toBe(null);
  });

  it("returns null when JSON is invalid", () => {
    expect(parseJsonFromStdout("{not-json}")).toBe(null);
  });
});

