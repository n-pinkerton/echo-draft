#!/usr/bin/env node
/**
 * OpenWhispr Windows packaged-runtime release gate.
 *
 * Runs a small suite of Windows-first checks against a PACKAGED build
 * using Chrome DevTools Protocol (CDP) + PowerShell helpers.
 *
 * Usage (Windows):
 *   node scripts\\gate\\windows_release_gate.js [path\\to\\OpenWhispr.exe]
 *
 * Required env:
 *   OPENWHISPR_E2E=1 (enables guarded E2E helpers in preload + IPC)
 */

const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isTruthyFlag(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function safeString(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

async function fetchJson(url, timeoutMs = 2000) {
  return await new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: timeoutMs }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy(new Error("Request timeout"));
    });
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);

    await new Promise((resolve, reject) => {
      this.ws.on("open", resolve);
      this.ws.on("error", reject);
    });

    this.ws.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          reject(new Error(message.error.message || "CDP error"));
        } else {
          resolve(message.result);
        }
      }
    });

    await this.send("Runtime.enable");
    await this.send("Page.enable");
  }

  async send(method, params = {}) {
    const id = this.nextId++;
    const payload = { id, method, params };
    const text = JSON.stringify(payload);

    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(text, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  async eval(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });

    if (result?.exceptionDetails) {
      const description =
        result.exceptionDetails?.exception?.description ||
        result.exceptionDetails?.text ||
        "CDP evaluation exception";
      throw new Error(description);
    }

    return result?.result?.value;
  }

  async waitFor(predicateExpression, timeoutMs = 10000, intervalMs = 150) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const value = await this.eval(`Boolean(${predicateExpression})`);
        if (value) return true;
      } catch {
        // ignore and retry
      }
      await sleep(intervalMs);
    }
    throw new Error(`Timed out waiting for: ${predicateExpression}`);
  }

  async waitForSelector(selector, timeoutMs = 10000) {
    const escaped = JSON.stringify(selector);
    return await this.waitFor(`document.querySelector(${escaped})`, timeoutMs);
  }

  async click(selector) {
    const escaped = JSON.stringify(selector);
    await this.eval(`
      (function () {
        const el = document.querySelector(${escaped});
        if (!el) throw new Error("Element not found: " + ${escaped});
        el.click();
        return true;
      })()
    `);
  }

  async setInputValue(selector, value) {
    const escapedSel = JSON.stringify(selector);
    const escapedVal = JSON.stringify(value);
    await this.eval(`
      (function () {
        const el = document.querySelector(${escapedSel});
        if (!el) throw new Error("Element not found: " + ${escapedSel});
        el.focus();
        const proto = Object.getPrototypeOf(el);
        const protoDesc = proto ? Object.getOwnPropertyDescriptor(proto, "value") : null;
        if (protoDesc && typeof protoDesc.set === "function") {
          protoDesc.set.call(el, ${escapedVal});
        } else {
          el.value = ${escapedVal};
        }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()
    `);
  }

  async close() {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;

    await new Promise((resolve) => {
      let resolved = false;
      let timer = null;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        if (timer) clearTimeout(timer);
        resolve();
      };

      ws.once("close", finish);

      timer = setTimeout(() => {
        try {
          ws.terminate();
        } catch {
          // ignore
        }
        finish();
      }, 2000);

      try {
        ws.close();
      } catch {
        finish();
      }
    });
  }
}

