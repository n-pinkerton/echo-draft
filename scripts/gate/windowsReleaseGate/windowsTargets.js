const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { assert, isTruthyFlag, safeString, sleep } = require("./utils");
const { parseJsonFromStdout, psJson } = require("./powershell");

const closedChildProcesses = new WeakSet();

async function startGateTextWindow() {
  const focusSignalPath = path.join(
    os.tmpdir(),
    `echodraft-gate-focus-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.signal`
  );
  const focusSignalPowerShellPath = focusSignalPath.replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "EchoDraft Gate Target"
$form.Width = 720
$form.Height = 420
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen

$textBox = New-Object System.Windows.Forms.TextBox
$textBox.Multiline = $true
$textBox.Dock = [System.Windows.Forms.DockStyle]::Fill
$textBox.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
$textBox.Font = New-Object System.Drawing.Font("Consolas", 11)
$form.Controls.Add($textBox)

$focusSignalPath = '${focusSignalPowerShellPath}'
$focusTimer = New-Object System.Windows.Forms.Timer
$focusTimer.Interval = 40
$focusTimer.Add_Tick({
  if ([System.IO.File]::Exists($focusSignalPath)) {
    try { [System.IO.File]::Delete($focusSignalPath) } catch {}
    try { $form.Activate() } catch {}
    try { $textBox.Focus() } catch {}
  }
})
$focusTimer.Start()
$form.Add_FormClosed({
  try { $focusTimer.Stop() } catch {}
  try { $focusTimer.Dispose() } catch {}
  try { [System.IO.File]::Delete($focusSignalPath) } catch {}
})

try { $form.Show() } catch {}
try { [System.Windows.Forms.Application]::DoEvents() } catch {}
Start-Sleep -Milliseconds 180
try { $form.Activate() } catch {}
try { $textBox.Focus() } catch {}
[pscustomobject]@{
  success = $true
  pid = [Int32]$PID
  hwnd = [Int64]$form.Handle
  editHwnd = [Int64]$textBox.Handle
} | ConvertTo-Json -Compress
try { [Console]::Out.Flush() } catch {}

[System.Windows.Forms.Application]::Run($form)
`.trim();

  const psArgs = [
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-STA",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ];

  const child = spawn("powershell.exe", psArgs, { windowsHide: true });
  let stdout = "";
  let stderr = "";

  child.stderr?.on("data", (data) => {
    stderr += data.toString();
  });

  const parsed = await new Promise((resolve, reject) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try {
        child.kill("SIGKILL");
      } catch {}
      reject(new Error("Gate text window timed out while starting"));
    }, 25000);

    child.on("error", (error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("exit", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      reject(new Error(`Gate text window exited unexpectedly (code ${code ?? "null"})`));
    });

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
      const maybe = parseJsonFromStdout(stdout);
      if (maybe?.success && maybe?.hwnd && maybe?.editHwnd) {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        resolve(maybe);
      }
    });
  });

  return {
    kind: "gatepad",
    pid: Number(parsed.pid),
    hwnd: Number(parsed.hwnd),
    editHwnd: Number(parsed.editHwnd),
    launcherPid: null,
    _child: child,
    _stderr: stderr,
    focusSignalPath,
  };
}

async function requestGateTextWindowFocus(target) {
  if (target?.kind !== "gatepad" || !target?.focusSignalPath) {
    return false;
  }
  fs.writeFileSync(target.focusSignalPath, String(Date.now()), "utf8");
  await sleep(140);
  return true;
}

async function startNotepad() {
  const script = `
param()
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class WinApiNp {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hwndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowTitle);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Auto, SetLastError=true)] public static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);

  public static IntPtr FindTopWindowForPid(int pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;
      uint windowPid;
      GetWindowThreadProcessId(hWnd, out windowPid);
      if (windowPid == (uint)pid) {
        found = hWnd;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static IntPtr FindDescendantByClassList(IntPtr parent, string[] classNames) {
    if (parent == IntPtr.Zero || classNames == null || classNames.Length == 0) return IntPtr.Zero;
    var wanted = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (var name in classNames) {
      if (!string.IsNullOrWhiteSpace(name)) wanted.Add(name.Trim());
    }
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(parent, (hWnd, lParam) => {
      var sb = new StringBuilder(256);
      GetClassName(hWnd, sb, sb.Capacity);
      var cls = sb.ToString();
      if (wanted.Contains(cls)) {
        found = hWnd;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

$existingHwnd = @{}
$existingPids = @{}
try {
  @(Get-Process -Name Notepad -ErrorAction SilentlyContinue) | ForEach-Object {
    try { $existingPids[[Int32]$_.Id] = $true } catch {}
    try {
      if ($_.MainWindowHandle -ne 0) {
        $existingHwnd[[Int64]$_.MainWindowHandle] = $true
      }
    } catch {}
  }
} catch {}

$launcherProc = Start-Process notepad -PassThru
try { $launcherProc.WaitForInputIdle(1500) | Out-Null } catch {}

$uiProc = $null
$hwnd = [Int64]0
for ($i = 0; $i -lt 120 -and $hwnd -eq 0; $i++) {
  Start-Sleep -Milliseconds 100
  try {
    $candidates = @(Get-Process -Name Notepad -ErrorAction SilentlyContinue) | Where-Object { $_.MainWindowHandle -ne 0 }
    $uiProc = $candidates | Where-Object { -not $existingPids.ContainsKey([Int32]$_.Id) } | Select-Object -First 1
    if ($uiProc) { $hwnd = [Int64]$uiProc.MainWindowHandle }
  } catch {}
}

if ($hwnd -eq 0) {
  [pscustomobject]@{
    success = $false
    error = "notepad_no_window"
    details = $(if ($existingPids.Count -gt 0) { "existing_notepad_processes_detected" } else { "" })
  } | ConvertTo-Json -Compress
  exit 0
}
[void][WinApiNp]::ShowWindowAsync([IntPtr]$hwnd, 9)
[void][WinApiNp]::SetForegroundWindow([IntPtr]$hwnd)
Start-Sleep -Milliseconds 120
$edit = [WinApiNp]::FindDescendantByClassList([IntPtr]$hwnd, @("Edit", "RichEditD2DPT", "RICHEDIT50W", "RICHEDIT50W", "RichEdit50W"))
$pid = 0
[void][WinApiNp]::GetWindowThreadProcessId([IntPtr]$hwnd, [ref]$pid)
[pscustomobject]@{
  success = $true
  pid = [Int32]$pid
  launcherPid = [Int32]$launcherProc.Id
  hwnd = [Int64]$hwnd
  editHwnd = [Int64]$edit
} | ConvertTo-Json -Compress
`.trim();

  const result = await psJson(script);
  assert(result.code === 0, `startNotepad failed: ${result.stderr}`);
  assert(
    result.parsed?.success,
    `startNotepad returned failure: ${result.stdout} ${result.stderr}`
  );
  return result.parsed;
}

async function verifyProcessStopped(pid) {
  const script = `
param([Int32]$TargetPid)
$remaining = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
[pscustomobject]@{
  success = ($null -eq $remaining)
  pid = $TargetPid
} | ConvertTo-Json -Compress
`.trim();
  try {
    const result = await psJson(script, [pid]);
    return Boolean(result.code === 0 && result.parsed?.success);
  } catch {
    return false;
  }
}

function hasChildExited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(child, timeoutMs = 2500) {
  if (hasChildExited(child)) {
    return true;
  }

  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(timeoutMs)]);
  return hasChildExited(child);
}

async function closeProcess(pid, focusSignalPath = null, child = null) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    return false;
  }

  try {
    if (child) {
      if (Number(child.pid) !== numericPid) {
        return false;
      }
      if (closedChildProcesses.has(child) || hasChildExited(child)) {
        closedChildProcesses.add(child);
        return true;
      }
    }

    const script = `
param([Int32]$TargetPid)
$stopError = ""
try {
  Stop-Process -Id $TargetPid -Force -ErrorAction Stop
} catch {
  $stopError = $_.Exception.Message
}

$remaining = $null
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  $remaining = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
  if ($null -eq $remaining) { break }
  Start-Sleep -Milliseconds 50
}

$result = [pscustomobject]@{
  success = ($null -eq $remaining)
  pid = $TargetPid
  error = $stopError
}
$result | ConvertTo-Json -Compress
`.trim();

    let stopped = false;
    try {
      const result = await psJson(script, [numericPid]);
      stopped = Boolean(result.code === 0 && result.parsed?.success);
    } catch {
      stopped = false;
    }

    if (!stopped && child && !hasChildExited(child)) {
      try {
        child.kill();
      } catch {
        // The exact-PID verification below remains authoritative.
      }
      await waitForChildExit(child);
    }

    const verifiedStopped = stopped || (await verifyProcessStopped(numericPid));
    if (verifiedStopped && child) {
      closedChildProcesses.add(child);
    }
    return verifiedStopped;
  } finally {
    if (focusSignalPath) {
      try {
        fs.rmSync(focusSignalPath, { force: true });
      } catch {
        // ignore
      }
    }
  }
}

async function startTextTarget() {
  const allowNotepad = isTruthyFlag(process.env.OPENWHISPR_GATE_USE_NOTEPAD);
  if (!allowNotepad) {
    console.warn(
      "[gate] Using GatePad text window by default (avoids touching user Notepad tabs/files). Set OPENWHISPR_GATE_USE_NOTEPAD=1 to opt in."
    );
    return await startGateTextWindow();
  }

  try {
    const existingNotepad = await psJson(
      `
try {
  $count = @(Get-Process -Name Notepad -ErrorAction SilentlyContinue).Count
} catch { $count = 0 }
[pscustomobject]@{ success = $true; count = [Int32]$count } | ConvertTo-Json -Compress
      `.trim()
    );

    if (Number(existingNotepad.parsed?.count || 0) > 0) {
      console.warn(
        "[gate] Detected existing Notepad processes; using GatePad text window instead."
      );
      return await startGateTextWindow();
    }
  } catch {
    console.warn(
      "[gate] Could not check for existing Notepad processes; using GatePad text window instead."
    );
    return await startGateTextWindow();
  }

  try {
    const notepad = await startNotepad();
    return { ...notepad, kind: "notepad" };
  } catch (error) {
    const message = safeString(error?.message || error);
    console.warn(`[gate] startNotepad failed (${message}); using GatePad text window instead.`);
    return await startGateTextWindow();
  }
}

module.exports = {
  closeProcess,
  requestGateTextWindowFocus,
  startGateTextWindow,
  startNotepad,
  startTextTarget,
};
