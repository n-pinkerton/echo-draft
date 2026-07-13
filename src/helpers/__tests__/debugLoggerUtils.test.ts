import { describe, expect, it } from "vitest";

const {
  normalizeLevel,
  readArgLogLevel,
  resolveLogLevel,
  LOG_LEVELS,
} = require("../debugLogger/logLevelUtils");
const { redactEnvSnapshot } = require("../debugLogger/envSnapshot");
const {
  REDACTED,
  isSensitiveKey,
  redactSensitiveData,
  redactSensitiveString,
} = require("../debugLogger/redaction");

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
    expect(
      resolveLogLevel({ argv: ["app", "--log-level", "debug"], env: { LOG_LEVEL: "error" } })
    ).toBe("debug");
    expect(resolveLogLevel({ argv: ["app"], env: { OPENWHISPR_LOG_LEVEL: "trace" } })).toBe(
      "trace"
    );
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

  it("redacts credential fields while preserving non-secret presence and usage fields", () => {
    const output = redactSensitiveData({
      apiKey: "custom-provider-secret",
      keyPreview: "secret-prefix",
      authorization: "Bearer private-value",
      nested: { refresh_token: "refresh-secret", tokenCount: 42 },
      hasApiKey: true,
    });

    expect(output).toEqual({
      apiKey: REDACTED,
      keyPreview: REDACTED,
      authorization: REDACTED,
      nested: { refresh_token: REDACTED, tokenCount: 42 },
      hasApiKey: true,
    });
    expect(isSensitiveKey("x-api-key")).toBe(true);
    expect(isSensitiveKey("hasApiKey")).toBe(false);
  });

  it("redacts common credential formats embedded in messages", () => {
    const result = redactSensitiveString(
      "Authorization: Bearer private-token OPENAI_API_KEY=private-key " +
        "https://example.test?api_key=private-query"
    );

    expect(result).not.toContain("private-token");
    expect(result).not.toContain("private-key");
    expect(result).not.toContain("private-query");
    expect(result).toContain(REDACTED);
  });

  it("handles circular metadata and avoids serializing audio buffers", () => {
    const circular: Record<string, unknown> = { audio: Buffer.from([1, 2, 3]) };
    circular.self = circular;

    expect(redactSensitiveData(circular)).toEqual({
      audio: "[Buffer 3 bytes]",
      self: "[Circular]",
    });
  });
});
