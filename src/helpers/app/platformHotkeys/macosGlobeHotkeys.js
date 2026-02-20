const { isLiveWindow } = require("../windowUtils");

function registerMacOsGlobeHotkeys({
  ipcMain,
  windowManager,
  hotkeyManager,
  globeKeyManager,
  platform = process.platform,
} = {}) {
  if (platform !== "darwin") {
    return null;
  }

  if (!ipcMain || !windowManager || !hotkeyManager || !globeKeyManager) {
    throw new Error("registerMacOsGlobeHotkeys missing required dependencies");
  }

  let globeKeyDownTime = 0;
  let globeKeyIsRecording = false;
  let globeSessionPayload = null;
  const MIN_HOLD_DURATION_MS = 150; // Minimum hold time to trigger push-to-talk

  globeKeyManager.on("globe-down", () => {
    // Forward to control panel for hotkey capture
    if (isLiveWindow(windowManager.controlPanelWindow)) {
      windowManager.controlPanelWindow.webContents.send("globe-key-pressed");
    }

    // Handle dictation if Globe is the current hotkey
    if (hotkeyManager.getCurrentHotkey && hotkeyManager.getCurrentHotkey() === "GLOBE") {
      if (isLiveWindow(windowManager.mainWindow)) {
        const activationMode = windowManager.getActivationMode();
        windowManager.showDictationPanel();
        if (activationMode === "push") {
          // Track when key was pressed for push-to-talk
          globeKeyDownTime = Date.now();
          globeKeyIsRecording = false;
          globeSessionPayload = windowManager.createSessionPayload("insert");
          // Start recording after a brief delay to distinguish tap from hold
          setTimeout(() => {
            // Only start if key is still being held
            if (globeKeyDownTime > 0 && !globeKeyIsRecording) {
              globeKeyIsRecording = true;
              windowManager.sendStartDictation(globeSessionPayload);
            }
          }, MIN_HOLD_DURATION_MS);
        } else {
          windowManager.sendToggleDictation(windowManager.createSessionPayload("insert"));
        }
      }
    }
  });

  globeKeyManager.on("globe-up", () => {
    // Forward to control panel for hotkey capture (Fn key released)
    if (isLiveWindow(windowManager.controlPanelWindow)) {
      windowManager.controlPanelWindow.webContents.send("globe-key-released");
    }

    // Handle push-to-talk release if Globe is the current hotkey
    if (hotkeyManager.getCurrentHotkey && hotkeyManager.getCurrentHotkey() === "GLOBE") {
      const activationMode = windowManager.getActivationMode();
      if (activationMode === "push") {
        globeKeyDownTime = 0;
        // Only stop if we actually started recording
        if (globeKeyIsRecording) {
          globeKeyIsRecording = false;
          windowManager.sendStopDictation(globeSessionPayload);
        }
        globeSessionPayload = null;
        // If released too quickly, don't do anything (tap is ignored in push mode)
      }
    }

    // Fn release also stops compound push-to-talk for Fn+F-key hotkeys
    windowManager.handleMacPushModifierUp("fn");
  });

  globeKeyManager.on("modifier-up", (modifier) => {
    if (windowManager?.handleMacPushModifierUp) {
      windowManager.handleMacPushModifierUp(modifier);
    }
  });

  // Right-side single modifier handling (e.g., RightOption as hotkey)
  let rightModDownTime = 0;
  let rightModIsRecording = false;
  let rightModSessionPayload = null;

  globeKeyManager.on("right-modifier-down", (modifier) => {
    const insertHotkey = hotkeyManager.getCurrentHotkey && hotkeyManager.getCurrentHotkey();
    const clipboardHotkey = windowManager.getCurrentClipboardHotkey
      ? windowManager.getCurrentClipboardHotkey()
      : null;
    const outputMode =
      clipboardHotkey === modifier ? "clipboard" : insertHotkey === modifier ? "insert" : null;
    if (!outputMode) return;
    if (!isLiveWindow(windowManager.mainWindow)) return;

    const activationMode = windowManager.getActivationMode();
    windowManager.showDictationPanel();
    if (activationMode === "push") {
      rightModDownTime = Date.now();
      rightModIsRecording = false;
      rightModSessionPayload = windowManager.createSessionPayload(outputMode);
      setTimeout(() => {
        if (rightModDownTime > 0 && !rightModIsRecording) {
          rightModIsRecording = true;
          windowManager.sendStartDictation(rightModSessionPayload);
        }
      }, MIN_HOLD_DURATION_MS);
    } else {
      windowManager.sendToggleDictation(windowManager.createSessionPayload(outputMode));
    }
  });

  globeKeyManager.on("right-modifier-up", (modifier) => {
    const insertHotkey = hotkeyManager.getCurrentHotkey && hotkeyManager.getCurrentHotkey();
    const clipboardHotkey = windowManager.getCurrentClipboardHotkey
      ? windowManager.getCurrentClipboardHotkey()
      : null;
    if (modifier !== insertHotkey && modifier !== clipboardHotkey) return;
    if (!isLiveWindow(windowManager.mainWindow)) return;

    const activationMode = windowManager.getActivationMode();
    if (activationMode === "push") {
      rightModDownTime = 0;
      if (rightModIsRecording) {
        rightModIsRecording = false;
        windowManager.sendStopDictation(rightModSessionPayload);
      } else {
        windowManager.hideDictationPanel();
      }
      rightModSessionPayload = null;
    }
  });

  globeKeyManager.start();

  // Reset native key state when hotkey changes
  ipcMain.on("hotkey-changed", (_event, _newHotkey) => {
    globeKeyDownTime = 0;
    globeKeyIsRecording = false;
    globeSessionPayload = null;
    rightModDownTime = 0;
    rightModIsRecording = false;
    rightModSessionPayload = null;
  });

  ipcMain.on("clipboard-hotkey-changed", (_event, _newHotkey) => {
    rightModDownTime = 0;
    rightModIsRecording = false;
    rightModSessionPayload = null;
  });

  return {
    reset: () => {
      globeKeyDownTime = 0;
      globeKeyIsRecording = false;
      globeSessionPayload = null;
      rightModDownTime = 0;
      rightModIsRecording = false;
      rightModSessionPayload = null;
    },
  };
}

module.exports = {
  registerMacOsGlobeHotkeys,
};

