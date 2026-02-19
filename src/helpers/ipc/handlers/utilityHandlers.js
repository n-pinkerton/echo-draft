const AppUtils = require("../../../utils");
const debugLogger = require("../../debugLogger");
const GnomeShortcutManager = require("../../gnomeShortcut");

function registerUtilityHandlers(
  { ipcMain, shell },
  { windowManager, windowsKeyManager }
) {
  ipcMain.handle("cleanup-app", async () => {
    AppUtils.cleanup(windowManager.mainWindow);
    return { success: true, message: "Cleanup completed successfully" };
  });

  ipcMain.handle("update-hotkey", async (_event, hotkey) => {
    return await windowManager.updateHotkey(hotkey);
  });

  ipcMain.handle("update-clipboard-hotkey", async (_event, hotkey) => {
    return await windowManager.updateClipboardHotkey(hotkey);
  });

  ipcMain.handle(
    "set-hotkey-listening-mode",
    async (_event, enabled, newHotkey = null, target = "insert") => {
      windowManager.setHotkeyListeningMode(enabled);
      const hotkeyManager = windowManager.hotkeyManager;
      const currentInsertHotkey = hotkeyManager.getCurrentHotkey();
      const currentClipboardHotkey = windowManager.getCurrentClipboardHotkey?.();

      // When exiting capture mode with a new hotkey, use that to avoid reading stale state
      const effectiveInsertHotkey =
        !enabled && target === "insert" && newHotkey ? newHotkey : currentInsertHotkey;
      const effectiveClipboardHotkey =
        !enabled && target === "clipboard" && newHotkey ? newHotkey : currentClipboardHotkey;

      const { isModifierOnlyHotkey, isRightSideModifier } = require("../../hotkeyManager");
      const usesNativeListener = (hotkey) =>
        !hotkey ||
        hotkey === "GLOBE" ||
        isModifierOnlyHotkey(hotkey) ||
        isRightSideModifier(hotkey);

      if (enabled) {
        // Entering capture mode - unregister globalShortcut so it doesn't consume key events
        if (currentInsertHotkey && !usesNativeListener(currentInsertHotkey)) {
          debugLogger.log(
            `[IPC] Unregistering globalShortcut \"${currentInsertHotkey}\" for hotkey capture mode`
          );
          const { globalShortcut } = require("electron");
          const accel = currentInsertHotkey.startsWith("Fn+")
            ? currentInsertHotkey.slice(3)
            : currentInsertHotkey;
          globalShortcut.unregister(accel);
        }

        if (currentClipboardHotkey && !usesNativeListener(currentClipboardHotkey)) {
          debugLogger.log(
            `[IPC] Unregistering clipboard globalShortcut \"${currentClipboardHotkey}\" for hotkey capture mode`
          );
          const { globalShortcut } = require("electron");
          const accel = currentClipboardHotkey.startsWith("Fn+")
            ? currentClipboardHotkey.slice(3)
            : currentClipboardHotkey;
          globalShortcut.unregister(accel);
        }

        // On Windows, stop native listeners during capture.
        if (process.platform === "win32" && windowsKeyManager) {
          debugLogger.log("[IPC] Stopping Windows key listeners for hotkey capture mode");
          windowsKeyManager.stop();
        }

        // On GNOME Wayland, unregister the keybinding during capture.
        if (hotkeyManager.isUsingGnome() && hotkeyManager.gnomeManager) {
          debugLogger.log("[IPC] Unregistering GNOME keybinding for hotkey capture mode");
          await hotkeyManager.gnomeManager.unregisterKeybinding().catch((err) => {
            debugLogger.warn("[IPC] Failed to unregister GNOME keybinding:", err.message);
          });
        }
      } else {
        // Exiting capture mode - re-register insert hotkey if needed.
        if (effectiveInsertHotkey && !usesNativeListener(effectiveInsertHotkey)) {
          const { globalShortcut } = require("electron");
          const accelerator = effectiveInsertHotkey.startsWith("Fn+")
            ? effectiveInsertHotkey.slice(3)
            : effectiveInsertHotkey;
          if (!globalShortcut.isRegistered(accelerator)) {
            debugLogger.log(
              `[IPC] Re-registering globalShortcut \"${accelerator}\" after capture mode`
            );
            const callback = windowManager.createHotkeyCallback("insert", () =>
              windowManager.hotkeyManager.getCurrentHotkey()
            );
            const registered = globalShortcut.register(accelerator, callback);
            if (!registered) {
              debugLogger.warn(
                `[IPC] Failed to re-register globalShortcut \"${accelerator}\" after capture mode`
              );
            }
          }
        }

        // Re-register clipboard hotkey if needed.
        if (effectiveClipboardHotkey && !usesNativeListener(effectiveClipboardHotkey)) {
          const { globalShortcut } = require("electron");
          const accelerator = effectiveClipboardHotkey.startsWith("Fn+")
            ? effectiveClipboardHotkey.slice(3)
            : effectiveClipboardHotkey;
          if (!globalShortcut.isRegistered(accelerator)) {
            debugLogger.log(
              `[IPC] Re-registering clipboard globalShortcut \"${accelerator}\" after capture mode`
            );
            const callback = windowManager.getClipboardHotkeyCallback();
            const registered = globalShortcut.register(accelerator, callback);
            if (!registered) {
              debugLogger.warn(
                `[IPC] Failed to re-register clipboard globalShortcut \"${accelerator}\" after capture mode`
              );
            }
          }
        }

        if (process.platform === "win32" && windowsKeyManager) {
          const activationMode = await windowManager.getActivationMode();
          debugLogger.log(
            `[IPC] Exiting hotkey capture mode, activationMode=\"${activationMode}\", insert=\"${effectiveInsertHotkey}\", clipboard=\"${effectiveClipboardHotkey}\"`
          );

          windowsKeyManager.stop();

          const needsInsertListener =
            effectiveInsertHotkey &&
            windowManager.shouldUseWindowsNativeListener(effectiveInsertHotkey, activationMode);
          const needsClipboardListener =
            effectiveClipboardHotkey &&
            windowManager.shouldUseWindowsNativeListener(effectiveClipboardHotkey, activationMode);

          if (needsInsertListener) {
            debugLogger.log(
              `[IPC] Restarting Windows key listener for insert hotkey: ${effectiveInsertHotkey}`
            );
            windowsKeyManager.start(effectiveInsertHotkey, "insert");
          }
          if (
            needsClipboardListener &&
            effectiveClipboardHotkey &&
            effectiveClipboardHotkey !== effectiveInsertHotkey
          ) {
            debugLogger.log(
              `[IPC] Restarting Windows key listener for clipboard hotkey: ${effectiveClipboardHotkey}`
            );
            windowsKeyManager.start(effectiveClipboardHotkey, "clipboard");
          }
        }

        // On GNOME Wayland, re-register the keybinding with the insert hotkey.
        if (hotkeyManager.isUsingGnome() && hotkeyManager.gnomeManager && effectiveInsertHotkey) {
          const gnomeHotkey = GnomeShortcutManager.convertToGnomeFormat(effectiveInsertHotkey);
          debugLogger.log(
            `[IPC] Re-registering GNOME keybinding \"${gnomeHotkey}\" after capture mode`
          );
          const success = await hotkeyManager.gnomeManager.registerKeybinding(gnomeHotkey);
          if (success) {
            hotkeyManager.currentHotkey = effectiveInsertHotkey;
          }
        }
      }

      return { success: true };
    }
  );

  ipcMain.handle("get-hotkey-mode-info", async () => {
    return {
      isUsingGnome: windowManager.isUsingGnomeHotkeys(),
    };
  });

  ipcMain.handle("start-window-drag", async () => {
    return await windowManager.startWindowDrag();
  });

  ipcMain.handle("stop-window-drag", async () => {
    return await windowManager.stopWindowDrag();
  });

  ipcMain.handle("open-external", async (_event, url) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registerUtilityHandlers };

