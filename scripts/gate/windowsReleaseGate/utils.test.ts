// @vitest-environment node
import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isTruthyFlag, safeString } = require("./utils");

describe("windowsReleaseGate utils", () => {
  it("parses truthy flags", () => {
    expect(isTruthyFlag("1")).toBe(true);
    expect(isTruthyFlag("true")).toBe(true);
    expect(isTruthyFlag(" YES ")).toBe(true);
    expect(isTruthyFlag("on")).toBe(true);

    expect(isTruthyFlag("0")).toBe(false);
    expect(isTruthyFlag("false")).toBe(false);
    expect(isTruthyFlag("")).toBe(false);
    expect(isTruthyFlag(null)).toBe(false);
  });

  it("coerces values to safe strings", () => {
    expect(safeString("x")).toBe("x");
    expect(safeString(null)).toBe("");
    expect(safeString(undefined)).toBe("");
    expect(safeString(123)).toBe("123");
  });
});

