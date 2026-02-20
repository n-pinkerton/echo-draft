function normalizeClipboardAccelerator(hotkey) {
  const trimmed = String(hotkey || "").trim();
  return trimmed.startsWith("Fn+") ? trimmed.slice(3) : trimmed;
}

function unregisterClipboardHotkey(manager, { globalShortcut } = {}) {
  if (!manager.registeredClipboardAccelerator) {
    return;
  }
  try {
    globalShortcut.unregister(manager.registeredClipboardAccelerator);
  } catch {
    // Ignore unregister errors
  }
  manager.registeredClipboardAccelerator = null;
}

function registerClipboardHotkeyInternal(manager, hotkey, { globalShortcut } = {}) {
  if (!hotkey || !String(hotkey).trim()) {
    return { success: false, message: "Please enter a valid clipboard hotkey." };
  }

  const trimmedHotkey = String(hotkey).trim();
  if (trimmedHotkey === manager.hotkeyManager.getCurrentHotkey()) {
    return {
      success: false,
      message: "Insert and Clipboard hotkeys must be different.",
    };
  }

  unregisterClipboardHotkey(manager, { globalShortcut });

  if (!manager.canRegisterClipboardWithGlobalShortcut(trimmedHotkey)) {
    manager.currentClipboardHotkey = trimmedHotkey;
    return { success: true, hotkey: trimmedHotkey };
  }

  const accelerator = normalizeClipboardAccelerator(trimmedHotkey);
  const callback = manager.getClipboardHotkeyCallback();
  const registered = globalShortcut.register(accelerator, callback);
  if (!registered) {
    return {
      success: false,
      message: `Could not register "${trimmedHotkey}". It may be in use by another application.`,
    };
  }

  manager.currentClipboardHotkey = trimmedHotkey;
  manager.registeredClipboardAccelerator = accelerator;
  return { success: true, hotkey: trimmedHotkey };
}

async function persistClipboardHotkey(manager, hotkey) {
  process.env.DICTATION_KEY_CLIPBOARD = hotkey;

  try {
    const EnvironmentManager = require("../environment");
    const envManager = new EnvironmentManager();
    envManager.saveClipboardDictationKey(hotkey);
  } catch {
    // Ignore persistence errors
  }

  if (manager.mainWindow && !manager.mainWindow.isDestroyed()) {
    const escapedHotkey = hotkey.replace(/\\/g, "\\\\").replace(/\"/g, '\\"');
    await manager.mainWindow.webContents.executeJavaScript(
      `localStorage.setItem("dictationKeyClipboard", "${escapedHotkey}"); true;`
    );
  }
}

async function initializeClipboardHotkey(
  manager,
  { defaultHotkey, globalShortcut } = {}
) {
  let savedHotkey = process.env.DICTATION_KEY_CLIPBOARD || "";

  if (!savedHotkey && manager.mainWindow && !manager.mainWindow.isDestroyed()) {
    try {
      savedHotkey = await manager.mainWindow.webContents.executeJavaScript(`
          localStorage.getItem("dictationKeyClipboard") || ""
        `);
    } catch {
      savedHotkey = "";
    }
  }

  const desiredHotkey =
    savedHotkey && savedHotkey.trim() ? savedHotkey.trim() : defaultHotkey;
  const registrationResult = registerClipboardHotkeyInternal(manager, desiredHotkey, {
    globalShortcut,
  });
  if (registrationResult.success) {
    await persistClipboardHotkey(manager, desiredHotkey);
    return registrationResult;
  }

  const fallbackHotkeys = [defaultHotkey, "F9", "Alt+F7"];
  for (const fallback of fallbackHotkeys) {
    if (!fallback || fallback === desiredHotkey) continue;
    const fallbackResult = registerClipboardHotkeyInternal(manager, fallback, {
      globalShortcut,
    });
    if (fallbackResult.success) {
      await persistClipboardHotkey(manager, fallback);
      return fallbackResult;
    }
  }

  return registrationResult;
}

async function updateClipboardHotkey(manager, hotkey, { globalShortcut } = {}) {
  const previousHotkey = manager.currentClipboardHotkey;
  const result = registerClipboardHotkeyInternal(manager, hotkey, { globalShortcut });

  if (!result.success) {
    if (previousHotkey) {
      registerClipboardHotkeyInternal(manager, previousHotkey, { globalShortcut });
    }
    return result;
  }

  await persistClipboardHotkey(manager, manager.currentClipboardHotkey);
  return {
    success: true,
    message: `Clipboard hotkey updated to: ${manager.currentClipboardHotkey}`,
  };
}

module.exports = {
  initializeClipboardHotkey,
  normalizeClipboardAccelerator,
  persistClipboardHotkey,
  registerClipboardHotkeyInternal,
  unregisterClipboardHotkey,
  updateClipboardHotkey,
};

