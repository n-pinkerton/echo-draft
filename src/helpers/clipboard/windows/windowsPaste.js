const { PASTE_DELAYS, RESTORE_DELAYS } = require("../constants");

const SECURE_TARGET_PASTE_TIMEOUT_MS = 5_000;
const MAX_POWERSHELL_OUTPUT_CHARS = 16_384;

const SECURE_TARGET_PASTE_SCRIPT = `
param([Int64]$TargetHwnd, [Int32]$ExpectedPid, [Int64]$ExpectedStartTicks)
Add-Type @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public static class EchoDraftSecureTargetPaste {
  const uint INPUT_KEYBOARD = 1;
  const uint KEYEVENTF_KEYUP = 0x0002;
  const ushort VK_CONTROL = 0x11;
  const ushort VK_V = 0x56;

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public InputUnion data;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion {
    [FieldOffset(0)] public KEYBDINPUT keyboard;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort virtualKey;
    public ushort scanCode;
    public uint flags;
    public uint time;
    public UIntPtr extraInfo;
  }

  public sealed class PasteResult {
    public bool success { get; set; }
    public bool injected { get; set; }
    public string reason { get; set; }
    public string phase { get; set; }
    public long activeHwnd { get; set; }
    public int actualPid { get; set; }
    public int nativeError { get; set; }
  }

  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)]
  static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", SetLastError=true)]
  static extern uint SendInput(uint count, INPUT[] inputs, int size);

  static PasteResult Failure(string reason, string phase, IntPtr active, int actualPid = 0) {
    return new PasteResult {
      success = false,
      injected = false,
      reason = reason,
      phase = phase,
      activeHwnd = active.ToInt64(),
      actualPid = actualPid,
      nativeError = Marshal.GetLastWin32Error()
    };
  }

  static PasteResult ValidateIdentity(
    IntPtr target,
    int expectedPid,
    long expectedStartTicks,
    string phase
  ) {
    if (!IsWindow(target)) return Failure("window_not_found", phase, GetForegroundWindow());
    uint actualPid = 0;
    GetWindowThreadProcessId(target, out actualPid);
    if ((int)actualPid != expectedPid) {
      return Failure("target_process_changed", phase, GetForegroundWindow(), (int)actualPid);
    }
    try {
      using (Process process = Process.GetProcessById((int)actualPid)) {
        long actualStartTicks = process.StartTime.ToUniversalTime().Ticks;
        if (actualStartTicks != expectedStartTicks) {
          return Failure("target_process_changed", phase, GetForegroundWindow(), (int)actualPid);
        }
      }
    } catch {
      return Failure("target_process_unavailable", phase, GetForegroundWindow(), (int)actualPid);
    }
    return null;
  }

  static INPUT Key(ushort virtualKey, uint flags) {
    return new INPUT {
      type = INPUT_KEYBOARD,
      data = new InputUnion {
        keyboard = new KEYBDINPUT {
          virtualKey = virtualKey,
          scanCode = 0,
          flags = flags,
          time = 0,
          extraInfo = UIntPtr.Zero
        }
      }
    };
  }

  public static PasteResult Execute(long targetHwnd, int expectedPid, long expectedStartTicks) {
    IntPtr target = new IntPtr(targetHwnd);
    PasteResult identityFailure = ValidateIdentity(
      target,
      expectedPid,
      expectedStartTicks,
      "before_activation"
    );
    if (identityFailure != null) return identityFailure;

    INPUT[] inputs = new INPUT[] {
      Key(VK_CONTROL, 0),
      Key(VK_V, 0),
      Key(VK_V, KEYEVENTF_KEYUP),
      Key(VK_CONTROL, KEYEVENTF_KEYUP)
    };

    SetForegroundWindow(target);
    for (int attempt = 0; attempt < 20 && GetForegroundWindow() != target; attempt++) {
      Thread.Sleep(20);
    }

    identityFailure = ValidateIdentity(
      target,
      expectedPid,
      expectedStartTicks,
      "before_injection"
    );
    if (identityFailure != null) return identityFailure;

    // This is the final foreground check. SendInput follows immediately in this
    // same native operation; no timer, process hop, or renderer work is allowed
    // between target authorization and injection.
    IntPtr active = GetForegroundWindow();
    if (active != target) {
      return Failure("foreground_changed_before_injection", "before_injection", active, expectedPid);
    }
    uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (sent != inputs.Length) {
      return Failure("send_input_failed", "injection", GetForegroundWindow(), expectedPid);
    }

    return new PasteResult {
      success = true,
      injected = true,
      reason = "",
      phase = "complete",
      activeHwnd = targetHwnd,
      actualPid = expectedPid,
      nativeError = 0
    };
  }
}
"@ | Out-Null

[EchoDraftSecureTargetPaste]::Execute(
  $TargetHwnd,
  $ExpectedPid,
  $ExpectedStartTicks
) | ConvertTo-Json -Compress
`.trim();

