import { describe, expect, it, vi } from "vitest";

const { resolveFastPasteBinary } = require("./fastPasteBinary");

describe("fastPasteBinary", () => {
  it("returns null when not on macOS", () => {
    const manager = {
      deps: { platform: "win32" },
      fastPasteChecked: false,
      fastPastePath: null,
    };
    expect(resolveFastPasteBinary(manager)).toBeNull();
  });

  it("resolves a candidate and caches it", () => {
    const fs = {
      constants: { X_OK: 1 },
      statSync: vi.fn((_candidate: string) => ({ isFile: () => true })),
      accessSync: vi.fn(),
    };
    const path = require("path");

    const manager = {
      deps: {
        platform: "darwin",
        fs,
        path,
        resourcesPath: "/packed/resources",
        helpersDir: "/repo/src/helpers",
      },
      fastPasteChecked: false,
      fastPastePath: null,
    };

    const first = resolveFastPasteBinary(manager);
    const second = resolveFastPasteBinary(manager);

    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(fs.statSync).toHaveBeenCalled();
  });
});

