import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const {
  SECURE_TARGET_PASTE_SCRIPT,
  getNircmdPath,
  pasteSecurelyToTarget,
  pasteWindows,
} = require("./windowsPaste");

const createProcess = () => {
  const processHandle: any = new EventEmitter();
  processHandle.stdout = new EventEmitter();
  processHandle.stderr = new EventEmitter();
  return processHandle;
};

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
      existsSync: vi.fn(
        (candidate: string) => candidate.includes("resources") && candidate.includes("nircmd.exe")
      ),
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

  it("authorizes the process and foreground immediately before one SendInput call", () => {
    expect(SECURE_TARGET_PASTE_SCRIPT).toContain('"before_injection"');
    expect(SECURE_TARGET_PASTE_SCRIPT).toContain("GetForegroundWindow()");
    expect(SECURE_TARGET_PASTE_SCRIPT).toContain("SendInput((uint)inputs.Length");
    expect(SECURE_TARGET_PASTE_SCRIPT).not.toContain("SendKeys");
    expect(SECURE_TARGET_PASTE_SCRIPT).not.toContain("Start-Sleep");
  });

  it("fails closed when focus changes between activation and injection and never tries a fallback", async () => {
    const processHandle = createProcess();
    const spawn = vi.fn(() => processHandle);
    const manager: any = {
      deps: { spawn, killProcess: vi.fn() },
      parsePowerShellJsonOutput: (stdout: string) => JSON.parse(stdout),
      safeLog: vi.fn(),
      scheduleClipboardRestore: vi.fn(),
    };
    const pending = pasteSecurelyToTarget(
      manager,
      { formats: [] },
      {
        insertionTarget: {
          hwnd: 42,
          pid: 7,
          processStartTimeUtcTicks: "638800000000000000",
        },
      }
    );
    processHandle.stdout.emit(
      "data",
      Buffer.from(
        '{"success":false,"injected":false,"reason":"foreground_changed_before_injection","phase":"before_injection"}'
      )
    );
    processHandle.emit("close", 0);

    await expect(pending).rejects.toThrow(/lost focus|authenticated/i);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(manager.scheduleClipboardRestore).not.toHaveBeenCalled();
  });

  it("requires an authenticated target instead of using a global paste fallback", async () => {
    const manager: any = {};
    await expect(pasteWindows(manager, {}, {})).rejects.toThrow(/authenticated target/i);
  });
});