function getNircmdPath(manager) {
  if (manager.nircmdChecked) {
    return manager.nircmdPath;
  }

  manager.nircmdChecked = true;

  if (manager.deps.platform !== "win32") {
    return null;
  }

  const { path, fs, resourcesPath, helpersDir, cwd } = manager.deps;

  const possiblePaths = [
    typeof resourcesPath === "string" && resourcesPath
      ? path.join(resourcesPath, "bin", "nircmd.exe")
      : null,
    helpersDir ? path.join(helpersDir, "..", "..", "resources", "bin", "nircmd.exe") : null,
    cwd ? path.join(cwd, "resources", "bin", "nircmd.exe") : null,
  ].filter(Boolean);

  for (const candidate of possiblePaths) {
    try {
      if (fs.existsSync(candidate)) {
        manager.safeLog(`✅ Found nircmd.exe at: ${candidate}`);
        manager.nircmdPath = candidate;
        return candidate;
      }
    } catch {
      // Continue checking other paths
    }
  }

  manager.safeLog("⚠️ nircmd.exe not found, will use PowerShell fallback");
  return null;
}

function getNircmdStatus(manager) {
  if (manager.deps.platform !== "win32") {
    return { available: false, reason: "Not Windows" };
  }
  const nircmdPath = getNircmdPath(manager);
  return {
    available: Boolean(nircmdPath),
    path: nircmdPath,
  };
}

async function pasteWindows(manager, originalClipboardSnapshot, options = {}) {
  if (!options?.insertionTarget) {
    throw new Error(
      "Automatic insertion requires an authenticated target. Text is copied to the clipboard; paste it manually with Ctrl+V."
    );
  }
  return await pasteSecurelyToTarget(manager, originalClipboardSnapshot, options);
}

async function pasteSecurelyToTarget(manager, originalClipboardSnapshot, options = {}) {
  const target = options?.insertionTarget;
  const hwnd = Number(target?.hwnd);
  const expectedPid = Number(target?.pid);
  const expectedStartTicks = String(target?.processStartTimeUtcTicks || "");
  if (
    !Number.isSafeInteger(hwnd) ||
    hwnd <= 0 ||
    !Number.isSafeInteger(expectedPid) ||
    expectedPid <= 0 ||
    !/^\d{1,20}$/.test(expectedStartTicks) ||
    expectedStartTicks === "0"
  ) {
    throw new Error(
      "The original app can no longer be authenticated. Text is copied to the clipboard; paste it manually with Ctrl+V."
    );
  }

  const { spawn, killProcess } = manager.deps;
  const wrappedScript = `& {\n${SECURE_TARGET_PASTE_SCRIPT}\n}`;
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    wrappedScript,
    String(hwnd),
    String(expectedPid),
    expectedStartTicks,
  ];

  return await new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timeoutId = null;
    const processHandle = spawn("powershell.exe", args);
    const appendBounded = (current, chunk) =>
      `${current}${chunk?.toString?.() || ""}`.slice(-MAX_POWERSHELL_OUTPUT_CHARS);
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      callback();
    };

    processHandle.stdout?.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    processHandle.stderr?.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    processHandle.on("error", (error) =>
      finish(() =>
        reject(
          new Error(
            `Windows secure paste failed: ${error.message}. Text is copied to the clipboard; paste it manually with Ctrl+V.`
          )
        )
      )
    );
    processHandle.on("close", (code) =>
      finish(() => {
        const parsed = manager.parsePowerShellJsonOutput(stdout);
        if (code !== 0 || parsed?.success !== true || parsed?.injected !== true) {
          manager.safeLog("Windows secure target paste rejected", {
            code,
            reason: parsed?.reason || "secure_paste_failed",
            phase: parsed?.phase || "unknown",
            hasStderr: Boolean(stderr.trim()),
          });
          reject(
            new Error(
              "The original app lost focus or could not be authenticated. Text is copied to the clipboard; paste it manually with Ctrl+V."
            )
          );
          return;
        }

        manager.scheduleClipboardRestore(
          originalClipboardSnapshot,
          RESTORE_DELAYS.win32_pwsh,
          options.webContents
        );
        resolve();
      })
    );

    timeoutId = setTimeout(() => {
      try {
        killProcess(processHandle, "SIGKILL");
      } catch {}
      finish(() =>
        reject(
          new Error(
            "Windows secure paste timed out. Text is copied to the clipboard; paste it manually with Ctrl+V."
          )
        )
      );
    }, SECURE_TARGET_PASTE_TIMEOUT_MS);
    timeoutId.unref?.();
  });
}

