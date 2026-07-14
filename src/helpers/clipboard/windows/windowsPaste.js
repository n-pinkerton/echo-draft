const { PASTE_DELAYS, RESTORE_DELAYS } = require("../constants");
const { restoreClipboardAfterPaste } = require("./windowsClipboardRestore");

const SECURE_TARGET_PASTE_TIMEOUT_MS = 5_000;
const NATIVE_DEADLINE_SAFETY_MS = 250;
const DOTNET_UNIX_EPOCH_TICKS = 621_355_968_000_000_000n;
const MAX_POWERSHELL_OUTPUT_CHARS = 16_384;

const createSecurePasteError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const normalizeSecurePasteReason = (reason) => {
  const normalized = String(reason || "secure_paste_failed")
    .trim()
    .toLowerCase();
  return /^[a-z0-9_]{1,80}$/.test(normalized) ? normalized : "secure_paste_failed";
};

const SECURE_TARGET_PASTE_SCRIPT = `
param(
  [Int64]$TargetHwnd,
  [Int32]$ExpectedPid,
  [Int64]$ExpectedStartTicks,
  [Int64]$DeadlineUtcTicks = 0,
  [switch]$ProbeInputLayout,
  [switch]$ProbeInputRecovery
)
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
    [FieldOffset(0)] public MOUSEINPUT mouse;
    [FieldOffset(0)] public KEYBDINPUT keyboard;
    [FieldOffset(0)] public HARDWAREINPUT hardware;
  }

  // INPUT's native union is sized by MOUSEINPUT, not KEYBDINPUT. Omitting the
  // other union members makes Marshal.SizeOf(INPUT) 32 bytes on 64-bit Windows
  // instead of the 40 bytes required by SendInput, which rejects every paste.
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int x;
    public int y;
    public uint mouseData;
    public uint flags;
    public uint time;
    public UIntPtr extraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort virtualKey;
    public ushort scanCode;
    public uint flags;
    public uint time;
    public UIntPtr extraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct HARDWAREINPUT {
    public uint message;
    public ushort parameterLow;
    public ushort parameterHigh;
  }

  public sealed class PasteResult {
    public bool success { get; set; }
    public bool injected { get; set; }
    public string reason { get; set; }
    public string phase { get; set; }
    public long activeHwnd { get; set; }
    public int actualPid { get; set; }
    public int nativeError { get; set; }
    public int inputSize { get; set; }
    public int expectedInputSize { get; set; }
    public uint inputEventsSent { get; set; }
    public bool recoveryAttempted { get; set; }
    public uint recoveryEventsAttempted { get; set; }
    public uint recoveryEventsSent { get; set; }
    public bool? recoverySucceeded { get; set; }
  }

  public delegate uint InputSender(uint count, INPUT[] inputs, int size);

  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", SetLastError=true)]
  static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)]
  static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", EntryPoint="SendInput", SetLastError=true)]
  static extern uint NativeSendInput(uint count, INPUT[] inputs, int size);

  static PasteResult Failure(
    string reason,
    string phase,
    IntPtr active,
    int actualPid = 0,
    int nativeError = -1,
    uint inputEventsSent = 0,
    uint recoveryEventsAttempted = 0,
    uint recoveryEventsSent = 0,
    bool? recoverySucceeded = null
  ) {
    return new PasteResult {
      success = false,
      injected = false,
      reason = reason,
      phase = phase,
      activeHwnd = active.ToInt64(),
      actualPid = actualPid,
      nativeError = nativeError >= 0 ? nativeError : Marshal.GetLastWin32Error(),
      inputSize = GetInputSize(),
      expectedInputSize = GetExpectedInputSize(),
      inputEventsSent = inputEventsSent,
      recoveryAttempted = recoveryEventsAttempted > 0,
      recoveryEventsAttempted = recoveryEventsAttempted,
      recoveryEventsSent = recoveryEventsSent,
      recoverySucceeded = recoverySucceeded
    };
  }

  public static int GetInputSize() {
    return Marshal.SizeOf(typeof(INPUT));
  }

  public static int GetExpectedInputSize() {
    return IntPtr.Size == 8 ? 40 : 28;
  }

  static bool DeadlineExpired(long deadlineUtcTicks) {
    return deadlineUtcTicks > 0 && DateTime.UtcNow.Ticks >= deadlineUtcTicks;
  }

  static bool ActivateTarget(IntPtr target) {
    IntPtr foreground = GetForegroundWindow();
    if (foreground == target) return true;

    uint ignoredPid = 0;
    uint currentThread = GetCurrentThreadId();
    uint foregroundThread = foreground == IntPtr.Zero
      ? 0
      : GetWindowThreadProcessId(foreground, out ignoredPid);
    uint targetThread = GetWindowThreadProcessId(target, out ignoredPid);
    bool attachedForeground = false;
    bool attachedTarget = false;

    try {
      if (foregroundThread != 0 && foregroundThread != currentThread) {
        attachedForeground = AttachThreadInput(currentThread, foregroundThread, true);
      }
      if (
        targetThread != 0 &&
        targetThread != currentThread &&
        targetThread != foregroundThread
      ) {
        attachedTarget = AttachThreadInput(currentThread, targetThread, true);
      }
      BringWindowToTop(target);
      SetForegroundWindow(target);
      return GetForegroundWindow() == target;
    } finally {
      if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
      if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
    }
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

  static PasteResult InjectPaste(IntPtr target, int expectedPid, InputSender sendInput) {
    INPUT[] inputs = new INPUT[] {
      Key(VK_CONTROL, 0),
      Key(VK_V, 0),
      Key(VK_V, KEYEVENTF_KEYUP),
      Key(VK_CONTROL, KEYEVENTF_KEYUP)
    };
    int inputSize = Marshal.SizeOf(typeof(INPUT));
    uint sent = sendInput((uint)inputs.Length, inputs, inputSize);
    if (sent != inputs.Length) {
      int injectionError = Marshal.GetLastWin32Error();
      uint recoveryAttempted = 0;
      uint recoverySent = 0;

      // SendInput inserts events in sequence. With two inserted events V is
      // down; with one to three inserted events Ctrl is down. Release each key
      // separately so a partial recovery call cannot hide which key remains.
      if (sent == 2) {
        recoveryAttempted += 1;
        INPUT[] releaseV = new INPUT[] { Key(VK_V, KEYEVENTF_KEYUP) };
        if (sendInput(1, releaseV, inputSize) == 1) recoverySent += 1;
      }
      if (sent >= 1 && sent <= 3) {
        recoveryAttempted += 1;
        INPUT[] releaseControl = new INPUT[] { Key(VK_CONTROL, KEYEVENTF_KEYUP) };
        if (sendInput(1, releaseControl, inputSize) == 1) recoverySent += 1;
      }

      bool? recoverySucceeded = recoveryAttempted > 0
        ? (bool?)(recoverySent == recoveryAttempted)
        : null;
      string reason = sent == 0
        ? "send_input_failed"
        : recoverySucceeded == true
          ? "partial_send_input_recovered"
          : "partial_send_input_recovery_failed";
      return Failure(
        reason,
        "injection",
        GetForegroundWindow(),
        expectedPid,
        injectionError,
        sent,
        recoveryAttempted,
        recoverySent,
        recoverySucceeded
      );
    }

    return new PasteResult {
      success = true,
      injected = true,
      reason = "",
      phase = "complete",
      activeHwnd = target.ToInt64(),
      actualPid = expectedPid,
      nativeError = 0,
      inputSize = GetInputSize(),
      expectedInputSize = GetExpectedInputSize(),
      inputEventsSent = sent,
      recoveryAttempted = false,
      recoveryEventsAttempted = 0,
      recoveryEventsSent = 0,
      recoverySucceeded = null
    };
  }

  public static PasteResult ProbeInputRecovery(
    uint initialSent,
    uint vReleaseSent,
    uint controlReleaseSent
  ) {
    int call = 0;
    InputSender probe = delegate(uint count, INPUT[] inputs, int size) {
      if (call++ == 0) return Math.Min(initialSent, count);
      ushort key = inputs != null && inputs.Length > 0
        ? inputs[0].data.keyboard.virtualKey
        : (ushort)0;
      if (key == VK_V) return Math.Min(vReleaseSent, count);
      if (key == VK_CONTROL) return Math.Min(controlReleaseSent, count);
      return 0;
    };
    return InjectPaste(IntPtr.Zero, 0, probe);
  }

  public static PasteResult Execute(
    long targetHwnd,
    int expectedPid,
    long expectedStartTicks,
    long deadlineUtcTicks
  ) {
    IntPtr target = new IntPtr(targetHwnd);
    if (DeadlineExpired(deadlineUtcTicks)) {
      return Failure("deadline_expired", "before_activation", GetForegroundWindow());
    }
    if (GetInputSize() != GetExpectedInputSize()) {
      return Failure("input_layout_invalid", "before_activation", GetForegroundWindow());
    }
    PasteResult identityFailure = ValidateIdentity(
      target,
      expectedPid,
      expectedStartTicks,
      "before_activation"
    );
    if (identityFailure != null) return identityFailure;

    // An orphaned or delayed PowerShell process must never activate a target
    // after the renderer-side request deadline has elapsed.
    if (DeadlineExpired(deadlineUtcTicks)) {
      return Failure("deadline_expired", "before_activation", GetForegroundWindow());
    }
    ActivateTarget(target);
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
    // This is the last operation before SendInput. It makes even an unkillable
    // late child fail closed rather than injecting after JavaScript timed out.
    if (DeadlineExpired(deadlineUtcTicks)) {
      return Failure("deadline_expired", "before_injection", active, expectedPid);
    }
    return InjectPaste(target, expectedPid, NativeSendInput);
  }
}
"@ | Out-Null

if ($ProbeInputLayout) {
  $inputSize = [EchoDraftSecureTargetPaste]::GetInputSize()
  $expectedInputSize = [EchoDraftSecureTargetPaste]::GetExpectedInputSize()
  [pscustomobject]@{
    success = ($inputSize -eq $expectedInputSize)
    inputSize = $inputSize
    expectedInputSize = $expectedInputSize
    pointerBits = [IntPtr]::Size * 8
  } | ConvertTo-Json -Compress
  return
}

if ($ProbeInputRecovery) {
  @(
    [EchoDraftSecureTargetPaste]::ProbeInputRecovery(1, 1, 1),
    [EchoDraftSecureTargetPaste]::ProbeInputRecovery(2, 1, 1),
    [EchoDraftSecureTargetPaste]::ProbeInputRecovery(3, 1, 1),
    [EchoDraftSecureTargetPaste]::ProbeInputRecovery(2, 0, 1)
  ) | ConvertTo-Json -Compress -Depth 4
  return
}

[EchoDraftSecureTargetPaste]::Execute(
  $TargetHwnd,
  $ExpectedPid,
  $ExpectedStartTicks,
  $DeadlineUtcTicks
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
    throw createSecurePasteError(
      "WINDOWS_SECURE_PASTE_INVALID_TARGET",
      "The original app can no longer be authenticated. Text is copied to the clipboard; paste it manually with Ctrl+V."
    );
  }

  const { spawn, terminateProcessTreeAndWait } = manager.deps;
  const deadlineEpochMs = Date.now() + SECURE_TARGET_PASTE_TIMEOUT_MS - NATIVE_DEADLINE_SAFETY_MS;
  const deadlineUtcTicks = DOTNET_UNIX_EPOCH_TICKS + BigInt(Math.trunc(deadlineEpochMs)) * 10_000n;
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
    deadlineUtcTicks.toString(),
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
          createSecurePasteError(
            "WINDOWS_SECURE_PASTE_PROCESS_ERROR",
            `Windows secure paste failed: ${error.message}. Text is copied to the clipboard; paste it manually with Ctrl+V.`
          )
        )
      )
    );
    processHandle.on("close", (code) =>
      finish(() => {
        const parsed = manager.parsePowerShellJsonOutput(stdout);
        if (code !== 0 || parsed?.success !== true || parsed?.injected !== true) {
          const reason = normalizeSecurePasteReason(parsed?.reason);
          const inputEventsSent = Number(parsed?.inputEventsSent) || 0;
          // Ctrl+V may already have reached the target once the V-down event was sent.
          // Preserve that uncertainty across IPC so the renderer never encourages a
          // second paste that could duplicate the dictation.
          const insertionMayHaveOccurred = inputEventsSent >= 2 && inputEventsSent < 4;
          manager.safeLog("Windows secure target paste rejected", {
            code,
            reason,
            phase: parsed?.phase || "unknown",
            inputSize: Number(parsed?.inputSize) || null,
            expectedInputSize: Number(parsed?.expectedInputSize) || null,
            inputEventsSent,
            insertionMayHaveOccurred,
            recoveryAttempted: parsed?.recoveryAttempted === true,
            recoveryEventsAttempted: Number(parsed?.recoveryEventsAttempted) || 0,
            recoveryEventsSent: Number(parsed?.recoveryEventsSent) || 0,
            recoverySucceeded:
              typeof parsed?.recoverySucceeded === "boolean" ? parsed.recoverySucceeded : null,
            hasStderr: Boolean(stderr.trim()),
          });
          const pasteError = createSecurePasteError(
            `WINDOWS_SECURE_PASTE_${reason.toUpperCase()}`,
            insertionMayHaveOccurred
              ? "Windows may have inserted the text, but could not confirm the complete shortcut. Check the target before pasting again."
              : "The original app lost focus or could not be authenticated. Text is copied to the clipboard; paste it manually with Ctrl+V."
          );
          if (insertionMayHaveOccurred) {
            pasteError.insertionMayHaveOccurred = true;
          }
          reject(pasteError);
          return;
        }

        void restoreClipboardAfterPaste(
          manager,
          originalClipboardSnapshot,
          RESTORE_DELAYS.win32_pwsh,
          options.webContents,
          options.expectedClipboardText
        ).then(resolve, reject);
      })
    );

    timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      void (async () => {
        let terminationConfirmed = false;
        try {
          if (typeof terminateProcessTreeAndWait === "function") {
            terminationConfirmed =
              (await terminateProcessTreeAndWait(processHandle, "SIGKILL")) === true;
          }
        } catch {
          terminationConfirmed = false;
        }
        reject(
          createSecurePasteError(
            terminationConfirmed
              ? "WINDOWS_SECURE_PASTE_TIMEOUT"
              : "WINDOWS_SECURE_PASTE_TERMINATION_UNCONFIRMED",
            terminationConfirmed
              ? "Windows secure paste timed out. Text is copied to the clipboard; paste it manually with Ctrl+V."
              : "Windows secure paste timed out and process termination could not be confirmed. Text is copied to the clipboard; paste it manually with Ctrl+V."
          )
        );
      })();
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
          void restoreClipboardAfterPaste(
            manager,
            originalClipboardSnapshot,
            restoreDelay,
            webContents,
            options.expectedClipboardText
          ).then(resolve, reject);
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
          void restoreClipboardAfterPaste(
            manager,
            originalClipboardSnapshot,
            restoreDelay,
            webContents,
            options.expectedClipboardText
          ).then(resolve, reject);
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
  NATIVE_DEADLINE_SAFETY_MS,
  getNircmdPath,
  getNircmdStatus,
  pasteSecurelyToTarget,
  pasteWindows,
  pasteWithNircmd,
  pasteWithPowerShell,
};
