const { assert, safeString, sleep } = require("./utils");
const { psJson } = require("./powershell");

function parseForegroundWindowResult(result, { allowMissing = false } = {}) {
  assert(result.code === 0, `getForegroundWindowInfo failed: ${result.stderr}`);
  if (result.parsed?.success) {
    assert(
      Number.isSafeInteger(result.parsed.hwnd) &&
        result.parsed.hwnd > 0 &&
        Number.isSafeInteger(result.parsed.pid) &&
        result.parsed.pid > 0 &&
        typeof result.parsed.processName === "string" &&
        result.parsed.processName.trim().length > 0,
      `getForegroundWindowInfo returned an invalid window identity: ${result.stdout} ${result.stderr}`
    );
    return result.parsed;
  }
  if (allowMissing && result.parsed?.reason === "no_foreground_window") {
    return null;
  }
  assert(false, `getForegroundWindowInfo returned failure: ${result.stdout} ${result.stderr}`);
}

async function getForegroundWindowInfo({ allowMissing = false } = {}) {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WinApiFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$hwnd = [WinApiFg]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) {
  [pscustomobject]@{ success = $false; reason = "no_foreground_window" } | ConvertTo-Json -Compress
  exit 0
}
$foregroundProcessId = 0
[void][WinApiFg]::GetWindowThreadProcessId($hwnd, [ref]$foregroundProcessId)
$titleBuilder = New-Object System.Text.StringBuilder 512
[void][WinApiFg]::GetWindowText($hwnd, $titleBuilder, $titleBuilder.Capacity)
$processName = ""
try {
  $processName = (Get-Process -Id $foregroundProcessId -ErrorAction Stop).ProcessName
} catch {
  [pscustomobject]@{
    success = $false
    reason = "process_lookup_failed"
    hwnd = [Int64]$hwnd
    pid = [Int32]$foregroundProcessId
  } | ConvertTo-Json -Compress
  exit 0
}
if ([String]::IsNullOrWhiteSpace($processName)) {
  [pscustomobject]@{
    success = $false
    reason = "process_identity_empty"
    hwnd = [Int64]$hwnd
    pid = [Int32]$foregroundProcessId
  } | ConvertTo-Json -Compress
  exit 0
}
[pscustomobject]@{
  success = $true
  hwnd = [Int64]$hwnd
  pid = [Int32]$foregroundProcessId
  processName = $processName
  title = $titleBuilder.ToString()
} | ConvertTo-Json -Compress
`.trim();

  const result = await psJson(script);
  return parseForegroundWindowResult(result, { allowMissing });
}

async function setForegroundWindow(hwnd, focusHwnd = null) {
  const script = `
param([Int64]$TargetHwnd, [Int64]$FocusHwnd)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WinApiActivate2 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
}
"@
$target = [IntPtr]$TargetHwnd
if (-not [WinApiActivate2]::IsWindow($target)) {
  [pscustomobject]@{ success = $false; reason = "window_not_found"; targetHwnd = $TargetHwnd } | ConvertTo-Json -Compress
  exit 0
}
$foreground = [WinApiActivate2]::GetForegroundWindow()
$currentThread = [WinApiActivate2]::GetCurrentThreadId()
$foregroundThread = [WinApiActivate2]::GetWindowThreadProcessId($foreground, [IntPtr]::Zero)
$targetThread = [WinApiActivate2]::GetWindowThreadProcessId($target, [IntPtr]::Zero)
$attachedForeground = $false
$attachedTarget = $false
try {
  if ($foregroundThread -ne 0 -and $foregroundThread -ne $currentThread) {
    $attachedForeground = [WinApiActivate2]::AttachThreadInput($currentThread, $foregroundThread, $true)
  }
  if ($targetThread -ne 0 -and $targetThread -ne $currentThread) {
    $attachedTarget = [WinApiActivate2]::AttachThreadInput($currentThread, $targetThread, $true)
  }
  [void][WinApiActivate2]::ShowWindowAsync($target, 9)
  [void][WinApiActivate2]::BringWindowToTop($target)
  $setResult = [WinApiActivate2]::SetForegroundWindow($target)
  $focusTarget = $(if ($FocusHwnd -ne 0 -and [WinApiActivate2]::IsWindow([IntPtr]$FocusHwnd)) { [IntPtr]$FocusHwnd } else { $target })
  [void][WinApiActivate2]::SetFocus($focusTarget)
} finally {
  if ($attachedTarget) {
    [void][WinApiActivate2]::AttachThreadInput($currentThread, $targetThread, $false)
  }
  if ($attachedForeground) {
    [void][WinApiActivate2]::AttachThreadInput($currentThread, $foregroundThread, $false)
  }
}
Start-Sleep -Milliseconds 140
$active = [Int64][WinApiActivate2]::GetForegroundWindow()
[pscustomobject]@{
  success = ($active -eq $TargetHwnd)
  targetHwnd = $TargetHwnd
  activeHwnd = $active
  setForegroundReturned = [bool]$setResult
} | ConvertTo-Json -Compress
`.trim();

  const result = await psJson(script, [String(hwnd), String(focusHwnd || 0)]);
  assert(result.code === 0, `setForegroundWindow failed: ${result.stderr}`);
  return result.parsed;
}

async function ensureForegroundWindow(hwnd, label = "target", attempts = 6, focusHwnd = null) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await setForegroundWindow(hwnd, focusHwnd);
    if (last?.success) {
      return { success: true, attempt, details: last };
    }
    await sleep(180);
  }

  let foreground = null;
  try {
    foreground = await getForegroundWindowInfo();
  } catch {
    foreground = null;
  }

  return { success: false, attempt: attempts, details: last, foreground, label };
}

async function readEditText(editHwnd) {
  const script = `
param([Int64]$EditHwnd)
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WinApiText {
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int SendMessage(IntPtr hWnd, int msg, int wParam, StringBuilder lParam);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int SendMessage(IntPtr hWnd, int msg, int wParam, IntPtr lParam);
  public const int WM_GETTEXT = 0x000D;
  public const int WM_GETTEXTLENGTH = 0x000E;
}
"@
$h = [IntPtr]$EditHwnd
$len = [WinApiText]::SendMessage($h, [WinApiText]::WM_GETTEXTLENGTH, 0, [IntPtr]::Zero)
if ($len -lt 0) { $len = 0 }
$sb = New-Object System.Text.StringBuilder ($len + 1)
[void][WinApiText]::SendMessage($h, [WinApiText]::WM_GETTEXT, $sb.Capacity, $sb)
[pscustomobject]@{ success = $true; text = $sb.ToString() } | ConvertTo-Json -Compress
`.trim();

  const result = await psJson(script, [String(editHwnd)]);
  assert(result.code === 0, `readEditText failed: ${result.stderr}`);
  assert(
    result.parsed?.success,
    `readEditText returned failure: ${result.stdout} ${result.stderr}`
  );
  return safeString(result.parsed.text);
}

module.exports = {
  ensureForegroundWindow,
  getForegroundWindowInfo,
  parseForegroundWindowResult,
  readEditText,
  setForegroundWindow,
};
