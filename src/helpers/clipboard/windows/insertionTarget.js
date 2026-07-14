async function captureInsertionTarget(manager) {
  if (manager.deps.platform !== "win32") {
    return {
      success: false,
      reason: "unsupported_platform",
    };
  }

  const captureScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WinApiCapture {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$hwnd = [WinApiCapture]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) {
  [pscustomobject]@{ success = $false; reason = "no_foreground_window" } | ConvertTo-Json -Compress
  exit 0
}
$processId = [UInt32]0
[void][WinApiCapture]::GetWindowThreadProcessId($hwnd, [ref]$processId)
$titleBuilder = New-Object System.Text.StringBuilder 512
[void][WinApiCapture]::GetWindowText($hwnd, $titleBuilder, $titleBuilder.Capacity)
$processName = ""
$processStartTimeUtcTicks = [Int64]0
try {
  $process = Get-Process -Id $processId -ErrorAction Stop
  $processName = $process.ProcessName
  $processStartTimeUtcTicks = $process.StartTime.ToUniversalTime().Ticks
} catch {}
if ($processId -le 0 -or $processStartTimeUtcTicks -le 0) {
  [pscustomobject]@{ success = $false; reason = "process_identity_unavailable" } | ConvertTo-Json -Compress
  exit 0
}
[pscustomobject]@{
  success = $true
  hwnd = [Int64]$hwnd
  pid = [Int32]$processId
  processStartTimeUtcTicks = $processStartTimeUtcTicks.ToString()
  processName = $processName
  title = $titleBuilder.ToString()
} | ConvertTo-Json -Compress
`.trim();

  try {
    const result = await manager.runWindowsPowerShellScript(captureScript);
    const parsed = manager.parsePowerShellJsonOutput(result.stdout);

    if (result.code !== 0) {
      return {
        success: false,
        reason: "capture_failed",
        error: (result.stderr || "").trim() || `PowerShell exited with code ${result.code}`,
      };
    }

    if (!parsed || parsed.success !== true || !parsed.hwnd) {
      return {
        success: false,
        reason: parsed?.reason || "capture_failed",
        error: (result.stderr || "").trim() || null,
      };
    }

    const now = manager.deps.now || Date.now;

    return {
      success: true,
      target: {
        hwnd: Number(parsed.hwnd),
        pid: Number(parsed.pid) || null,
        processStartTimeUtcTicks: /^\d{1,20}$/.test(String(parsed.processStartTimeUtcTicks || ""))
          ? String(parsed.processStartTimeUtcTicks)
          : null,
        processName: parsed.processName || "",
        title: parsed.title || "",
        capturedAt: now(),
      },
    };
  } catch (error) {
    return {
      success: false,
      reason: "capture_failed",
      error: error?.message || String(error),
    };
  }
}

async function activateInsertionTarget(manager, target) {
  if (manager.deps.platform !== "win32") {
    return {
      success: false,
      reason: "unsupported_platform",
    };
  }

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
    return {
      success: false,
      reason: "invalid_target",
    };
  }

  const activateScript = `
param([Int64]$TargetHwnd, [Int32]$ExpectedPid, [Int64]$ExpectedStartTicks)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WinApiActivate {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", SetLastError=true)] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  public static bool ActivateTarget(IntPtr target) {
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
      if (targetThread != 0 && targetThread != currentThread && targetThread != foregroundThread) {
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
}
"@
$target = [IntPtr]$TargetHwnd
function Test-TargetIdentity {
  if (-not [WinApiActivate]::IsWindow($target)) {
    return [pscustomobject]@{ success = $false; reason = "window_not_found"; pid = 0; startTicks = 0 }
  }
  $actualPid = [UInt32]0
  [void][WinApiActivate]::GetWindowThreadProcessId($target, [ref]$actualPid)
  if ([Int32]$actualPid -ne $ExpectedPid) {
    return [pscustomobject]@{ success = $false; reason = "target_process_changed"; pid = [Int32]$actualPid; startTicks = 0 }
  }
  try {
    $actualStartTicks = (Get-Process -Id $actualPid -ErrorAction Stop).StartTime.ToUniversalTime().Ticks
  } catch {
    return [pscustomobject]@{ success = $false; reason = "target_process_unavailable"; pid = [Int32]$actualPid; startTicks = 0 }
  }
  if ($actualStartTicks -ne $ExpectedStartTicks) {
    return [pscustomobject]@{ success = $false; reason = "target_process_changed"; pid = [Int32]$actualPid; startTicks = $actualStartTicks }
  }
  return [pscustomobject]@{ success = $true; reason = ""; pid = [Int32]$actualPid; startTicks = $actualStartTicks }
}
$before = Test-TargetIdentity
if (-not $before.success) {
  [pscustomobject]@{ success = $false; reason = $before.reason; phase = "before_activation" } | ConvertTo-Json -Compress
  exit 0
}
$setResult = [WinApiActivate]::ActivateTarget($target)
Start-Sleep -Milliseconds 140
$active = [Int64][WinApiActivate]::GetForegroundWindow()
$success = ($active -eq $TargetHwnd)
if (-not $success -and $setResult) {
  Start-Sleep -Milliseconds 120
  $active = [Int64][WinApiActivate]::GetForegroundWindow()
  $success = ($active -eq $TargetHwnd)
}
$after = Test-TargetIdentity
$success = ($success -and $after.success)
[pscustomobject]@{
  success = $success
  reason = $(if (-not $after.success) { $after.reason } elseif ($success) { "" } else { "foreground_switch_blocked" })
  phase = $(if (-not $after.success) { "after_activation" } else { "complete" })
  targetHwnd = $TargetHwnd
  activeHwnd = $active
  beforePid = $before.pid
  afterPid = $after.pid
  setForegroundReturned = [bool]$setResult
} | ConvertTo-Json -Compress
`.trim();

  try {
    const result = await manager.runWindowsPowerShellScript(activateScript, [
      String(hwnd),
      String(expectedPid),
      String(expectedStartTicks),
    ]);
    const parsed = manager.parsePowerShellJsonOutput(result.stdout);

    if (result.code !== 0) {
      return {
        success: false,
        reason: "activation_failed",
        error: (result.stderr || "").trim() || `PowerShell exited with code ${result.code}`,
      };
    }

    if (!parsed || parsed.success !== true) {
      return {
        success: false,
        reason: parsed?.reason || "activation_failed",
        details: parsed || null,
      };
    }

    return {
      success: true,
      details: parsed,
    };
  } catch (error) {
    return {
      success: false,
      reason: "activation_failed",
      error: error?.message || String(error),
    };
  }
}

function resolveTargetLabel(target = {}) {
  const processName = target?.processName ? String(target.processName) : "";
  const title = target?.title ? String(target.title) : "";
  if (processName && title) return `${processName} (${title})`;
  if (processName) return processName;
  if (title) return title;
  return "original app";
}

module.exports = {
  activateInsertionTarget,
  captureInsertionTarget,
  resolveTargetLabel,
};
