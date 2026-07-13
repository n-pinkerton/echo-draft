const childProcess = require("child_process");
const debugLogger = require("../debugLogger");

let windowsComUnavailable = false;

const getWindowHandle = (browserWindow) => {
  const nativeHandle = browserWindow?.getNativeWindowHandle?.();
  if (!Buffer.isBuffer(nativeHandle) || nativeHandle.length < 4) return null;
  const value =
    nativeHandle.length >= 8
      ? nativeHandle.readBigUInt64LE(0)
      : BigInt(nativeHandle.readUInt32LE(0));
  return value > 0n ? value.toString() : null;
};

const buildCurrentDesktopCheckScript = (handle) => `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class EchoDraftVirtualDesktop {
  [ComImport]
  [Guid("A5CD92FF-29BE-454C-8D04-D82879FB3F1B")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IVirtualDesktopManager {
    [PreserveSig] int IsWindowOnCurrentVirtualDesktop(IntPtr topLevelWindow, out int onCurrentDesktop);
    [PreserveSig] int GetWindowDesktopId(IntPtr topLevelWindow, out Guid desktopId);
    [PreserveSig] int MoveWindowToDesktop(IntPtr topLevelWindow, ref Guid desktopId);
  }

  public static bool IsOnCurrentDesktop(long targetValue) {
    Type managerType = Type.GetTypeFromCLSID(
      new Guid("AA509086-5CA9-4C25-8F95-589D3C07B48A"),
      true
    );
    object instance = Activator.CreateInstance(managerType);
    try {
      IVirtualDesktopManager manager = (IVirtualDesktopManager)instance;
      IntPtr target = new IntPtr(targetValue);
      int isCurrent;
      Marshal.ThrowExceptionForHR(manager.IsWindowOnCurrentVirtualDesktop(target, out isCurrent));
      return isCurrent != 0;
    } finally {
      if (instance != null && Marshal.IsComObject(instance)) Marshal.FinalReleaseComObject(instance);
    }
  }
}
'@
$isCurrent = [EchoDraftVirtualDesktop]::IsOnCurrentDesktop([Int64]${handle})
if ($isCurrent) { Write-Output 'CURRENT' } else { Write-Output 'OTHER' }
`;

const runPowerShell = (script, execFile = childProcess.execFile) =>
  new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 2000, maxBuffer: 64 * 1024 },
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

async function moveWindowToCurrentVirtualDesktop(
  browserWindow,
  { platform = process.platform, execFile = childProcess.execFile, logger = debugLogger } = {}
) {
  if (!browserWindow || browserWindow.isDestroyed?.()) {
    return { success: false, error: "Window is unavailable" };
  }

  if (platform !== "win32") {
    browserWindow.setVisibleOnAllWorkspaces?.(true);
    return { success: true, mode: "all-workspaces" };
  }

  if (windowsComUnavailable) {
    return { success: false, unsupported: true, error: "Windows virtual desktops are unavailable" };
  }

  const handle = getWindowHandle(browserWindow);
  if (!handle) return { success: false, error: "Window handle is unavailable" };

  try {
    const output = await runPowerShell(buildCurrentDesktopCheckScript(handle), execFile);
    if (output.includes("CURRENT")) {
      return { success: true, mode: "already-current" };
    }
    if (output.includes("OTHER")) {
      logger?.info?.("Window belongs to another Windows virtual desktop", { handle });
      return {
        success: false,
        needsRecreate: true,
        mode: "different-desktop",
        error: "Window belongs to another virtual desktop",
      };
    }
    throw new Error("Virtual desktop status was not confirmed");
  } catch (error) {
    const detail = `${error?.message || String(error)} ${error?.stderr || ""}`;
    if (/80040154|class not registered|REGDB_E_CLASSNOTREG/i.test(detail)) {
      windowsComUnavailable = true;
    }
    logger?.warn?.("Could not move a window to the active Windows virtual desktop", {
      error: error?.message || String(error),
      unsupported: windowsComUnavailable,
    });
    return {
      success: false,
      unsupported: windowsComUnavailable,
      error: error?.message || String(error),
    };
  }
}

const resetWindowsVirtualDesktopSupportForTests = () => {
  windowsComUnavailable = false;
};

const shouldRecreateExistingWindow = (result, platform = process.platform) =>
  platform === "win32" && result?.success !== true;

module.exports = {
  buildCurrentDesktopCheckScript,
  getWindowHandle,
  moveWindowToCurrentVirtualDesktop,
  pinWindowToAllVirtualDesktops: moveWindowToCurrentVirtualDesktop,
  resetWindowsVirtualDesktopSupportForTests,
  shouldRecreateExistingWindow,
};
