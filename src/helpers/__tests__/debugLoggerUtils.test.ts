import { describe, expect, it } from "vitest";

const { normalizeLevel, readArgLogLevel, resolveLogLevel, LOG_LEVELS } = require("../debugLogger/logLevelUtils");
const { redactEnvSnapshot } = require("../debugLogger/envSnapshot");

describe("debugLogger utilities", () => {
  it("normalizeLevel accepts known levels and lowercases", () => {
    expect(normalizeLevel("DEBUG")).toBe("debug");
    expect(normalizeLevel("trace")).toBe("trace");
    expect(normalizeLevel("nope")).toBe(null);
    expect(LOG_LEVELS.debug).toBeGreaterThan(0);
  });

  it("readArgLogLevel reads --log-level and --log-level= forms", () => {
    expect(readArgLogLevel(["node", "app", "--log-level", "warn"])).toBe("warn");
    expect(readArgLogLevel(["node", "app", "--log-level=error"])).toBe("error");
    expect(readArgLogLevel(["node", "app"])).toBe(null);
  });

  it("resolveLogLevel prefers argv over env and defaults to info", () => {
    expect(resolveLogLevel({ argv: ["app", "--log-level", "debug"], env: { LOG_LEVEL: "error" } })).toBe(
      "debug"
    );
    expect(resolveLogLevel({ argv: ["app"], env: { OPENWHISPR_LOG_LEVEL: "trace" } })).toBe("trace");
    expect(resolveLogLevel({ argv: ["app"], env: {} })).toBe("info");
  });

  it("redactEnvSnapshot redacts secret values but includes safe fields", () => {
    const snapshot = redactEnvSnapshot({
      ACTIVATION_MODE: "tap",
      DICTATION_KEY: "F9",
      OPENAI_API_KEY: "sk-test",
    });

    expect(snapshot.ACTIVATION_MODE).toBe("tap");
    expect(snapshot.DICTATION_KEY).toBe("F9");
    expect(snapshot.OPENAI_API_KEY).toBe("[REDACTED]");
  });
});

