import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { evaluateFilePolicy, logicalLineCount } = require("./filePolicy.js");

describe("logical file policy", () => {
  it.each([
    ["blank and line comments", "\n// note\nconst value = 1;\n", 1],
    ["inline block comments", "const /* ignore */ value = 1;\n/* block\ncomment */\nvalue++;", 2],
    ["comment markers in strings", "const value = \"/* not a comment */\";\n", 1],
    ["opposite quote in strings", "const value = \"apostrophe's text\";\n", 1],
  ])("counts %s", (_name, source, expected) => {
    expect(logicalLineCount(source)).toBe(expected);
  });

  it.each([
    ["new production warning", { filePath: "src/new.js", logicalLines: 351, isNew: true }, [{ level: "warn", code: "new-production-file-size" }]],
    ["new production failure", { filePath: "src/new.js", logicalLines: 501, isNew: true }, [{ level: "error", code: "new-production-file-size" }]],
    ["grandfathered growth warning", { filePath: "src/legacy.js", logicalLines: 601, previousLogicalLines: 600, isNew: false }, [{ level: "warn", code: "grandfathered-file-growth" }]],
    ["exempt file", { filePath: "src/new.js", logicalLines: 1000, isNew: true, exempt: true }, []],
    ["test threshold is warning-only", { filePath: "src/large.test.ts", logicalLines: 1201, isNew: true }, [{ level: "warn", code: "test-file-size" }]],
    ["at warning boundary", { filePath: "src/new.js", logicalLines: 350, isNew: true }, []],
  ])("applies %s", (_name, input, expectedFindings) => {
    expect(evaluateFilePolicy(input)).toEqual(expectedFindings);
  });

  it("applies policy to CommonJS and module-script files", () => {
    expect(evaluateFilePolicy({ filePath: "scripts/new.cjs", logicalLines: 501, isNew: true })).toEqual([
      { level: "error", code: "new-production-file-size" },
    ]);
    expect(evaluateFilePolicy({ filePath: "scripts/new.mjs", logicalLines: 351, isNew: true })).toEqual([
      { level: "warn", code: "new-production-file-size" },
    ]);
  });
});
