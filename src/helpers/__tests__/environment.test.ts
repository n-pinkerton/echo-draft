// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const EnvironmentManager = require("../environment");
const { PERSISTED_KEYS, validatePersistedValue, writePrivateFileAtomic } = EnvironmentManager;

const originalValues = new Map<string, string | undefined>(
  PERSISTED_KEYS.map((key: string) => [key, process.env[key]])
);
const originalResourcesPath = (process as any).resourcesPath;
const originalApiUrl = process.env.OPENWHISPR_API_URL;
let root = "";
const testApp = { getPath: () => root };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-environment-test-"));
  (process as any).resourcesPath = root;
  for (const key of PERSISTED_KEYS) delete process.env[key];
  delete process.env.OPENWHISPR_API_URL;
});

afterEach(() => {
  for (const [key, value] of originalValues) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (originalApiUrl === undefined) delete process.env.OPENWHISPR_API_URL;
  else process.env.OPENWHISPR_API_URL = originalApiUrl;
  (process as any).resourcesPath = originalResourcesPath;
  if (root && fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
});

describe("EnvironmentManager persisted boundary", () => {
  it("rejects unsupported keys and dotenv line injection", () => {
    expect(() => validatePersistedValue("OPENWHISPR_API_URL", "https://evil.test")).toThrow(
      "Unsupported"
    );
    expect(() =>
      validatePersistedValue("OPENAI_API_KEY", "safe\nOPENWHISPR_LOG_LEVEL=debug")
    ).toThrow("unsupported characters");
  });

  it("loads only allowlisted user settings and requires separate debug consent", () => {
    fs.writeFileSync(
      path.join(root, ".env"),
      [
        "OPENAI_API_KEY=selected-key",
        "OPENWHISPR_LOG_LEVEL=debug",
        "OPENWHISPR_API_URL=https://evil.test",
      ].join("\n")
    );

    const manager = new EnvironmentManager({ appImpl: testApp });
    expect(process.env.OPENAI_API_KEY).toBe("selected-key");
    expect(process.env.OPENWHISPR_API_URL).toBeUndefined();
    expect(manager.enforceDebugConsent()).toMatchObject({ success: true });
    expect(process.env.OPENWHISPR_LOG_LEVEL).toBe("info");
  });

  it("rewrites a private managed file without retaining unknown entries", () => {
    const manager = new EnvironmentManager({ appImpl: testApp });
    process.env.OPENWHISPR_API_URL = "https://evil.test";
    manager.saveOpenAIKey("safe-key");
    expect(manager.saveAllKeysToEnvFile()).toMatchObject({ success: true });

    const contents = fs.readFileSync(path.join(root, ".env"), "utf8");
    expect(contents).toContain('OPENAI_API_KEY="safe-key"');
    expect(contents).not.toContain("OPENWHISPR_API_URL");
    expect(contents).not.toContain("evil.test");
  });

  it("rolls an API key back in memory when its durable write fails", () => {
    const manager = new EnvironmentManager({ appImpl: testApp });
    expect(manager.saveOpenAIKey("existing-key")).toMatchObject({ success: true });
    vi.spyOn(manager, "_persistAllKeysToEnvFile").mockReturnValue({
      success: false,
      path: path.join(root, ".env"),
      error: "disk full",
    });

    expect(manager.saveOpenAIKey("replacement-key")).toMatchObject({ success: false });
    expect(process.env.OPENAI_API_KEY).toBe("existing-key");
    expect(fs.readFileSync(path.join(root, ".env"), "utf8")).toContain(
      'OPENAI_API_KEY="existing-key"'
    );
  });

  it("publishes private files atomically and records revocable debug consent", () => {
    const target = path.join(root, "private.txt");
    writePrivateFileAtomic(target, "first\n");
    writePrivateFileAtomic(target, "second\n");
    expect(fs.readFileSync(target, "utf8")).toBe("second\n");

    const manager = new EnvironmentManager({ appImpl: testApp });
    expect(manager.hasDebugConsent()).toBe(false);
    expect(manager.setDebugConsent(true)).toMatchObject({ success: true });
    expect(manager.hasDebugConsent()).toBe(true);
    expect(manager.setDebugConsent(false)).toMatchObject({ success: true });
    expect(manager.hasDebugConsent()).toBe(false);
  });
});
