const crypto = require("crypto");

function createSessionPayload(outputMode = "insert", { now = Date.now, randomUUID = crypto.randomUUID } = {}) {
  return {
    outputMode,
    sessionId: randomUUID(),
    triggeredAt: now(),
  };
}

function emitDictationEvent(manager, channel, payload) {
  if (!manager?.mainWindow || manager.mainWindow.isDestroyed()) {
    return;
  }
  manager.mainWindow.webContents.send(channel, payload);
}

function sendToggleDictation(manager, payload, { logger } = {}) {
  if (!manager?.mainWindow || manager.mainWindow.isDestroyed()) {
    return;
  }

  logger?.debug?.("[Dictation] sendToggleDictation", payload, "hotkey");
  manager.showDictationPanel({ focus: false });
  emitDictationEvent(manager, "toggle-dictation", payload);
}

function sendStartDictation(manager, payload, { logger } = {}) {
  if (manager?.hotkeyManager?.isInListeningMode?.()) {
    return;
  }
  if (manager?.mainWindow && !manager.mainWindow.isDestroyed()) {
    logger?.debug?.("[Dictation] sendStartDictation", payload, "hotkey");
    manager.showDictationPanel({ focus: false });
    emitDictationEvent(manager, "start-dictation", payload);
  }
}

function sendStopDictation(manager, payload, { logger } = {}) {
  if (manager?.hotkeyManager?.isInListeningMode?.()) {
    return;
  }
  if (manager?.mainWindow && !manager.mainWindow.isDestroyed()) {
    logger?.debug?.("[Dictation] sendStopDictation", payload, "hotkey");
    emitDictationEvent(manager, "stop-dictation", payload);
  }
}

function getMacRequiredModifiers(hotkey) {
  const required = new Set();
  const parts = String(hotkey || "")
    .split("+")
    .map((part) => part.trim());

  for (const part of parts) {
    switch (part) {
      case "Command":
      case "Cmd":
      case "CommandOrControl":
      case "Super":
      case "Meta":
        required.add("command");
        break;
      case "Control":
      case "Ctrl":
        required.add("control");
        break;
      case "Alt":
      case "Option":
        required.add("option");
        break;
      case "Shift":
        required.add("shift");
        break;
      case "Fn":
        required.add("fn");
        break;
      default:
        break;
    }
  }

  return required;
}

function startMacCompoundPushToTalk(manager, hotkey, outputMode = "insert") {
  if (manager.macCompoundPushState?.active) {
    return;
  }

  const requiredModifiers = getMacRequiredModifiers(hotkey);
  if (requiredModifiers.size === 0) {
    return;
  }

  const MIN_HOLD_DURATION_MS = 150;
  const MAX_PUSH_DURATION_MS = 300000; // 5 minutes max recording
  const downTime = Date.now();
  const payload = manager.createSessionPayload(outputMode);

  manager.showDictationPanel();

  // Set up safety timeout
  const safetyTimeoutId = setTimeout(() => {
    if (manager.macCompoundPushState?.active) {
      // eslint-disable-next-line no-console
      console.warn("[WindowManager] Compound PTT safety timeout triggered - stopping recording");
      manager.forceStopMacCompoundPush("timeout");
    }
  }, MAX_PUSH_DURATION_MS);

  manager.macCompoundPushState = {
    active: true,
    downTime,
    isRecording: false,
    requiredModifiers,
    payload,
    safetyTimeoutId,
  };

  setTimeout(() => {
    if (!manager.macCompoundPushState || manager.macCompoundPushState.downTime !== downTime) {
      return;
    }

    if (!manager.macCompoundPushState.isRecording) {
      manager.macCompoundPushState.isRecording = true;
      manager.sendStartDictation(manager.macCompoundPushState.payload);
    }
  }, MIN_HOLD_DURATION_MS);
}

function handleMacPushModifierUp(manager, modifier) {
  if (!manager.macCompoundPushState?.active) {
    return;
  }

  if (!manager.macCompoundPushState.requiredModifiers.has(modifier)) {
    return;
  }

  // Clear safety timeout
  if (manager.macCompoundPushState.safetyTimeoutId) {
    clearTimeout(manager.macCompoundPushState.safetyTimeoutId);
  }

  const wasRecording = manager.macCompoundPushState.isRecording;
  const payload = manager.macCompoundPushState.payload;
  manager.macCompoundPushState = null;

  if (wasRecording) {
    manager.sendStopDictation(payload);
  } else {
    manager.hideDictationPanel();
  }
}

function forceStopMacCompoundPush(manager, reason = "manual") {
  if (!manager.macCompoundPushState) {
    return;
  }

  // Clear safety timeout
  if (manager.macCompoundPushState.safetyTimeoutId) {
    clearTimeout(manager.macCompoundPushState.safetyTimeoutId);
  }

  const wasRecording = manager.macCompoundPushState.isRecording;
  const payload = manager.macCompoundPushState.payload;
  manager.macCompoundPushState = null;

  if (wasRecording) {
    manager.sendStopDictation(payload);
  }
  manager.hideDictationPanel();

  // Notify renderer about forced stop
  if (manager.mainWindow && !manager.mainWindow.isDestroyed()) {
    manager.mainWindow.webContents.send("compound-ptt-force-stopped", { reason });
  }
}

function createHotkeyCallback(manager, outputMode = "insert", hotkeyResolver = null, { logger } = {}) {
  let lastToggleTime = 0;
  const DEBOUNCE_MS = 150;

  return () => {
    if (manager.hotkeyManager.isInListeningMode()) {
      logger?.debug?.("[Hotkey] Ignored (listening mode)", { outputMode }, "hotkey");
      return;
    }

    const activationMode = manager.getActivationMode();
    const resolvedHotkey =
      typeof hotkeyResolver === "function"
        ? hotkeyResolver()
        : manager.hotkeyManager.getCurrentHotkey?.();

    if (
      process.platform === "darwin" &&
      activationMode === "push" &&
      resolvedHotkey &&
      resolvedHotkey !== "GLOBE" &&
      resolvedHotkey.includes("+")
    ) {
      startMacCompoundPushToTalk(manager, resolvedHotkey, outputMode);
      return;
    }

    // Windows push mode: defer to windowsKeyManager if available, else fall through to toggle
    if (process.platform === "win32" && manager.windowsPushToTalkAvailable) {
      if (activationMode === "push") {
        return;
      }
    }

    const now = Date.now();
    if (now - lastToggleTime < DEBOUNCE_MS) {
      logger?.trace?.(
        "[Hotkey] Debounced",
        { outputMode, resolvedHotkey, activationMode, debounceMs: DEBOUNCE_MS },
        "hotkey"
      );
      return;
    }
    lastToggleTime = now;

    const payload = manager.createSessionPayload(outputMode);
    logger?.debug?.(
      "[Hotkey] Triggered",
      { outputMode, resolvedHotkey, activationMode, payload },
      "hotkey"
    );
    manager.sendToggleDictation(payload);
  };
}

module.exports = {
  createHotkeyCallback,
  createSessionPayload,
  emitDictationEvent,
  forceStopMacCompoundPush,
  getMacRequiredModifiers,
  handleMacPushModifierUp,
  sendStartDictation,
  sendStopDictation,
  sendToggleDictation,
  startMacCompoundPushToTalk,
};

