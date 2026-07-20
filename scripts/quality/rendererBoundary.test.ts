import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Linter } = require("eslint");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rule = require("../../eslint/policy-rules.cjs").plugins.rules["renderer-boundary"];

const verify = (code: string) => {
  const linter = new Linter({ configType: "eslintrc" });
  linter.defineRule("renderer-boundary", rule);
  return linter.verify(code, {
    parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    rules: { "renderer-boundary": "error" },
  });
};

describe("renderer boundary policy", () => {
  it.each([
    'import modelManager from "../helpers/ModelManager";',
    'const module = import("node:fs");',
    'export { readFile } from "fs";',
    'export * from "../helpers/modelManagerBridge";',
    'const modelManager = require("../helpers/modelManagerBridge");',
    'import modelManager from "@/helpers/ModelManager";',
    'const module = import("@/config/InferenceConfig");',
  ])("rejects %s", (code) => {
    expect(verify(code)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: "Renderer code must use the preload IPC boundary." }),
    ]));
  });

  it("allows preload-backed local modules", () => {
    expect(verify('import logger from "../utils/logger";')).toEqual([]);
  });
});
