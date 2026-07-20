import { describe, expect, it } from "vitest";
import {
  E2E_GLOBAL,
  LEGACY_E2E_GLOBAL,
  LEGACY_RENDERER_LOG_LEVEL_GLOBAL,
  RENDERER_LOG_LEVEL_GLOBAL,
  clearRendererLogLevel,
  getRendererLogLevel,
  installEchoDraftE2E,
  setRendererLogLevel,
} from "./branding.js";

const expectedLegacyLogLevelKey =
  "\x5f\x5f\x6f\x70\x65\x6e\x77\x68\x69\x73\x70\x72\x4c\x6f\x67\x4c\x65\x76\x65\x6c";
const expectedLegacyE2EKey = "\x5f\x5f\x6f\x70\x65\x6e\x77\x68\x69\x73\x70\x72\x45\x32\x45";

describe("renderer branding compatibility keys", () => {
  it("preserves the exact legacy global key values", () => {
    expect(LEGACY_RENDERER_LOG_LEVEL_GLOBAL).toBe(expectedLegacyLogLevelKey);
    expect(LEGACY_E2E_GLOBAL).toBe(expectedLegacyE2EKey);
  });

  it("reads, writes, and clears the legacy renderer log-level key", () => {
    const target = window;
    const properties = target as unknown as Record<string, unknown>;

    setRendererLogLevel("debug", target);
    expect(properties[LEGACY_RENDERER_LOG_LEVEL_GLOBAL]).toBe("debug");

    delete properties[RENDERER_LOG_LEVEL_GLOBAL];
    expect(getRendererLogLevel(target)).toBe("debug");

    clearRendererLogLevel(target);
    expect(LEGACY_RENDERER_LOG_LEVEL_GLOBAL in properties).toBe(false);
  });

  it("installs and removes helpers under the legacy E2E key", () => {
    const target = window;
    const properties = target as unknown as Record<string, unknown>;
    const helpers = { ready: true };

    const cleanup = installEchoDraftE2E(helpers, target);
    expect(properties[E2E_GLOBAL]).toBe(helpers);
    expect(properties[LEGACY_E2E_GLOBAL]).toBe(helpers);

    cleanup();
    expect(E2E_GLOBAL in properties).toBe(false);
    expect(LEGACY_E2E_GLOBAL in properties).toBe(false);
  });
});
