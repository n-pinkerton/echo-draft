import { describe, expect, it, vi } from "vitest";

const ClipboardManager = require("./clipboard");

describe("ClipboardManager", () => {
  it("reads Windows nircmd preference flags from env", () => {
    const manager = new ClipboardManager({
      platform: "win32",
      env: { OPENWHISPR_WINDOWS_USE_NIRCMD: "true" },
      clipboard: { readText: vi.fn(), writeText: vi.fn() },
      nativeImage: { createFromBuffer: vi.fn() },
      spawn: vi.fn(),
      spawnSync: vi.fn(() => ({ status: 1 })),
      killProcess: vi.fn(),
      fs: { existsSync: vi.fn() },
      path: require("path"),
      debugLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      resourcesPath: "/res",
      cwd: "/cwd",
      helpersDir: "/helpers",
      now: () => 0,
    });

    expect(manager.shouldPreferNircmd()).toBe(true);
  });

  it("caches commandExists checks within TTL", () => {
    const spawnSync = vi.fn(() => ({ status: 0 }));

    const manager = new ClipboardManager({
      platform: "linux",
      env: {},
      clipboard: { readText: vi.fn(), writeText: vi.fn() },
      nativeImage: { createFromBuffer: vi.fn() },
      spawn: vi.fn(),
      spawnSync,
      killProcess: vi.fn(),
      fs: { existsSync: vi.fn() },
      path: require("path"),
      debugLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      resourcesPath: "/res",
      cwd: "/cwd",
      helpersDir: "/helpers",
      now: () => 0,
    });

    expect(manager.commandExists("echo")).toBe(true);
    expect(manager.commandExists("echo")).toBe(true);
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });
});