async function runPowerShell(script, args = [], options = {}) {
  const { sta = false, timeoutMs = 15000, stdin = null } = options;
  const wrappedScript = `& {\n${script}\n}`;
  const psArgs = [
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    ...(sta ? ["-STA"] : []),
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    wrappedScript,
    ...args.map((arg) => String(arg)),
  ];

  const child = spawn("powershell.exe", psArgs, { windowsHide: true });

  let stdout = "";
  let stderr = "";

  child.stdout?.on("data", (data) => {
    stdout += data.toString();
  });

  child.stderr?.on("data", (data) => {
    stderr += data.toString();
  });

  if (stdin !== null && stdin !== undefined) {
    try {
      child.stdin?.write(String(stdin));
    } catch {
      // ignore
    }
    try {
      child.stdin?.end();
    } catch {
      // ignore
    }
  }

  const exitResult = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      reject(new Error(`PowerShell timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

  return exitResult;
}

function parseJsonFromStdout(stdout) {
  const trimmed = safeString(stdout).trim();
  if (!trimmed) return null;
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim());
  const candidate = [...lines].reverse().find((line) => line.startsWith("{") || line.startsWith("["));
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

async function psJson(script, args = [], options = {}) {
  const result = await runPowerShell(script, args, options);
  const parsed = parseJsonFromStdout(result.stdout);
  return { ...result, parsed };
}

async function startGateTextWindow() {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "OpenWhispr Gate Target"
$form.Width = 720
$form.Height = 420
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen

$textBox = New-Object System.Windows.Forms.TextBox
$textBox.Multiline = $true
$textBox.Dock = [System.Windows.Forms.DockStyle]::Fill
$textBox.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
$textBox.Font = New-Object System.Drawing.Font("Consolas", 11)
$form.Controls.Add($textBox)

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
  };
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
$edit = [WinApiNp]::FindDescendantByClassList([IntPtr]$hwnd, @("Edit", "RichEditD2DPT", "RICHEDIT50W", "RichEdit50W"))
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
  assert(result.parsed?.success, `startNotepad returned failure: ${result.stdout} ${result.stderr}`);
  return result.parsed;
}

async function closeProcess(pid) {
  const script = `
param([Int32]$Pid)
try { Stop-Process -Id $Pid -Force -ErrorAction Stop; [pscustomobject]@{ success = $true } }
catch { [pscustomobject]@{ success = $false; error = $_.Exception.Message } }
| ConvertTo-Json -Compress
`.trim();
  const result = await psJson(script, [pid]);
  return Boolean(result.parsed?.success);
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
      console.warn("[gate] Detected existing Notepad processes; using GatePad text window instead.");
      return await startGateTextWindow();
    }
  } catch {
    console.warn("[gate] Could not check for existing Notepad processes; using GatePad text window instead.");
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

async function setClipboardTestImage() {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 24, 24
for ($x = 0; $x -lt 24; $x++) {
  for ($y = 0; $y -lt 24; $y++) {
    $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(255, ($x * 10) % 255, ($y * 10) % 255, 80))
  }
}
[System.Windows.Forms.Clipboard]::SetImage($bmp)
$img = [System.Windows.Forms.Clipboard]::GetImage()
$bmp2 = New-Object System.Drawing.Bitmap $img
$ms = New-Object System.IO.MemoryStream
for ($y = 0; $y -lt $bmp2.Height; $y++) {
  for ($x = 0; $x -lt $bmp2.Width; $x++) {
    $argb = [Int32]$bmp2.GetPixel($x, $y).ToArgb()
    $b = [System.BitConverter]::GetBytes($argb)
    $ms.Write($b, 0, $b.Length) | Out-Null
  }
}
$pixelBytes = $ms.ToArray()
$sha = [System.Security.Cryptography.SHA256]::Create()
$hashBytes = $sha.ComputeHash($pixelBytes)
$hash = [System.BitConverter]::ToString($hashBytes).Replace("-", "").ToLowerInvariant()
[pscustomobject]@{ success = $true; hasImage = $true; width = $bmp2.Width; height = $bmp2.Height; len = [Int32]$pixelBytes.Length; hash = $hash } | ConvertTo-Json -Compress
`.trim();

  const result = await psJson(script, [], { sta: true, timeoutMs: 20000 });
  assert(result.code === 0, `setClipboardTestImage failed: ${result.stderr}`);
  assert(result.parsed?.success, `setClipboardTestImage returned failure: ${result.stdout} ${result.stderr}`);
  return result.parsed;
}

async function getClipboardImageHash() {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) {
  [pscustomobject]@{ success = $true; hasImage = $false } | ConvertTo-Json -Compress
  exit 0
}
$img = [System.Windows.Forms.Clipboard]::GetImage()
$bmp2 = New-Object System.Drawing.Bitmap $img
$ms = New-Object System.IO.MemoryStream
for ($y = 0; $y -lt $bmp2.Height; $y++) {
  for ($x = 0; $x -lt $bmp2.Width; $x++) {
    $argb = [Int32]$bmp2.GetPixel($x, $y).ToArgb()
    $b = [System.BitConverter]::GetBytes($argb)
    $ms.Write($b, 0, $b.Length) | Out-Null
  }
}
$pixelBytes = $ms.ToArray()
$sha = [System.Security.Cryptography.SHA256]::Create()
$hashBytes = $sha.ComputeHash($pixelBytes)
$hash = [System.BitConverter]::ToString($hashBytes).Replace("-", "").ToLowerInvariant()
[pscustomobject]@{ success = $true; hasImage = $true; width = $bmp2.Width; height = $bmp2.Height; len = [Int32]$pixelBytes.Length; hash = $hash } | ConvertTo-Json -Compress
`.trim();

  const result = await psJson(script, [], { sta: true, timeoutMs: 20000 });
  assert(result.code === 0, `getClipboardImageHash failed: ${result.stderr}`);
  assert(result.parsed?.success, `getClipboardImageHash returned failure: ${result.stdout} ${result.stderr}`);
  return result.parsed;
}

async function getClipboardText() {
  const script = `Get-Clipboard -Raw | ConvertTo-Json -Compress`.trim();
  const result = await psJson(script, [], { sta: true, timeoutMs: 10000 });
  if (result.code !== 0) {
    return "";
  }
  if (typeof result.parsed === "string") {
    return result.parsed;
  }
  return safeString(result.stdout).trim();
}

async function snapshotClipboardForRestore() {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$text = $null
$rtf = $null
$html = $null
$imagePngB64 = $null
$imageWidth = $null
$imageHeight = $null
$imageSkipped = $false

try {
  if ([System.Windows.Forms.Clipboard]::ContainsText([System.Windows.Forms.TextDataFormat]::UnicodeText)) {
    $text = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::UnicodeText)
  }
} catch {}

try {
  if ([System.Windows.Forms.Clipboard]::ContainsText([System.Windows.Forms.TextDataFormat]::Rtf)) {
    $rtf = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::Rtf)
  }
} catch {}

try {
  if ([System.Windows.Forms.Clipboard]::ContainsText([System.Windows.Forms.TextDataFormat]::Html)) {
    $html = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::Html)
  }
} catch {}

try {
  if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
    $img = [System.Windows.Forms.Clipboard]::GetImage()
    if ($img -ne $null) {
      $imageWidth = [Int32]$img.Width
      $imageHeight = [Int32]$img.Height
      $pixels = [Int64]$imageWidth * [Int64]$imageHeight
      if ($pixels -le 6000000) {
        $ms = New-Object System.IO.MemoryStream
        $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bytes = $ms.ToArray()
        if ($bytes -ne $null -and $bytes.Length -gt 0) {
          $imagePngB64 = [System.Convert]::ToBase64String($bytes)
        }
      } else {
        $imageSkipped = $true
      }
    }
  }
} catch {}

[pscustomobject]@{
  success = $true
  text = $text
  rtf = $rtf
  html = $html
  imagePngB64 = $imagePngB64
  imageWidth = $imageWidth
  imageHeight = $imageHeight
  imageSkipped = $imageSkipped
} | ConvertTo-Json -Compress
`.trim();

  try {
    const result = await psJson(script, [], { sta: true, timeoutMs: 12000 });
    if (result.code !== 0 || !result.parsed?.success) {
      return null;
    }
    return result.parsed;
  } catch {
    return null;
  }
}

async function restoreClipboardSnapshot(snapshot) {
  if (!snapshot || snapshot.success !== true) return false;
  const hasRestorableImage = typeof snapshot.imagePngB64 === "string" && snapshot.imagePngB64.length > 0;
  const hasRestorableText = typeof snapshot.text === "string" && snapshot.text.length > 0;
  const hasRestorableRtf = typeof snapshot.rtf === "string" && snapshot.rtf.length > 0;
  const hasRestorableHtml = typeof snapshot.html === "string" && snapshot.html.length > 0;

  if (!hasRestorableImage && !hasRestorableText && !hasRestorableRtf && !hasRestorableHtml) {
    return true;
  }

  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$raw = [Console]::In.ReadToEnd()
if (-not $raw) {
  [pscustomobject]@{ success = $false; reason = "no_input" } | ConvertTo-Json -Compress
  exit 0
}

try { $snap = $raw | ConvertFrom-Json } catch {
  [pscustomobject]@{ success = $false; reason = "invalid_json"; error = $_.Exception.Message } | ConvertTo-Json -Compress
  exit 0
}

$dataObj = New-Object System.Windows.Forms.DataObject

try {
  if ($snap.text -ne $null -and ($snap.text.ToString()).Length -gt 0) {
    $dataObj.SetText($snap.text.ToString(), [System.Windows.Forms.TextDataFormat]::UnicodeText)
  }
} catch {}

try {
  if ($snap.rtf -ne $null -and ($snap.rtf.ToString()).Length -gt 0) {
    $dataObj.SetText($snap.rtf.ToString(), [System.Windows.Forms.TextDataFormat]::Rtf)
  }
} catch {}

try {
  if ($snap.html -ne $null -and ($snap.html.ToString()).Length -gt 0) {
    $dataObj.SetText($snap.html.ToString(), [System.Windows.Forms.TextDataFormat]::Html)
  }
} catch {}

try {
  if ($snap.imagePngB64 -ne $null -and ($snap.imagePngB64.ToString()).Length -gt 0) {
    $bytes = [System.Convert]::FromBase64String($snap.imagePngB64.ToString())
    if ($bytes -ne $null -and $bytes.Length -gt 0) {
      $ms = New-Object System.IO.MemoryStream(, $bytes)
      $img = [System.Drawing.Image]::FromStream($ms)
      if ($img -ne $null) {
        $dataObj.SetImage($img)
      }
    }
  }
} catch {}

try {
  [System.Windows.Forms.Clipboard]::SetDataObject($dataObj, $true)
  [pscustomobject]@{ success = $true } | ConvertTo-Json -Compress
} catch {
  [pscustomobject]@{ success = $false; reason = "restore_failed"; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`.trim();

  try {
    const result = await psJson(script, [], {
      sta: true,
      timeoutMs: 20000,
      stdin: JSON.stringify(snapshot),
    });
    return Boolean(result.parsed?.success);
  } catch {
    return false;
  }
}

async function main() {
  assert(process.platform === "win32", "windows_release_gate.js must be run on Windows.");

  const exePathArg = process.argv.slice(2).find((arg) => arg && !arg.startsWith("--"));
  const exePath = exePathArg
    ? path.resolve(exePathArg)
    : path.join(process.cwd(), "dist", "win-unpacked", "OpenWhispr.exe");

  assert(fs.existsSync(exePath), `Packaged app not found: ${exePath}`);

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const port =
    Number(process.env.OPENWHISPR_E2E_CDP_PORT || "") ||
    9222 + Math.floor(Math.random() * 200);

  const env = {
    ...process.env,
    OPENWHISPR_E2E: "1",
    OPENWHISPR_E2E_RUN_ID: runId,
    OPENWHISPR_CHANNEL: process.env.OPENWHISPR_CHANNEL || "staging",
  };

  const originalClipboardSnapshot = await snapshotClipboardForRestore();

  console.log(`[gate] Launching: ${exePath}`);
  console.log(`[gate] CDP port: ${port}`);
  console.log(`[gate] OPENWHISPR_CHANNEL=${env.OPENWHISPR_CHANNEL} OPENWHISPR_E2E_RUN_ID=${runId}`);

  const appProc = spawn(exePath, [`--remote-debugging-port=${port}`], {
    env,
    stdio: "inherit",
  });

  let panel = null;
  let dictation = null;

  const cleanup = async () => {
    try {
      try {
        if (panel) {
          await panel.eval(`(async () => { try { await window.electronAPI?.appQuit?.(); } catch {} return true; })()`);
        } else if (dictation) {
          await dictation.eval(`(async () => { try { await window.electronAPI?.appQuit?.(); } catch {} return true; })()`);
        }
      } catch {
        // ignore
      }

      await Promise.allSettled([panel?.close?.(), dictation?.close?.()]);
      panel = null;
      dictation = null;

      if (!appProc || appProc.exitCode !== null) {
        return;
      }

      await Promise.race([
        new Promise((resolve) => appProc.once("exit", resolve)),
        sleep(7000),
      ]);

      if (appProc.exitCode !== null) {
        return;
      }

      try {
        appProc.kill();
      } catch {
        // ignore
      }

      await Promise.race([
        new Promise((resolve) => appProc.once("exit", resolve)),
        sleep(5000),
      ]);

      if (appProc.exitCode === null) {
        await runPowerShell(
          `
param([Int32]$Pid)
try { Stop-Process -Id $Pid -Force -ErrorAction SilentlyContinue } catch {}
          `.trim(),
          [String(appProc.pid)],
          { timeoutMs: 10000 }
        );
      }
    } catch {
      // ignore
    } finally {
      if (originalClipboardSnapshot) {
        try {
          await restoreClipboardSnapshot(originalClipboardSnapshot);
        } catch {
          // ignore
        }
      }
    }
  };

  const results = [];
  const record = (name, ok, details = "") => {
    results.push({ name, ok: Boolean(ok), details: safeString(details) });
    console.log(`[gate] ${ok ? "PASS" : "FAIL"}: ${name}${details ? ` — ${details}` : ""}`);
  };

  try {
    const versionUrl = `http://127.0.0.1:${port}/json/version`;
    let version = null;
    for (let i = 0; i < 60; i++) {
      try {
        version = await fetchJson(versionUrl, 1000);
        if (version) break;
      } catch {
        // retry
      }
      await sleep(250);
    }

    assert(version, "CDP server did not come up (json/version unavailable).");

    const listUrl = `http://127.0.0.1:${port}/json/list`;
    let targets = [];
    let panelTarget = null;
    let dictationTarget = null;
    for (let i = 0; i < 80; i++) {
      try {
        targets = await fetchJson(listUrl, 1000);
        if (Array.isArray(targets) && targets.length >= 1) {
          panelTarget = targets.find((t) => safeString(t.url).includes("panel=true"));
          dictationTarget = targets.find(
            (t) => t.type === "page" && safeString(t.url) && !safeString(t.url).includes("panel=true")
          );
          if (panelTarget?.webSocketDebuggerUrl && dictationTarget?.webSocketDebuggerUrl) {
            break;
          }
        }
      } catch {
        // retry
      }
      await sleep(250);
    }

    assert(Array.isArray(targets) && targets.length > 0, "No CDP targets found.");
    assert(panelTarget?.webSocketDebuggerUrl, "Control panel target not found (panel=true).");
    assert(dictationTarget?.webSocketDebuggerUrl, "Dictation panel target not found.");

    panel = new CdpClient(panelTarget.webSocketDebuggerUrl);
    dictation = new CdpClient(dictationTarget.webSocketDebuggerUrl);
    await panel.connect();
    await dictation.connect();

    // Skip onboarding in both windows
    const skipOnboarding = async (client) => {
      await client.eval(`
        (function () {
          try {
            localStorage.setItem("onboardingCompleted", "true");
            localStorage.setItem("onboardingCurrentStep", "5");
          } catch {}
          return true;
        })()
      `);
      await client.eval(`location.reload(); true;`);
    };

    await skipOnboarding(panel);
    await skipOnboarding(dictation);

    await panel.waitFor("document.readyState === 'complete'", 15000);
    await dictation.waitFor("document.readyState === 'complete'", 15000);

    // Wait for E2E helper to exist in dictation panel
    await dictation.waitFor("window.__openwhisprE2E && typeof window.__openwhisprE2E.getProgress === 'function'", 15000);

    // A) Verify both hotkeys can be registered (runtime: globalShortcut status)
    const hotkeyStatus = await panel.eval(`
      (async function () {
        if (!window.electronAPI?.e2eGetHotkeyStatus) {
          return { success: false, error: "e2eGetHotkeyStatus unavailable" };
        }
        const candidates = ["F8", "F9", "F10", "F11", "F12", "ScrollLock"];
        let last = null;

        for (const insertHotkey of candidates) {
          try {
            await window.electronAPI.updateHotkey(insertHotkey);
          } catch {}

          for (const clipboardHotkey of candidates) {
            if (clipboardHotkey === insertHotkey) continue;
            try {
              await window.electronAPI.updateClipboardHotkey(clipboardHotkey);
            } catch {}

            await new Promise((r) => setTimeout(r, 600));
            const status = await window.electronAPI.e2eGetHotkeyStatus();
            const ok =
              Boolean(status?.insertGlobalRegistered) &&
              Boolean(status?.clipboardGlobalRegistered) &&
              status?.insertHotkey === insertHotkey &&
              status?.clipboardHotkey === clipboardHotkey;

            last = { chosen: { insertHotkey, clipboardHotkey }, status, ok };
            if (ok) {
              return { success: true, ...last };
            }
          }
        }

        return { success: false, ...last, error: "Failed to register two distinct global hotkeys" };
      })()
    `);
    record(
      "Hotkeys registered (insert+clipboard)",
      Boolean(hotkeyStatus?.success) && Boolean(hotkeyStatus?.ok),
      JSON.stringify({
        success: hotkeyStatus?.success,
        chosen: hotkeyStatus?.chosen,
        ok: hotkeyStatus?.ok,
        status: hotkeyStatus?.status,
        error: hotkeyStatus?.error,
      })
    );

    // A) Push-to-talk: verify Windows native listener can start for BOTH routes when mode=push.
    const pttStatus = await panel.eval(`
      (async function () {
        if (!window.electronAPI?.saveActivationMode) {
          return { success: false, error: "saveActivationMode unavailable" };
        }
        if (!window.electronAPI?.notifyActivationModeChanged) {
          return { success: false, error: "notifyActivationModeChanged unavailable" };
        }
        if (!window.electronAPI?.e2eGetHotkeyStatus) {
          return { success: false, error: "e2eGetHotkeyStatus unavailable" };
        }

        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const setMode = async (mode) => {
          try { await window.electronAPI.saveActivationMode(mode); } catch {}
          try { window.electronAPI.notifyActivationModeChanged(mode); } catch {}
        };

        const waitFor = async (predicate, timeoutMs = 12000) => {
          const startedAt = Date.now();
          let last = null;
          while (Date.now() - startedAt < timeoutMs) {
            try {
              last = await predicate();
              if (last?.ok) return last;
            } catch (e) {
              last = { ok: false, error: (e && e.message) ? e.message : String(e) };
            }
            await sleep(250);
          }
          return last || { ok: false };
        };

        await setMode("push");
        const push = await waitFor(async () => {
          const status = await window.electronAPI.e2eGetHotkeyStatus();
          const ok =
            status?.activationMode === "push" &&
            Boolean(status?.insertUsesNativeListener) &&
            Boolean(status?.clipboardUsesNativeListener) &&
            Boolean(status?.windowsPushToTalkAvailable);
          return {
            ok,
            activationMode: status?.activationMode,
            insertUsesNativeListener: status?.insertUsesNativeListener,
            clipboardUsesNativeListener: status?.clipboardUsesNativeListener,
            windowsPushToTalkAvailable: status?.windowsPushToTalkAvailable,
          };
        }, 15000);

        await setMode("tap");
        const tap = await waitFor(async () => {
          const status = await window.electronAPI.e2eGetHotkeyStatus();
          const ok =
            status?.activationMode === "tap" &&
            Boolean(status?.insertGlobalRegistered) &&
            Boolean(status?.clipboardGlobalRegistered);
          return {
            ok,
            activationMode: status?.activationMode,
            insertGlobalRegistered: status?.insertGlobalRegistered,
            clipboardGlobalRegistered: status?.clipboardGlobalRegistered,
          };
        }, 15000);

        return { success: true, ok: Boolean(push?.ok) && Boolean(tap?.ok), push, tap };
      })()
    `);
    record(
      "Push-to-talk mode uses native listener (both routes)",
      Boolean(pttStatus?.success) && Boolean(pttStatus?.ok),
      JSON.stringify(pttStatus)
    );

    // B) Always-visible status bar
    await dictation.waitForSelector('[data-testid="dictation-status-bar"]', 15000);
    record("Status bar present", true);

    await dictation.eval(`window.__openwhisprE2E.setStage("listening", { stageLabel: "Listening" }); true;`);
    await sleep(250);
    await dictation.eval(`window.__openwhisprE2E.setStage("listening", { stageLabel: "Listening" }); true;`);
    const stageListening = await dictation.eval(
      `document.querySelector('[data-testid="dictation-status-stage"]')?.textContent || ""`
    );
    record("Stage label updates (Listening)", stageListening.trim() === "Listening", stageListening);

    await dictation.eval(`window.__openwhisprE2E.setStage("transcribing", { stageLabel: "Transcribing", generatedWords: 12 }); true;`);
    const stageTranscribing = await dictation.eval(
      `document.querySelector('[data-testid="dictation-status-stage"]')?.textContent || ""`
    );
    record("Stage label updates (Transcribing)", stageTranscribing.trim() === "Transcribing", stageTranscribing);

    // B/G) Regression guard: ensure dictionary prompt-echo heuristic flags obvious prompt output
    const dictTerms = [
      "Hello Cashflow",
      "DbMcp",
      "SlackMcp",
      "MondayMcp",
      "AGENTS.md",
      "Codex",
      "Postgres",
      "TypeScript",
      "OpenWhispr",
      "PowerShell",
    ];
    const dictPrompt = dictTerms.join(", ");
    const echoDetected = await dictation.eval(
      `window.__openwhisprE2E.isLikelyDictionaryPromptEcho(${JSON.stringify(dictPrompt)}, ${JSON.stringify(dictTerms)})`
    );
    record(
      "Dictionary prompt echo guard detects prompt output",
      Boolean(echoDetected) === true,
      `value=${safeString(echoDetected)}`
    );

    const echoFalsePositive = await dictation.eval(
      `window.__openwhisprE2E.isLikelyDictionaryPromptEcho("let's test cloud transcription then shall we", ${JSON.stringify(dictTerms)})`
    );
    record(
      "Dictionary prompt echo guard avoids false positive",
      Boolean(echoFalsePositive) === false,
      `value=${safeString(echoFalsePositive)}`
    );

    // A) Dual output modes + insertion
    let notepad = await startTextTarget();

    const focusTarget = await ensureForegroundWindow(notepad.hwnd, notepad.kind === "notepad" ? "notepad" : "gatepad");
    record(
      `Target foreground (${notepad.kind === "notepad" ? "Notepad" : "GatePad"})`,
      Boolean(focusTarget?.success),
      JSON.stringify(focusTarget?.details || focusTarget)
    );
    assert(focusTarget?.success, "Could not focus the target window. Close interfering windows and re-run the gate without typing.");

    const fgBeforeShow = await getForegroundWindowInfo();
    await dictation.eval(`window.electronAPI.showDictationPanel(); true;`);
    await sleep(250);
    const fgAfterShow = await getForegroundWindowInfo();
    record(
      "No focus-steal on showDictationPanel",
      fgBeforeShow.hwnd === fgAfterShow.hwnd,
      `${fgBeforeShow.processName} -> ${fgAfterShow.processName}`
    );

    const capture = await dictation.eval(`window.electronAPI.captureInsertionTarget()`);
    const expectedHwnd = Number(notepad.hwnd);
    const capturedHwnd = Number(capture?.target?.hwnd || 0);
    const captureOk = Boolean(capture?.success) && capturedHwnd === expectedHwnd;
    record(
      `Capture insertion target (${notepad.kind === "notepad" ? "Notepad" : "GatePad"} foreground)`,
      captureOk,
      JSON.stringify({
        success: capture?.success,
        expectedHwnd,
        capturedHwnd,
        processName: capture?.target?.processName || "",
      })
    );
    assert(
      captureOk,
      `captureInsertionTarget did not match expected foreground window (expected ${expectedHwnd}, got ${capturedHwnd}). Re-run without typing.`
    );

    // A1) Insert-mode: should insert into target when focus is stable
    const insertForegroundText = `E2E InsertForeground ${runId}`;
    const beforeForegroundText = await readEditText(notepad.editHwnd);
    await dictation.eval(`
      (async function () {
        await window.__openwhisprE2E.simulateTranscriptionComplete(
          { text: ${JSON.stringify(insertForegroundText)}, source: "e2e" },
          { outputMode: "insert", sessionId: ${JSON.stringify(`sess-insert-foreground-${runId}`)}, insertionTarget: ${JSON.stringify(capture?.target || null)} }
        );
        return true;
      })()
    `);
    await sleep(300);
    const afterForegroundText = await readEditText(notepad.editHwnd);
    record(
      `Insert mode writes into ${notepad.kind === "notepad" ? "Notepad" : "GatePad"} (foreground stable)`,
      afterForegroundText.includes(insertForegroundText) &&
        afterForegroundText.length > beforeForegroundText.length,
      `len ${beforeForegroundText.length} -> ${afterForegroundText.length}`
    );
    const fgAfterInsert = await getForegroundWindowInfo();
    record(
      "No focus-steal on insert completion",
      fgAfterInsert.hwnd === notepad.hwnd,
      `${fgAfterInsert.processName} (${fgAfterInsert.hwnd})`
    );

    // F) "Remember insertion target": switch focus away before insert, then ensure paste
    // returns to the captured target (best-effort on Windows).
    const decoy = await startGateTextWindow();
    try {
      const decoyFocus = await ensureForegroundWindow(decoy.hwnd, "decoy", 4);
      record(
        "Switch focus away before insert (decoy foreground)",
        Boolean(decoyFocus?.success),
        JSON.stringify(decoyFocus?.details || decoyFocus)
      );

      const insertLockedText = `E2E InsertLocked ${runId}`;
      const beforeLockedText = await readEditText(notepad.editHwnd);

      await dictation.eval(`
        (async function () {
          await window.__openwhisprE2E.simulateTranscriptionComplete(
            { text: ${JSON.stringify(insertLockedText)}, source: "e2e" },
            { outputMode: "insert", sessionId: ${JSON.stringify(`sess-insert-locked-${runId}`)}, insertionTarget: ${JSON.stringify(capture?.target || null)} }
          );
          return true;
        })()
      `);

      const afterInsertText = await readEditText(notepad.editHwnd);
      const insertedIntoTarget =
        afterInsertText.includes(insertLockedText) && afterInsertText.length > beforeLockedText.length;

      let clipboardAfterLocked = "";
      let clipboardHasLockedText = false;
      if (!insertedIntoTarget) {
        clipboardAfterLocked = await getClipboardText();
        clipboardHasLockedText = clipboardAfterLocked.includes(insertLockedText);
      }

      record(
        `Target lock inserts into ${notepad.kind === "notepad" ? "Notepad" : "GatePad"} OR falls back to clipboard`,
        insertedIntoTarget || clipboardHasLockedText,
        `insertedIntoTarget=${insertedIntoTarget} clipboardHasText=${clipboardHasLockedText}`
      );

      const decoyText = await readEditText(decoy.editHwnd);
      record(
        "Target lock does not insert into decoy",
        !decoyText.includes(insertLockedText),
        `len=${decoyText.length}`
      );

      if (!insertedIntoTarget) {
        record(
          "Target lock safe fallback leaves text in clipboard",
          clipboardHasLockedText,
          clipboardAfterLocked.slice(0, 80)
        );
      }
    } finally {
      await closeProcess(decoy.pid);
    }

    const clipText = `E2E Clipboard ${runId}`;
    const notepadTextBeforeClipboardMode = await readEditText(notepad.editHwnd);
    await dictation.eval(`
      (async function () {
        await window.__openwhisprE2E.simulateTranscriptionComplete(
          { text: ${JSON.stringify(clipText)}, source: "e2e" },
          { outputMode: "clipboard", sessionId: ${JSON.stringify(`sess-clip-${runId}`)} }
        );
        return true;
      })()
    `);

    await sleep(700);
    const notepadTextAfterClipboardMode = await readEditText(notepad.editHwnd);
    record(
      "Clipboard mode does not insert",
      notepadTextAfterClipboardMode === notepadTextBeforeClipboardMode,
      `len ${notepadTextBeforeClipboardMode.length} -> ${notepadTextAfterClipboardMode.length}`
    );

    const clipboardNow = await getClipboardText();
    record("Clipboard mode copies to clipboard", clipboardNow.includes(clipText), clipboardNow.slice(0, 80));

    // A/F) Safe fallback if activation fails: insertion does not happen, but clipboard contains text.
    const insertFailText = `E2E InsertFail ${runId}`;
    const beforeFailText = await readEditText(notepad.editHwnd);
    await dictation.eval(`
      (async function () {
        await window.__openwhisprE2E.simulateTranscriptionComplete(
          { text: ${JSON.stringify(insertFailText)}, source: "e2e" },
          { outputMode: "insert", sessionId: ${JSON.stringify(`sess-insert-fail-${runId}`)}, insertionTarget: { hwnd: 1, pid: 0, processName: "invalid", title: "invalid" } }
        );
        return true;
      })()
    `);
    await sleep(900);
    const afterFailText = await readEditText(notepad.editHwnd);
    record(
      "Insert failure does not insert",
      afterFailText === beforeFailText,
      `len ${beforeFailText.length} -> ${afterFailText.length}`
    );
    const clipboardAfterFail = await getClipboardText();
    record(
      "Insert failure leaves text in clipboard",
      clipboardAfterFail.includes(insertFailText),
      clipboardAfterFail.slice(0, 80)
    );

    // G) Clipboard image preservation (insert success path)
    const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    let clipImageBefore = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      clipImageBefore = await setClipboardTestImage();
      const ok =
        Boolean(clipImageBefore?.hasImage) &&
        Number(clipImageBefore?.len || 0) > 0 &&
        safeString(clipImageBefore?.hash) &&
        safeString(clipImageBefore?.hash) !== EMPTY_SHA256;
      if (ok) break;
      await sleep(250);
    }
    const imageHashBefore = clipImageBefore.hash;

    const focusTarget2 = await ensureForegroundWindow(notepad.hwnd, "target-image", 4);
    assert(focusTarget2?.success, "Could not focus the target window for clipboard image test.");

    const capture2 = await dictation.eval(`window.electronAPI.captureInsertionTarget()`);
    const capture2Hwnd = Number(capture2?.target?.hwnd || 0);
    const capture2Ok = Boolean(capture2?.success) && capture2Hwnd === expectedHwnd;
    record(
      "Capture insertion target for image test",
      capture2Ok,
      JSON.stringify({ success: capture2?.success, expectedHwnd, capturedHwnd: capture2Hwnd })
    );
    assert(capture2Ok, `captureInsertionTarget mismatch before clipboard image test (expected ${expectedHwnd}, got ${capture2Hwnd}).`);
    await dictation.eval(`
      (async function () {
        await window.__openwhisprE2E.simulateTranscriptionComplete(
          { text: ${JSON.stringify(`E2E ImagePreserve ${runId}`)}, source: "e2e" },
          { outputMode: "insert", sessionId: ${JSON.stringify(`sess-img-${runId}`)}, insertionTarget: ${JSON.stringify(capture2?.target || null)} }
        );
        return true;
      })()
    `);

    await sleep(2500);
    let clipImageAfter = null;
    let clipAfterAttempt = 0;
    for (let attempt = 1; attempt <= 4; attempt++) {
      clipAfterAttempt = attempt;
      clipImageAfter = await getClipboardImageHash();
      const ok =
        Boolean(clipImageAfter?.hasImage) &&
        Number(clipImageAfter?.len || 0) > 0 &&
        safeString(clipImageAfter?.hash) &&
        safeString(clipImageAfter?.hash) !== EMPTY_SHA256;
      if (ok) break;
      await sleep(350);
    }

    const clipAfterOk =
      Boolean(clipImageAfter?.hasImage) &&
      Number(clipImageAfter?.len || 0) > 0 &&
      safeString(clipImageAfter?.hash) &&
      safeString(clipImageAfter?.hash) !== EMPTY_SHA256;
    record(
      "Clipboard image preserved after insert",
      clipAfterOk && clipImageAfter.hash === imageHashBefore,
      JSON.stringify({
        before: { len: clipImageBefore?.len, hash: imageHashBefore },
        after: { len: clipImageAfter?.len, hash: clipImageAfter?.hash || null },
        attempts: clipAfterAttempt,
      })
    );

    // C/D) History workspace + export
    await panel.waitForSelector('[data-testid="history-search"]', 15000);
    const historyCount = await panel.eval(
      `document.querySelectorAll('[data-testid="transcription-item"]').length`
    );
    record("History renders items", historyCount >= 2, `count=${historyCount}`);

    await panel.setInputValue('[data-testid="history-search"]', "InsertFail");
    await sleep(250);
    const insertFailCount = await panel.eval(
      `document.querySelectorAll('[data-testid="transcription-item"]').length`
    );
    record("History retains text after insert failure", insertFailCount >= 1, `count=${insertFailCount}`);

    await panel.setInputValue('[data-testid="history-search"]', "Clipboard");
    await sleep(250);
    const filteredCount = await panel.eval(
      `document.querySelectorAll('[data-testid="transcription-item"]').length`
    );
    record("History search filters results", filteredCount >= 1 && filteredCount <= historyCount, `count=${filteredCount}`);

    const exportDir = path.join(process.env.TEMP || process.env.TMP || "C:\\\\Windows\\\\Temp", "openwhispr-e2e");
    const exportJsonPath = path.join(exportDir, `transcriptions-${runId}.json`);
    const exportCsvPath = path.join(exportDir, `transcriptions-${runId}.csv`);

    const exportJsonResult = await panel.eval(
      `(async () => window.electronAPI.e2eExportTranscriptions("json", ${JSON.stringify(exportJsonPath)}) )()`
    );
    record("E2E export transcriptions (JSON)", Boolean(exportJsonResult?.success), JSON.stringify(exportJsonResult));

    const exportCsvResult = await panel.eval(
      `(async () => window.electronAPI.e2eExportTranscriptions("csv", ${JSON.stringify(exportCsvPath)}) )()`
    );
    record("E2E export transcriptions (CSV)", Boolean(exportCsvResult?.success), JSON.stringify(exportCsvResult));

    // D) Sanity check export content includes useful diagnostic fields (and no obvious secrets).
    try {
      const exported = JSON.parse(fs.readFileSync(exportJsonPath, "utf8"));
      const rows = Array.isArray(exported) ? exported : [];
      const hasOutputModes = rows.some((r) => r?.outputMode === "insert") && rows.some((r) => r?.outputMode === "clipboard");
      const hasTimingCols = rows.some((r) => typeof r?.totalMs !== "undefined") && rows.some((r) => typeof r?.pasteMs !== "undefined");
      const secretLike = JSON.stringify(rows).includes("sk-");
      record(
        "Export JSON includes diagnostics columns",
        rows.length >= 2 && hasOutputModes && hasTimingCols && !secretLike,
        JSON.stringify({ rows: rows.length, hasOutputModes, hasTimingCols, secretLike })
      );
    } catch (error) {
      record("Export JSON includes diagnostics columns", false, `parse_failed: ${safeString(error?.message || error)}`);
    }

    try {
      const csv = fs.readFileSync(exportCsvPath, "utf8");
      const header = safeString(csv.split(/\r?\n/)[0] || "");
      const required = ["outputMode", "status", "provider", "model", "pasteSucceeded", "totalMs"];
      const missing = required.filter((key) => !header.includes(key));
      record(
        "Export CSV includes diagnostics columns",
        missing.length === 0,
        missing.length === 0 ? header : `missing=${missing.join("|")}`
      );
    } catch (error) {
      record("Export CSV includes diagnostics columns", false, `read_failed: ${safeString(error?.message || error)}`);
    }

    // E) Dictionary batch parsing + merge/replace + export/import (E2E IPC)
    await panel.eval(`
      (function () {
        const openSettings = document.querySelector('button[aria-label="Open settings"]');
        if (!openSettings) throw new Error("Open settings button not found");
        openSettings.click();
        return true;
      })()
    `);
    await panel.waitForSelector('button[data-section-id="dictionary"]', 15000);
    await panel.click('button[data-section-id="dictionary"]');
    await panel.waitForSelector('textarea[placeholder^="Paste one word"]', 15000);

    const batchText = "OpenWhispr\nKubernetes\nopenwhispr\n;Dr. Martinez,  \n\n";
    await panel.setInputValue('textarea[placeholder^="Paste one word"]', batchText);
    await sleep(250);
    const previewText = await panel.eval(`
      (function () {
        const nodes = Array.from(document.querySelectorAll("p"));
        const preview = nodes.find((n) => (n.textContent || "").includes("Preview:"));
        return preview ? preview.textContent : "";
      })()
    `);
    record(
      "Dictionary preview shows dedupe counts",
      safeString(previewText).includes("duplicates removed") && safeString(previewText).includes("1 duplicates removed"),
      safeString(previewText)
    );

    // Apply merge
    await panel.eval(`
      (function () {
        const apply = Array.from(document.querySelectorAll("button")).find((b) =>
          (b.textContent || "").trim().startsWith("Apply ")
        );
        if (!apply) throw new Error("Apply button not found");
        apply.click();
        return true;
      })()
    `);
    await sleep(700);

    const dictWordsAfterMerge = await panel.eval(`(async () => window.electronAPI.getDictionary())()`);
    const dictWordsNormalized = Array.isArray(dictWordsAfterMerge)
      ? dictWordsAfterMerge.map((word) => safeString(word).trim()).filter(Boolean)
      : [];
    record(
      "Dictionary merge writes to DB",
      dictWordsNormalized.length === 3 &&
        dictWordsNormalized.includes("OpenWhispr") &&
        dictWordsNormalized.includes("Kubernetes") &&
        dictWordsNormalized.includes("Dr. Martinez"),
      JSON.stringify(dictWordsAfterMerge)
    );

    // Export dictionary via E2E IPC and round-trip import
    const exportDictPath = path.join(exportDir, `dictionary-${runId}.txt`);
    const exportDictResult = await panel.eval(
      `(async () => window.electronAPI.e2eExportDictionary("txt", ${JSON.stringify(exportDictPath)}) )()`
    );
    record("E2E export dictionary (TXT)", Boolean(exportDictResult?.success), JSON.stringify(exportDictResult));

    const importDictResult = await panel.eval(
      `(async () => window.electronAPI.e2eImportDictionary(${JSON.stringify(exportDictPath)}) )()`
    );
    record("E2E import dictionary (TXT)", Boolean(importDictResult?.success), JSON.stringify(importDictResult));

    if (notepad.kind === "notepad") {
      const allowKillNotepad = isTruthyFlag(process.env.OPENWHISPR_GATE_KILL_NOTEPAD);
      if (allowKillNotepad) {
        await closeProcess(notepad.pid);
        if (
          Number.isInteger(notepad.launcherPid) &&
          notepad.launcherPid &&
          notepad.launcherPid !== notepad.pid
        ) {
          await closeProcess(notepad.launcherPid);
        }
      } else {
        console.warn("[gate] Leaving Notepad open (set OPENWHISPR_GATE_KILL_NOTEPAD=1 to force close).");
      }
    } else if (Number.isFinite(notepad.pid) && notepad.pid > 0) {
      await closeProcess(notepad.pid);
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      console.error("\n[gate] FAILURES:");
      for (const f of failed) {
        console.error(`- ${f.name}${f.details ? ` — ${f.details}` : ""}`);
      }
      process.exitCode = 1;
    } else {
      console.log("\n[gate] ALL CHECKS PASSED");
    }
  } finally {
    await cleanup();
  }

  process.exit(process.exitCode || 0);
}

main().catch((error) => {
  console.error(`[gate] ERROR: ${error.message}`);
  process.exit(1);
});
