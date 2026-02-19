import { describe, expect, it } from "vitest";

const { isTruthyFlag } = require("./flags");

describe("flags", () => {
  it("treats common truthy strings as true", () => {
    expect(isTruthyFlag("1")).toBe(true);
    expect(isTruthyFlag("true")).toBe(true);
    expect(isTruthyFlag("TRUE")).toBe(true);
    expect(isTruthyFlag(" yes ")).toBe(true);
    expect(isTruthyFlag("on")).toBe(true);
  });

  it("treats other values as false", () => {
    expect(isTruthyFlag("0")).toBe(false);
    expect(isTruthyFlag("false")).toBe(false);
    expect(isTruthyFlag("")).toBe(false);
    expect(isTruthyFlag("no")).toBe(false);
    expect(isTruthyFlag(undefined)).toBe(false);
    expect(isTruthyFlag(null)).toBe(false);
  });
});

