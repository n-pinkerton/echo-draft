import { describe, expect, it } from "vitest";

const { getParakeetModelConfig, getValidParakeetModelNames } = require("./modelRegistry");

describe("parakeet modelRegistry", () => {
  it("returns a non-empty model list", () => {
    const names = getValidParakeetModelNames();
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBeGreaterThan(0);
  });

  it("returns config for a known model name", () => {
    const [first] = getValidParakeetModelNames();
    const config = getParakeetModelConfig(first);
    expect(config).toEqual(
      expect.objectContaining({
        url: expect.any(String),
        size: expect.any(Number),
        extractDir: expect.any(String),
      })
    );
  });
});

