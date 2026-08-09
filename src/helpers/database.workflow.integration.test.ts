import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const electronPath = require("electron") as string;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const smokeScript = path.join(repoRoot, "scripts", "smoke", "workflowDatabase.cjs");

describe("workflow database integration", () => {
  it("preserves sources and supports alternatives, rules, styles, flags, and Archived paging", () => {
    const result = spawnSync(electronPath, [smokeScript], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      timeout: 30_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain("workflow database integration: passed");
  }, 30_000);
});
