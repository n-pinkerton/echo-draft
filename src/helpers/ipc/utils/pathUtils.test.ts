import { describe, expect, it } from "vitest";

const { isPathWithin } = require("./pathUtils");

describe("pathUtils", () => {
  it("allows exact parent path", () => {
    expect(isPathWithin("/tmp/base", "/tmp/base")).toBe(true);
  });

  it("allows child path within parent", () => {
    expect(isPathWithin("/tmp/base", "/tmp/base/child/file.txt")).toBe(true);
  });

  it("rejects sibling/parent traversal", () => {
    expect(isPathWithin("/tmp/base", "/tmp/other/file.txt")).toBe(false);
  });
});

