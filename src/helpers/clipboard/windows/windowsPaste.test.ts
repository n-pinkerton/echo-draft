import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

const {
  SECURE_TARGET_PASTE_SCRIPT,
  getNircmdPath,
  pasteSecurelyToTarget,
  pasteWindows,
} = require("./windowsPaste");
const { retryPendingWindowsClipboardRestoration } = require("./windowsClipboardRestore");

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

  it("authorizes the process and foreground immediately before native injection", () => {
    expect(SECURE_TARGET_PASTE_SCRIPT).toContain('"before_injection"');
    expect(SECURE_TARGET_PASTE_SCRIPT).toContain("GetForegroundWindow()");
    expect(SECURE_TARGET_PASTE_SCRIPT).toContain(
      "return InjectPaste(target, expectedPid, NativeSendInput)"
    );
    expect(SECURE_TARGET_PASTE_SCRIPT).toContain('"partial_send_input_recovered"');
    expect(SECURE_TARGET_PASTE_SCRIPT).toContain('"partial_send_input_recovery_failed"');
    expect(SECURE_TARGET_PASTE_SCRIPT).toContain("public struct MOUSEINPUT");
    expect(SECURE_TARGET_PASTE_SCRIPT).toContain("public struct HARDWAREINPUT");
    expect(SECURE_TARGET_PASTE_SCRIPT).toContain('Failure("input_layout_invalid"');
    expect(SECURE_TARGET_PASTE_SCRIPT).toContain("DeadlineExpired(deadlineUtcTicks)");
    expect(SECURE_TARGET_PASTE_SCRIPT).toContain('Failure("deadline_expired"');
    expect(SECURE_TARGET_PASTE_SCRIPT).not.toContain("SendKeys");
    expect(SECURE_TARGET_PASTE_SCRIPT).not.toContain("Start-Sleep");
  });

  it.runIf(process.platform === "win32")(
    "matches the native Windows INPUT ABI before attempting keyboard injection",
    () => {
      const command = `& {\n${SECURE_TARGET_PASTE_SCRIPT}\n} 0 0 0 -ProbeInputLayout`;
      const stdout = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          command,
        ],
        { encoding: "utf8", timeout: 5_000 }
      );
      const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) || "{}");

      expect(result).toMatchObject({
        success: true,
        inputSize: process.arch === "ia32" ? 28 : 40,
        expectedInputSize: process.arch === "ia32" ? 28 : 40,
      });
    }
  );

  it.runIf(process.platform === "win32")(
    "releases every potentially held key after partial native injection",
    () => {
      const command = `& {\n${SECURE_TARGET_PASTE_SCRIPT}\n} 0 0 0 -ProbeInputRecovery`;
      const stdout = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          command,
        ],
        { encoding: "utf8", timeout: 5_000 }
      );
      const results = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) || "[]");

      expect(results).toHaveLength(4);
      expect(results[0]).toMatchObject({
        success: false,
        injected: false,
        reason: "partial_send_input_recovered",
        inputEventsSent: 1,
        recoveryEventsAttempted: 1,
        recoveryEventsSent: 1,
        recoverySucceeded: true,
      });
      expect(results[1]).toMatchObject({
        reason: "partial_send_input_recovered",
        inputEventsSent: 2,
        recoveryEventsAttempted: 2,
        recoveryEventsSent: 2,
        recoverySucceeded: true,
      });
      expect(results[2]).toMatchObject({
        reason: "partial_send_input_recovered",
        inputEventsSent: 3,
        recoveryEventsAttempted: 1,
        recoveryEventsSent: 1,
        recoverySucceeded: true,
      });
      expect(results[3]).toMatchObject({
        success: false,
        injected: false,
        reason: "partial_send_input_recovery_failed",
        inputEventsSent: 2,
        recoveryEventsAttempted: 2,
        recoveryEventsSent: 1,
        recoverySucceeded: false,
      });
    }
  );

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

  it("does not release the insertion queue until delayed clipboard restoration settles", async () => {
    const processHandle = createProcess();
    let finishRestore: (value: { success: boolean }) => void = () => {};
    const restore = new Promise<{ success: boolean }>((resolve) => {
      finishRestore = resolve;
    });
    const manager: any = {
      deps: { spawn: vi.fn(() => processHandle) },
      parsePowerShellJsonOutput: (stdout: string) => JSON.parse(stdout),
      safeLog: vi.fn(),
      scheduleClipboardRestore: vi.fn(() => restore),
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
        expectedClipboardText: "dictation",
      }
    );
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    processHandle.stdout.emit(
      "data",
      Buffer.from('{"success":true,"injected":true,"reason":"ok"}')
    );
    processHandle.emit("close", 0);
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(manager.scheduleClipboardRestore).toHaveBeenCalledWith(
      { formats: [] },
      expect.any(Number),
      undefined,
      { expectedText: "dictation" }
    );

    finishRestore({ success: true });
    await expect(pending).resolves.toMatchObject({
      success: true,
      injected: true,
      clipboardRestored: true,
    });
  });

  it("keeps a successfully inserted result distinct when clipboard restoration exhausts retries", async () => {
    const processHandle = createProcess();
    const originalSnapshot = { text: "previous clipboard", formats: [] };
    const manager: any = {
      deps: { spawn: vi.fn(() => processHandle) },
      parsePowerShellJsonOutput: (stdout: string) => JSON.parse(stdout),
      safeLog: vi.fn(),
      scheduleClipboardRestore: vi.fn(async () => ({ success: false, reason: "locked" })),
      pendingWindowsClipboardRestoration: null,
    };
    const pending = pasteSecurelyToTarget(manager, originalSnapshot, {
      insertionTarget: {
        hwnd: 42,
        pid: 7,
        processStartTimeUtcTicks: "638800000000000000",
      },
      expectedClipboardText: "dictation",
    });

    processHandle.stdout.emit(
      "data",
      Buffer.from('{"success":true,"injected":true,"reason":"ok"}')
    );
    processHandle.emit("close", 0);

    await expect(pending).resolves.toMatchObject({
      success: true,
      injected: true,
      clipboardRestored: false,
      warningCode: "WINDOWS_CLIPBOARD_RESTORE_FAILED",
    });
    expect(manager.scheduleClipboardRestore).toHaveBeenCalledTimes(3);
    expect(manager.pendingWindowsClipboardRestoration.snapshot).toBe(originalSnapshot);

    manager.scheduleClipboardRestore.mockResolvedValueOnce({ success: true });
    await expect(retryPendingWindowsClipboardRestoration(manager)).resolves.toMatchObject({
      success: true,
    });
    expect(manager.pendingWindowsClipboardRestoration).toBeNull();
  });

  it("waits for confirmed PowerShell termination before settling a paste timeout", async () => {
    vi.useFakeTimers();
    try {
      const processHandle = createProcess();
      let confirmTermination: (value: boolean) => void = () => {};
      const termination = new Promise<boolean>((resolve) => {
        confirmTermination = resolve;
      });
      const terminateProcessTreeAndWait = vi.fn(() => termination);
      const manager: any = {
        deps: {
          spawn: vi.fn(() => processHandle),
          terminateProcessTreeAndWait,
        },
        parsePowerShellJsonOutput: vi.fn(),
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
      let settled = false;
      void pending.catch(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(5_000);
      expect(settled).toBe(false);
      confirmTermination(true);

      await expect(pending).rejects.toMatchObject({ code: "WINDOWS_SECURE_PASTE_TIMEOUT" });
      expect(terminateProcessTreeAndWait).toHaveBeenCalledWith(processHandle, "SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });
});
