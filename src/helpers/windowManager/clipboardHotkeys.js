const {
  getControlPanelShortcutConflict,
  isControlPanelShortcut,
} = require("../app/controlPanelShortcutPolicy");

const CLIPBOARD_REGISTRATION_RETRY_DELAY_MS = 1_000;
const MAX_CLIPBOARD_REGISTRATION_RETRIES = 2;

function clearClipboardRegistrationRetry(manager) {
  if (manager.clipboardHotkeyRetryTimer) {
    clearTimeout(manager.clipboardHotkeyRetryTimer);
    manager.clipboardHotkeyRetryTimer = null;
  }
}

function reportPersistentClipboardRegistrationFailure(manager, failure) {
  manager.clipboardHotkeyRegistrationFailure = failure;
  const logger = manager.debugLogger || manager.logger;
  logger?.error?.("Clipboard hotkey registration failed after bounded retries", {
    hotkey: failure.hotkey,
    attempts: failure.attempts,
  });
  manager.onClipboardHotkeyRegistrationFailure?.(failure);
}

function scheduleClipboardRegistrationRetry(manager, hotkey, { globalShortcut } = {}) {
  clearClipboardRegistrationRetry(manager);
  manager.clipboardHotkeyRetryAttempts = Number(manager.clipboardHotkeyRetryAttempts || 0);

  const retry = () => {
    manager.clipboardHotkeyRetryTimer = null;
    manager.clipboardHotkeyRetryAttempts += 1;
    const result = registerClipboardHotkeyInternal(manager, hotkey, {
      globalShortcut,
      scheduleRetry: false,
    });
    if (result.success) {
      manager.clipboardHotkeyRetryAttempts = 0;
      manager.clipboardHotkeyRegistrationFailure = null;
      return;
    }
    if (manager.clipboardHotkeyRetryAttempts < MAX_CLIPBOARD_REGISTRATION_RETRIES) {
      manager.clipboardHotkeyRetryTimer = setTimeout(retry, CLIPBOARD_REGISTRATION_RETRY_DELAY_MS);
      return;
    }
    reportPersistentClipboardRegistrationFailure(manager, {
      hotkey,
      attempts: manager.clipboardHotkeyRetryAttempts,
      message: result.message,
    });
  };

  manager.clipboardHotkeyRetryTimer = setTimeout(retry, CLIPBOARD_REGISTRATION_RETRY_DELAY_MS);
}

function normalizeClipboardAccelerator(hotkey) {
  const trimmed = String(hotkey || "").trim();
  return trimmed.startsWith("Fn+") ? trimmed.slice(3) : trimmed;
}

function unregisterClipboardHotkey(manager, { globalShortcut } = {}) {
  clearClipboardRegistrationRetry(manager);
  if (!manager.registeredClipboardAccelerator) {
    return;
  }
  try {
    globalShortcut.unregister(manager.registeredClipboardAccelerator);
  } catch {
    return;
  }
  manager.registeredClipboardAccelerator = null;
}

function registerClipboardHotkeyInternal(
  manager,
  hotkey,
  { globalShortcut, scheduleRetry = true } = {}
) {
  if (!hotkey || !String(hotkey).trim()) {
    return { success: false, message: "Please enter a valid clipboard hotkey." };
  }

  const trimmedHotkey = String(hotkey).trim();
  if (isControlPanelShortcut(trimmedHotkey)) {
    return getControlPanelShortcutConflict();
  }
  if (trimmedHotkey === manager.hotkeyManager.getCurrentHotkey()) {
    return {
      success: false,
      message: "Insert and Clipboard hotkeys must be different.",
    };
  }

  const previousHotkey = manager.currentClipboardHotkey;
  const previousAccelerator = manager.registeredClipboardAccelerator;
  unregisterClipboardHotkey(manager, { globalShortcut });

  if (!manager.canRegisterClipboardWithGlobalShortcut(trimmedHotkey)) {
    manager.currentClipboardHotkey = trimmedHotkey;
    manager.clipboardHotkeyRetryAttempts = 0;
    manager.clipboardHotkeyRegistrationFailure = null;
    return { success: true, hotkey: trimmedHotkey };
  }

  const accelerator = normalizeClipboardAccelerator(trimmedHotkey);
  const callback = manager.getClipboardHotkeyCallback();
  const registered = globalShortcut.register(accelerator, callback);
  if (!registered) {
    if (previousAccelerator && previousAccelerator !== accelerator) {
      try {
        if (globalShortcut.register(previousAccelerator, callback)) {
          manager.currentClipboardHotkey = previousHotkey;
          manager.registeredClipboardAccelerator = previousAccelerator;
        }
      } catch {
        // The bounded retry below remains the recovery path.
      }
    }
    if (scheduleRetry) {
      manager.clipboardHotkeyRetryAttempts = 0;
      scheduleClipboardRegistrationRetry(manager, trimmedHotkey, { globalShortcut });
    }
    return {
      success: false,
      message: `Could not register "${trimmedHotkey}". It may be in use by another application.`,
    };
  }

  manager.currentClipboardHotkey = trimmedHotkey;
  manager.registeredClipboardAccelerator = accelerator;
  clearClipboardRegistrationRetry(manager);
  manager.clipboardHotkeyRetryAttempts = 0;
  manager.clipboardHotkeyRegistrationFailure = null;
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

async function initializeClipboardHotkey(manager, { defaultHotkey, globalShortcut } = {}) {
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

  const desiredHotkey = savedHotkey && savedHotkey.trim() ? savedHotkey.trim() : defaultHotkey;
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
  const result = registerClipboardHotkeyInternal(manager, hotkey, { globalShortcut });

  if (!result.success) {
    return result;
  }

  await persistClipboardHotkey(manager, manager.currentClipboardHotkey);
  return {
    success: true,
    message: `Clipboard hotkey updated to: ${manager.currentClipboardHotkey}`,
  };
}

module.exports = {
  CLIPBOARD_REGISTRATION_RETRY_DELAY_MS,
  MAX_CLIPBOARD_REGISTRATION_RETRIES,
  clearClipboardRegistrationRetry,
  initializeClipboardHotkey,
  normalizeClipboardAccelerator,
  persistClipboardHotkey,
  registerClipboardHotkeyInternal,
  unregisterClipboardHotkey,
  updateClipboardHotkey,
};
