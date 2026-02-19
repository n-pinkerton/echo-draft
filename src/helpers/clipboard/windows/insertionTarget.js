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
$pid = 0
[void][WinApiCapture]::GetWindowThreadProcessId($hwnd, [ref]$pid)
$titleBuilder = New-Object System.Text.StringBuilder 512
[void][WinApiCapture]::GetWindowText($hwnd, $titleBuilder, $titleBuilder.Capacity)
$processName = ""
try { $processName = (Get-Process -Id $pid -ErrorAction Stop).ProcessName } catch {}
[pscustomobject]@{
  success = $true
  hwnd = [Int64]$hwnd
  pid = [Int32]$pid
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
  if (!Number.isFinite(hwnd) || hwnd <= 0) {
    return {
      success: false,
      reason: "invalid_target",
    };
  }

  const activateScript = `
param([Int64]$TargetHwnd)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WinApiActivate {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
}
"@
$target = [IntPtr]$TargetHwnd
if (-not [WinApiActivate]::IsWindow($target)) {
  [pscustomobject]@{ success = $false; reason = "window_not_found"; targetHwnd = $TargetHwnd } | ConvertTo-Json -Compress
  exit 0
}
[void][WinApiActivate]::ShowWindowAsync($target, 9)
$setResult = [WinApiActivate]::SetForegroundWindow($target)
Start-Sleep -Milliseconds 140
$active = [Int64][WinApiActivate]::GetForegroundWindow()
$success = ($active -eq $TargetHwnd)
if (-not $success -and $setResult) {
  Start-Sleep -Milliseconds 120
  $active = [Int64][WinApiActivate]::GetForegroundWindow()
  $success = ($active -eq $TargetHwnd)
}
[pscustomobject]@{
  success = $success
  reason = $(if ($success) { "" } else { "foreground_switch_blocked" })
  targetHwnd = $TargetHwnd
  activeHwnd = $active
  setForegroundReturned = [bool]$setResult
} | ConvertTo-Json -Compress
`.trim();

  try {
    const result = await manager.runWindowsPowerShellScript(activateScript, [String(hwnd)]);
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

