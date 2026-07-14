const GnomeShortcutManager = require("../gnomeShortcut");
const debugLogger = require("../debugLogger");
const { isModifierOnlyHotkey, isRightSideModifier } = require("../hotkeyManager");

const normalizeAccelerator = (hotkey) => (hotkey?.startsWith("Fn+") ? hotkey.slice(3) : hotkey);

const usesDedicatedNativeListener = (hotkey) =>
  !hotkey || hotkey === "GLOBE" || isModifierOnlyHotkey(hotkey) || isRightSideModifier(hotkey);

function unregisterCaptureConflict(globalShortcut, hotkey, label) {
  if (!hotkey || usesDedicatedNativeListener(hotkey)) return;
  const accelerator = normalizeAccelerator(hotkey);
  debugLogger.log(`[IPC] Unregistering ${label} globalShortcut "${accelerator}" for capture mode`);
  globalShortcut?.unregister?.(accelerator);
}

function registerGlobalHotkey(globalShortcut, windowManager, hotkey, routeId) {
  if (!hotkey || usesDedicatedNativeListener(hotkey)) return;
  const accelerator = normalizeAccelerator(hotkey);
  if (globalShortcut?.isRegistered?.(accelerator)) return;

  const callback =
    routeId === "clipboard"
      ? windowManager.getClipboardHotkeyCallback()
      : windowManager.createHotkeyCallback("insert", () =>
          windowManager.hotkeyManager.getCurrentHotkey()
        );
  const registered = globalShortcut?.register?.(accelerator, callback) === true;
  if (!registered) {
    debugLogger.warn(`[IPC] Failed to re-register globalShortcut "${accelerator}" after capture`);
  }
}

async function setHotkeyCaptureMode(
  { enabled, newHotkey = null, target = "insert" },
  { windowManager, windowsKeyManager, globalShortcut, platform = process.platform }
) {
  const hotkeyManager = windowManager.hotkeyManager;
  windowManager.setHotkeyListeningMode(enabled);

  const currentInsertHotkey = hotkeyManager.getCurrentHotkey();
  const currentClipboardHotkey = windowManager.getCurrentClipboardHotkey?.();
  const effectiveInsertHotkey =
    !enabled && target === "insert" && newHotkey ? newHotkey : currentInsertHotkey;
  const effectiveClipboardHotkey =
    !enabled && target === "clipboard" && newHotkey ? newHotkey : currentClipboardHotkey;

  if (enabled) {
    // Block new starts first, then stop any tap or push recording before removing shortcut
    // ownership. Renderer stop handling resolves the active session, so one route-safe payload
    // also covers a recording that was started from the other output mode.
    const safetyPayload = windowManager.createSessionPayload?.(
      target === "clipboard" ? "clipboard" : "insert"
    ) || {
      outputMode: target === "clipboard" ? "clipboard" : "insert",
    };
    windowManager.sendStopDictation?.({
      ...safetyPayload,
      forcedStopReason: "hotkey-capture",
    });

    if (platform === "win32") {
      const controller = windowManager.getWindowsHotkeyController?.();
      if (controller?.refreshWindowsKeyListeners) {
        await controller.refreshWindowsKeyListeners({ reason: "hotkey-capture-enter" });
      } else {
        // If startup ordering ever regresses, fail closed and never create a native listener here.
        await windowsKeyManager?.stopAndWait?.();
      }
    }

    unregisterCaptureConflict(globalShortcut, currentInsertHotkey, "insert");
    unregisterCaptureConflict(globalShortcut, currentClipboardHotkey, "clipboard");

    if (hotkeyManager.isUsingGnome() && hotkeyManager.gnomeManager) {
      await hotkeyManager.gnomeManager.unregisterKeybinding().catch((error) => {
        debugLogger.warn("[IPC] Failed to unregister GNOME keybinding", {
          error: error?.message,
        });
      });
    }

    return { success: true };
  }

  if (platform === "win32") {
    // The controller reads the manager's accepted value. Never start from newHotkey: that
    // candidate may have failed validation or registration.
    const controller = windowManager.getWindowsHotkeyController?.();
    let registrations;
    try {
      registrations = await windowManager.recoverHotkeys?.();
      if (registrations?.insert?.success === false && !registrations.insert.skipped) {
        windowManager.onInsertHotkeyRegistrationFailure?.(registrations.insert);
      }
      if (registrations?.clipboard?.success === false && !registrations.clipboard.skipped) {
        windowManager.onClipboardHotkeyRegistrationFailure?.(registrations.clipboard);
      }
    } finally {
      await controller?.refreshWindowsKeyListeners?.({ reason: "hotkey-capture-exit" });
    }
    return { success: true, registrations };
  }

  registerGlobalHotkey(globalShortcut, windowManager, effectiveInsertHotkey, "insert");
  registerGlobalHotkey(globalShortcut, windowManager, effectiveClipboardHotkey, "clipboard");

  if (hotkeyManager.isUsingGnome() && hotkeyManager.gnomeManager && effectiveInsertHotkey) {
    const gnomeHotkey = GnomeShortcutManager.convertToGnomeFormat(effectiveInsertHotkey);
    const success = await hotkeyManager.gnomeManager.registerKeybinding(gnomeHotkey);
    if (success) hotkeyManager.currentHotkey = effectiveInsertHotkey;
  }

  return { success: true };
}

module.exports = {
  setHotkeyCaptureMode,
};
