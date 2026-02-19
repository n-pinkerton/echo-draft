import { describe, expect, it, vi } from "vitest";

const { getNircmdPath } = require("./windowsPaste");

describe("windowsPaste", () => {
  it("getNircmdPath returns null when not on Windows", () => {
    const manager = {
      deps: { platform: "darwin" },
      nircmdChecked: false,
      nircmdPath: null,
      safeLog: vi.fn(),
    };
    expect(getNircmdPath(manager)).toBeNull();
  });

  it("getNircmdPath picks the first existing candidate and caches it", () => {
    const fs = {
      existsSync: vi.fn((candidate: string) => candidate.includes("resources") && candidate.includes("nircmd.exe")),
    };
    const path = require("path");

    const manager = {
      deps: {
        platform: "win32",
        fs,
        path,
        resourcesPath: "/packed/resources",
        helpersDir: "/repo/src/helpers",
        cwd: "/repo",
      },
      safeLog: vi.fn(),
      nircmdChecked: false,
      nircmdPath: null,
    };

    const first = getNircmdPath(manager);
    const second = getNircmdPath(manager);

    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(fs.existsSync).toHaveBeenCalled();
  });
});

