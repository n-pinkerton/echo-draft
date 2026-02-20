const { assert, safeString, sleep } = require("./utils");
const { psJson } = require("./powershell");

async function getForegroundWindowInfo() {
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
$pid = 0
[void][WinApiFg]::GetWindowThreadProcessId($hwnd, [ref]$pid)
$titleBuilder = New-Object System.Text.StringBuilder 512
[void][WinApiFg]::GetWindowText($hwnd, $titleBuilder, $titleBuilder.Capacity)
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

  const result = await psJson(script);
  assert(result.code === 0, `getForegroundWindowInfo failed: ${result.stderr}`);
  assert(result.parsed?.success, `getForegroundWindowInfo returned failure: ${result.stdout} ${result.stderr}`);
  return result.parsed;
}

async function setForegroundWindow(hwnd) {
  const script = `
param([Int64]$TargetHwnd)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WinApiActivate2 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
}
"@
$target = [IntPtr]$TargetHwnd
if (-not [WinApiActivate2]::IsWindow($target)) {
  [pscustomobject]@{ success = $false; reason = "window_not_found"; targetHwnd = $TargetHwnd } | ConvertTo-Json -Compress
  exit 0
}
[void][WinApiActivate2]::ShowWindowAsync($target, 9)
$setResult = [WinApiActivate2]::SetForegroundWindow($target)
Start-Sleep -Milliseconds 140
$active = [Int64][WinApiActivate2]::GetForegroundWindow()
[pscustomobject]@{
  success = ($active -eq $TargetHwnd)
  targetHwnd = $TargetHwnd
  activeHwnd = $active
  setForegroundReturned = [bool]$setResult
} | ConvertTo-Json -Compress
`.trim();

  const result = await psJson(script, [String(hwnd)]);
  assert(result.code === 0, `setForegroundWindow failed: ${result.stderr}`);
  return result.parsed;
}

async function ensureForegroundWindow(hwnd, label = "target", attempts = 6) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await setForegroundWindow(hwnd);
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
  assert(result.parsed?.success, `readEditText returned failure: ${result.stdout} ${result.stderr}`);
  return safeString(result.parsed.text);
}

module.exports = {
  ensureForegroundWindow,
  getForegroundWindowInfo,
  readEditText,
  setForegroundWindow,
};

