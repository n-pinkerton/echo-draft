import path from "node:path";
import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runChangedLint } = require("./runChangedLint.cjs");

describe("runChangedLint", () => {
  it("never applies the React Hooks override to CJS or MJS files", () => {
    const root = path.resolve("quality-test-root");
    const calls: Array<{ args: string[]; cwd: string }> = [];
    runChangedLint({
      root,
      getChangedFiles: () => ({
        base: "base",
        files: [
          "src/tool.cjs",
          "src/module.mjs",
          "src/-leading.mjs",
          "src/component.tsx",
          "src/plain.js",
          "root.cjs",
          "-leading.js",
        ],
      }),
      execFile: (_executable: string, args: string[], options: { cwd: string }) => {
        calls.push({ args, cwd: options.cwd });
      },
    });

    const srcCoreCall = calls.find(({ args }) => args.includes("tool.cjs"));
    expect(srcCoreCall?.cwd).toBe(path.join(root, "src"));
    expect(srcCoreCall?.args).toContain("module.mjs");
    expect(srcCoreCall?.args).toContain("-leading.mjs");
    expect(srcCoreCall?.args).not.toContain("react-hooks/rules-of-hooks:error");
    const srcCoreSeparator = srcCoreCall?.args.indexOf("--") ?? -1;
    expect(srcCoreSeparator).toBeGreaterThan(0);
    expect(srcCoreCall?.args.indexOf("-leading.mjs")).toBeGreaterThan(srcCoreSeparator);
    expect(srcCoreCall?.args.lastIndexOf("--rule")).toBeLessThan(srcCoreSeparator);

    const srcReactCall = calls.find(({ args }) => args.includes("component.tsx"));
    expect(srcReactCall?.args).toContain("plain.js");
    expect(srcReactCall?.args).toContain("react-hooks/rules-of-hooks:error");
    const srcReactSeparator = srcReactCall?.args.indexOf("--") ?? -1;
    expect(srcReactCall?.args.indexOf("react-hooks/rules-of-hooks:error")).toBeLessThan(
      srcReactSeparator
    );
    expect(srcReactCall?.args.indexOf("component.tsx")).toBeGreaterThan(srcReactSeparator);

    const rootCall = calls.find(({ args }) => args.includes("root.cjs"));
    expect(rootCall?.args).toContain("-leading.js");
    expect(rootCall?.args).not.toContain("react-hooks/rules-of-hooks:error");
    const rootSeparator = rootCall?.args.indexOf("--") ?? -1;
    expect(rootSeparator).toBeGreaterThan(0);
    expect(rootCall?.args.indexOf("-leading.js")).toBeGreaterThan(rootSeparator);
    expect(rootCall?.args.lastIndexOf("--rule")).toBeLessThan(rootSeparator);
  });
});
