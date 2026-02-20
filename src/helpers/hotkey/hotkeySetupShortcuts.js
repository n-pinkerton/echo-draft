const { getFailureReason } = require("./hotkeyFailureReason");
const { isModifierOnlyHotkey, isRightSideModifier } = require("./hotkeyPatterns");

function restorePreviousHotkey(previousHotkey, callback, { globalShortcut, debugLogger } = {}) {
  if (
    !previousHotkey ||
    previousHotkey === "GLOBE" ||
    isRightSideModifier(previousHotkey) ||
    isModifierOnlyHotkey(previousHotkey)
  ) {
    return;
  }

  const prevAccel = previousHotkey.startsWith("Fn+") ? previousHotkey.slice(3) : previousHotkey;
  try {
    const restored = globalShortcut.register(prevAccel, callback);
    if (restored) {
      debugLogger?.log?.(
        `[HotkeyManager] Restored previous hotkey "${previousHotkey}" after failed registration`
      );
    } else {
      debugLogger?.warn?.(`[HotkeyManager] Could not restore previous hotkey "${previousHotkey}"`);
    }
  } catch (err) {
    debugLogger?.warn?.(
      `[HotkeyManager] Exception restoring previous hotkey "${previousHotkey}": ${err.message}`
    );
  }
}

function setupShortcuts(
  manager,
  hotkey = "Control+Super",
  callback,
  { globalShortcut, debugLogger, platform = process.platform } = {}
) {
  if (!callback) {
    throw new Error("Callback function is required for hotkey setup");
  }

  debugLogger?.log?.(`[HotkeyManager] Setting up hotkey: "${hotkey}"`);
  debugLogger?.log?.(`[HotkeyManager] Platform: ${platform}, Arch: ${process.arch}`);
  debugLogger?.log?.(`[HotkeyManager] Current hotkey: "${manager.currentHotkey}"`);

  // If we're already using this hotkey AND it's actually registered, return success
  // Note: We need to check isRegistered because on first run, currentHotkey is set to the
  // default value but it's not actually registered yet.
  const checkAccelerator = hotkey.startsWith("Fn+") ? hotkey.slice(3) : hotkey;
  if (
    hotkey === manager.currentHotkey &&
    hotkey !== "GLOBE" &&
    !isRightSideModifier(hotkey) &&
    !isModifierOnlyHotkey(hotkey) &&
    globalShortcut.isRegistered(checkAccelerator)
  ) {
    debugLogger?.log?.(
      `[HotkeyManager] Hotkey "${hotkey}" is already the current hotkey and registered, no change needed`
    );
    return { success: true, hotkey };
  }

  const previousHotkey = manager.currentHotkey;

  // Unregister the previous hotkey (skip native-listener-only hotkeys)
  if (
    manager.currentHotkey &&
    manager.currentHotkey !== "GLOBE" &&
    !isRightSideModifier(manager.currentHotkey) &&
    !isModifierOnlyHotkey(manager.currentHotkey)
  ) {
    const prevAccelerator = manager.currentHotkey.startsWith("Fn+")
      ? manager.currentHotkey.slice(3)
      : manager.currentHotkey;
    try {
      debugLogger?.log?.(`[HotkeyManager] Unregistering previous hotkey: "${prevAccelerator}"`);
      globalShortcut.unregister(prevAccelerator);
    } catch (error) {
      debugLogger?.warn?.(
        `[HotkeyManager] Skipping previous hotkey unregister for non-accelerator "${prevAccelerator}": ${error.message}`
      );
    }
  }

  try {
    if (hotkey === "GLOBE") {
      if (platform !== "darwin") {
        debugLogger?.log?.("[HotkeyManager] GLOBE key rejected - not on macOS");
        return {
          success: false,
          error: "The Globe key is only available on macOS.",
        };
      }
      manager.currentHotkey = hotkey;
      debugLogger?.log?.("[HotkeyManager] GLOBE key set successfully");
      return { success: true, hotkey };
    }

    // Right-side single modifiers are handled by native listeners (Swift/C), not globalShortcut
    if (isRightSideModifier(hotkey)) {
      manager.currentHotkey = hotkey;
      debugLogger?.log?.(
        `[HotkeyManager] Right-side modifier "${hotkey}" set - using native listener`
      );
      return { success: true, hotkey };
    }

    // Modifier-only combos use the native keyboard hook on Windows
    if (isModifierOnlyHotkey(hotkey) && platform === "win32") {
      manager.currentHotkey = hotkey;
      debugLogger?.log?.(
        `[HotkeyManager] Modifier-only "${hotkey}" set - using Windows native listener`
      );
      return { success: true, hotkey };
    }

    // Fn+ prefix is a UI-level distinction (user holds Fn to get real F-keys on macOS).
    // At the OS/Electron level, the accelerator is just the key without Fn.
    const accelerator = hotkey.startsWith("Fn+") ? hotkey.slice(3) : hotkey;

    const alreadyRegistered = globalShortcut.isRegistered(accelerator);
    debugLogger?.log?.(`[HotkeyManager] Is "${accelerator}" already registered? ${alreadyRegistered}`);

    if (platform === "linux") {
      globalShortcut.unregister(accelerator);
    }

    const success = globalShortcut.register(accelerator, callback);
    debugLogger?.log?.(`[HotkeyManager] Registration result for "${hotkey}": ${success}`);

    if (success) {
      manager.currentHotkey = hotkey;
      debugLogger?.log?.(`[HotkeyManager] Hotkey "${hotkey}" registered successfully`);
      return { success: true, hotkey };
    }

    const failureInfo = getFailureReason(accelerator, { globalShortcut, platform });
    // eslint-disable-next-line no-console
    console.error(`[HotkeyManager] Failed to register hotkey: ${hotkey}`, failureInfo);
    debugLogger?.log?.(`[HotkeyManager] Registration failed:`, failureInfo);

    restorePreviousHotkey(previousHotkey, callback, { globalShortcut, debugLogger });

    let errorMessage = failureInfo.message;
    if (failureInfo.suggestions.length > 0) {
      errorMessage += ` Try: ${failureInfo.suggestions.join(", ")}`;
    }

    return {
      success: false,
      error: errorMessage,
      reason: failureInfo.reason,
      suggestions: failureInfo.suggestions,
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[HotkeyManager] Error setting up shortcuts:", error);
    debugLogger?.log?.(`[HotkeyManager] Exception during registration:`, error.message);
    restorePreviousHotkey(previousHotkey, callback, { globalShortcut, debugLogger });
    return { success: false, error: error.message };
  }
}

module.exports = {
  restorePreviousHotkey,
  setupShortcuts,
};

