const childProcess = require("child_process");
const debugLogger = require("../debugLogger");

const PIN_CONFIRMED = Symbol("echoDraftControlPanelPinned");

const getWindowHandle = (browserWindow) => {
  const nativeHandle = browserWindow?.getNativeWindowHandle?.();
  if (!Buffer.isBuffer(nativeHandle) || nativeHandle.length < 4) return null;
  const value =
    nativeHandle.length >= 8
      ? nativeHandle.readBigUInt64LE(0)
      : BigInt(nativeHandle.readUInt32LE(0));
  return value > 0n ? value.toString() : null;
};

const buildPinScript = (handle) => `
$ErrorActionPreference = 'Stop'
Import-Module VirtualDesktop -ErrorAction Stop -WarningAction SilentlyContinue
$hwnd = [IntPtr][Int64]${handle}
$pinned = [bool](Test-WindowPinned -Hwnd $hwnd -ErrorAction SilentlyContinue)
if (-not $pinned) {
  Pin-Window -Hwnd $hwnd -ErrorAction Stop
  $pinned = [bool](Test-WindowPinned -Hwnd $hwnd -ErrorAction SilentlyContinue)
}
if (-not $pinned) { throw 'Virtual desktop pin could not be confirmed.' }
Write-Output 'PINNED'
`;

const runPowerShell = (script, execFile = childProcess.execFile) =>
  new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve(String(stdout || ""));
      }
    );
  });

async function pinWindowToAllVirtualDesktops(
  browserWindow,
  { platform = process.platform, execFile = childProcess.execFile, logger = debugLogger } = {}
) {
  if (!browserWindow || browserWindow.isDestroyed?.()) {
    return { success: false, error: "Control panel window is unavailable" };
  }
  if (browserWindow[PIN_CONFIRMED]) return { success: true, cached: true };

  if (platform !== "win32") {
    browserWindow.setVisibleOnAllWorkspaces?.(true);
    browserWindow[PIN_CONFIRMED] = true;
    return { success: true };
  }

  const handle = getWindowHandle(browserWindow);
  if (!handle) return { success: false, error: "Control panel window handle is unavailable" };

  try {
    const output = await runPowerShell(buildPinScript(handle), execFile);
    if (!output.includes("PINNED")) {
      throw new Error("Virtual desktop pin was not confirmed");
    }
    browserWindow[PIN_CONFIRMED] = true;
    logger?.info?.("Control panel pinned to all Windows virtual desktops", { handle });
    return { success: true };
  } catch (error) {
    logger?.warn?.("Could not pin the control panel to all Windows virtual desktops", {
      error: error?.message || String(error),
    });
    return { success: false, error: error?.message || String(error) };
  }
}

module.exports = {
  buildPinScript,
  getWindowHandle,
  pinWindowToAllVirtualDesktops,
};