async function pasteWithNircmd(manager, nircmdPath, originalClipboardSnapshot, options = {}) {
  const { spawn, killProcess } = manager.deps;

  return new Promise((resolve, reject) => {
    const pasteDelay = PASTE_DELAYS.win32_nircmd;
    const restoreDelay = RESTORE_DELAYS.win32_nircmd;
    const webContents = options.webContents;

    setTimeout(() => {
      let hasTimedOut = false;
      const startTime = Date.now();

      manager.safeLog(`⚡ nircmd paste starting (delay: ${pasteDelay}ms)`);

      const pasteProcess = spawn(nircmdPath, ["sendkeypress", "ctrl+v"]);

      let errorOutput = "";

      pasteProcess.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      pasteProcess.on("close", (code) => {
        if (hasTimedOut) return;
        clearTimeout(timeoutId);

        const elapsed = Date.now() - startTime;

        if (code === 0) {
          manager.safeLog(`✅ nircmd paste success`, {
            elapsedMs: elapsed,
            restoreDelayMs: restoreDelay,
          });
          manager.scheduleClipboardRestore(originalClipboardSnapshot, restoreDelay, webContents);
          resolve();
        } else {
          manager.safeLog(`❌ nircmd paste failed`, {
            elapsedMs: elapsed,
            stderr: errorOutput,
            exitCode: code,
          });
          reject(
            new Error(
              `Windows paste failed with nircmd (code ${code}). Text is copied to clipboard - please paste manually with Ctrl+V.`
            )
          );
        }
      });

      pasteProcess.on("error", (error) => {
        if (hasTimedOut) return;
        clearTimeout(timeoutId);
        const elapsed = Date.now() - startTime;
        manager.safeLog(`❌ nircmd paste error`, {
          elapsedMs: elapsed,
          error: error.message,
        });
        reject(
          new Error(
            `Windows nircmd paste failed: ${error.message}. Text is copied to clipboard - please paste manually with Ctrl+V.`
          )
        );
      });

      const timeoutId = setTimeout(() => {
        hasTimedOut = true;
        const elapsed = Date.now() - startTime;
        manager.safeLog(`⏱️ nircmd timeout`, { elapsedMs: elapsed });
        killProcess(pasteProcess, "SIGKILL");
        pasteProcess.removeAllListeners();
        reject(
          new Error(
            "Windows nircmd paste timed out. Text is copied to clipboard - please paste manually with Ctrl+V."
          )
        );
      }, 2000);
    }, pasteDelay);
  });
}

async function pasteWithPowerShell(manager, originalClipboardSnapshot, options = {}) {
  const { spawn, killProcess } = manager.deps;

  return new Promise((resolve, reject) => {
    const pasteDelay = PASTE_DELAYS.win32_pwsh;
    const restoreDelay = RESTORE_DELAYS.win32_pwsh;
    const webContents = options.webContents;

    setTimeout(() => {
      let hasTimedOut = false;
      const startTime = Date.now();

      manager.safeLog(`🪟 PowerShell paste starting (delay: ${pasteDelay}ms)`);

      const pasteProcess = spawn("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');[System.Windows.Forms.SendKeys]::SendWait('^v')",
      ]);

      let errorOutput = "";

      pasteProcess.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      pasteProcess.on("close", (code) => {
        if (hasTimedOut) return;
        clearTimeout(timeoutId);

        const elapsed = Date.now() - startTime;

        if (code === 0) {
          manager.safeLog(`✅ PowerShell paste success`, {
            elapsedMs: elapsed,
            restoreDelayMs: restoreDelay,
          });
          manager.scheduleClipboardRestore(originalClipboardSnapshot, restoreDelay, webContents);
          resolve();
        } else {
          manager.safeLog(`❌ PowerShell paste failed`, {
            code,
            elapsedMs: elapsed,
            stderr: errorOutput,
          });
          reject(
            new Error(
              `Windows paste failed with code ${code}. Text is copied to clipboard - please paste manually with Ctrl+V.`
            )
          );
        }
      });

      pasteProcess.on("error", (error) => {
        if (hasTimedOut) return;
        clearTimeout(timeoutId);
        const elapsed = Date.now() - startTime;
        manager.safeLog(`❌ PowerShell paste error`, {
          elapsedMs: elapsed,
          error: error.message,
        });
        reject(
          new Error(
            `Windows paste failed: ${error.message}. Text is copied to clipboard - please paste manually with Ctrl+V.`
          )
        );
      });

      const timeoutId = setTimeout(() => {
        hasTimedOut = true;
        const elapsed = Date.now() - startTime;
        manager.safeLog(`⏱️ PowerShell paste timeout`, { elapsedMs: elapsed });
        killProcess(pasteProcess, "SIGKILL");
        pasteProcess.removeAllListeners();
        reject(
          new Error(
            "Paste operation timed out. Text is copied to clipboard - please paste manually with Ctrl+V."
          )
        );
      }, 5000);
    }, pasteDelay);
  });
}

module.exports = {
  SECURE_TARGET_PASTE_SCRIPT,
  SECURE_TARGET_PASTE_TIMEOUT_MS,
  getNircmdPath,
  getNircmdStatus,
  pasteSecurelyToTarget,
  pasteWindows,
  pasteWithNircmd,
  pasteWithPowerShell,
};
