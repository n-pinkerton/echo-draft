import { describe, expect, it, vi } from "vitest";

const { pasteLinux } = require("./linuxPaste");

describe("linuxPaste", () => {
  it("throws a contract-style error when no paste tools are available", async () => {
    const manager = {
      deps: {
        env: {},
        clipboard: { readText: vi.fn(() => "x") },
        spawn: vi.fn(() => {
          throw new Error("spawn should not be called");
        }),
        spawnSync: vi.fn(() => {
          throw new Error("spawnSync should not be called");
        }),
        killProcess: vi.fn(),
        debugLogger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      },
      commandExists: vi.fn(() => false),
      safeLog: vi.fn(),
      scheduleClipboardRestore: vi.fn(),
    };

    await expect(pasteLinux(manager, { text: "x", formats: [] }, {})).rejects.toMatchObject({
      code: "PASTE_SIMULATION_FAILED",
    });
  });
});

