const { app, dialog, globalShortcut } = require("electron");
const HotkeyManager = require("./hotkeyManager");
const { isModifierOnlyHotkey, isRightSideModifier } = HotkeyManager;
const {
  canUseWindowsRegisteredTapHotkey,
  isWindowsNativeHotkeySupported,
} = require("./hotkey/windowsNativeHotkey");
const DragManager = require("./dragManager");
const debugLogger = require("./debugLogger");
const { accelerator: CONTROL_PANEL_ACCELERATOR } = require("../shared/controlPanelShortcut.json");
const { loadWindowContent: loadWindowContentImpl } = require("./windowManager/windowContentLoader");
const {
  createControlPanelWindow: createControlPanelWindowImpl,
  hideControlPanelToTray: hideControlPanelToTrayImpl,
  loadControlPanel: loadControlPanelImpl,
  openExternalUrl: openExternalUrlImpl,
} = require("./windowManager/controlPanelWindow");
const {
  createHotkeyCallback: createHotkeyCallbackImpl,
  createSessionPayload: createSessionPayloadImpl,
  forceStopMacCompoundPush: forceStopMacCompoundPushImpl,
  getMacRequiredModifiers: getMacRequiredModifiersImpl,
  handleMacPushModifierUp: handleMacPushModifierUpImpl,
  sendStartDictation: sendStartDictationImpl,
  sendStopDictation: sendStopDictationImpl,
  sendToggleDictation: sendToggleDictationImpl,
  startMacCompoundPushToTalk: startMacCompoundPushToTalkImpl,
} = require("./windowManager/hotkeyRouting");
const {
  initializeClipboardHotkey: initializeClipboardHotkeyImpl,
  persistClipboardHotkey: persistClipboardHotkeyImpl,
  registerClipboardHotkeyInternal: registerClipboardHotkeyInternalImpl,
  unregisterClipboardHotkey: unregisterClipboardHotkeyImpl,
  updateClipboardHotkey: updateClipboardHotkeyImpl,
} = require("./windowManager/clipboardHotkeys");
const {
  createMainWindow: createMainWindowImpl,
  enforceMainWindowOnTop: enforceMainWindowOnTopImpl,
  hideDictationPanel: hideDictationPanelImpl,
  isDictationPanelVisible: isDictationPanelVisibleImpl,
  registerMainWindowEvents: registerMainWindowEventsImpl,
  resizeMainWindow: resizeMainWindowImpl,
  setMainWindowInteractivity: setMainWindowInteractivityImpl,
  showDictationPanel: showDictationPanelImpl,
  showRecordingIndicator: showRecordingIndicatorImpl,
} = require("./windowManager/mainWindow");

const DEFAULT_CLIPBOARD_HOTKEY =
  process.platform === "darwin" ? "Control+Option+Space" : "Control+Alt";
const ISSUED_SESSION_TTL_MS = 60 * 60 * 1000;

class WindowManager {
  constructor() {
    this.mainWindow = null;
    this.mainWindowCreatedHandler = null;
    this.controlPanelWindow = null;
    this.tray = null;
    this.hotkeyManager = new HotkeyManager();
    this.debugLogger = debugLogger;
    this.dragManager = new DragManager();
    this.isQuitting = false;
    this.isMainWindowInteractive = false;
    this.loadErrorShown = false;
    this.windowsPushToTalkAvailable = false;
    this.windowsNativeReadyRoutes = new Set();
    this.windowsHotkeyController = null;
    this.macCompoundPushState = null;
    this._cachedActivationMode = "tap";
    this.currentClipboardHotkey = DEFAULT_CLIPBOARD_HOTKEY;
    this.registeredClipboardAccelerator = null;
    this.controlPanelShortcutStatus = {
      accelerator: CONTROL_PANEL_ACCELERATOR,
      registered: false,
      reason: "starting",
    };
    this.issuedDictationSessions = new Map();

    app.on("before-quit", () => {
      this.isQuitting = true;
    });
  }

  onClipboardHotkeyRegistrationFailure(failure = {}) {
    const payload = {
      hotkey: failure.hotkey || this.currentClipboardHotkey,
      error:
        failure.message ||
        "The clipboard hotkey could not be restored. Choose another shortcut in Settings.",
      suggestions: ["F9", "Alt+F7", "Control+Shift+Space"],
    };
    for (const window of [this.mainWindow, this.controlPanelWindow]) {
      if (window && !window.isDestroyed()) {
        window.webContents.send("hotkey-registration-failed", payload);
      }
    }
  }

  onInsertHotkeyRegistrationFailure(failure = {}) {
    const payload = {
      hotkey: failure.hotkey || this.hotkeyManager.getCurrentHotkey?.(),
      error:
        failure.message ||
        "The insert hotkey could not be restored. Choose another shortcut in Settings.",
      suggestions: ["F9", "Alt+F7", "Control+Shift+Space"],
    };
    for (const window of [this.mainWindow, this.controlPanelWindow]) {
      if (window && !window.isDestroyed()) {
        window.webContents.send("hotkey-registration-failed", payload);
      }
    }
  }

  setWindowsPushToTalkAvailable(available) {
    this.windowsPushToTalkAvailable = available;
  }

  setControlPanelShortcutStatus(status = {}) {
    this.controlPanelShortcutStatus = {
      accelerator: status.accelerator || CONTROL_PANEL_ACCELERATOR,
      registered: Boolean(status.registered),
      reason: status.reason || null,
    };
    for (const window of [this.mainWindow, this.controlPanelWindow]) {
      if (window && !window.isDestroyed()) {
        window.webContents.send("control-panel-shortcut-status", this.controlPanelShortcutStatus);
      }
    }
    return this.controlPanelShortcutStatus;
  }

  getControlPanelShortcutStatus() {
    return { ...this.controlPanelShortcutStatus };
  }

  setWindowsNativeListenerReady(routeId, ready) {
    const normalizedRoute = routeId === "clipboard" ? "clipboard" : "insert";
    if (ready) {
      this.windowsNativeReadyRoutes.add(normalizedRoute);
    } else {
      this.windowsNativeReadyRoutes.delete(normalizedRoute);
    }
    this.windowsPushToTalkAvailable = this.windowsNativeReadyRoutes.size > 0;
  }

  clearWindowsNativeListenerReadiness() {
    this.windowsNativeReadyRoutes.clear();
    this.windowsPushToTalkAvailable = false;
  }

  isWindowsNativeListenerReady(routeId) {
    const normalizedRoute = routeId === "clipboard" ? "clipboard" : "insert";
    return this.windowsNativeReadyRoutes.has(normalizedRoute);
  }

  canUseWindowsRegisteredTapHotkey(hotkey) {
    return process.platform === "win32" && canUseWindowsRegisteredTapHotkey(hotkey);
  }

  suspendGlobalHotkeyForNativeTap(routeId) {
    const normalizedRoute = routeId === "clipboard" ? "clipboard" : "insert";
    if (normalizedRoute === "clipboard") {
      this.unregisterClipboardHotkey();
      return;
    }

    const hotkey = this.hotkeyManager.getCurrentHotkey?.();
    const accelerator = hotkey?.startsWith("Fn+") ? hotkey.slice(3) : hotkey;
    if (!accelerator) return;
    try {
      globalShortcut.unregister(accelerator);
    } catch (error) {
      debugLogger.warn("Could not release insert accelerator for native tap listener", {
        hotkey,
        error: error?.message || String(error),
      });
    }
  }

  restoreGlobalHotkeyFallback(routeId) {
    const normalizedRoute = routeId === "clipboard" ? "clipboard" : "insert";
    if (normalizedRoute === "clipboard") {
      if (!this.currentClipboardHotkey) {
        return { success: false, message: "No clipboard hotkey configured." };
      }
      return this.registerClipboardHotkeyInternal(this.currentClipboardHotkey);
    }

    return this.hotkeyManager.refreshCurrentHotkey(
      this.createHotkeyCallback("insert", () => this.hotkeyManager.getCurrentHotkey?.())
    );
  }

  async createMainWindow() {
    return createMainWindowImpl(this);
  }

  setMainWindowCreatedHandler(handler) {
    this.mainWindowCreatedHandler = typeof handler === "function" ? handler : null;
  }

  notifyMainWindowCreated(window) {
    this.mainWindowCreatedHandler?.(window);
  }

  setMainWindowInteractivity(shouldCapture) {
    setMainWindowInteractivityImpl(this, shouldCapture);
  }

  resizeMainWindow(sizeKey) {
    return resizeMainWindowImpl(this, sizeKey);
  }

  /**
   * Load content into a BrowserWindow, handling both dev server and production file loading.
   * @param {BrowserWindow} window - The window to load content into
   * @param {boolean} isControlPanel - Whether this is the control panel
   */
  async loadWindowContent(window, isControlPanel = false) {
    await loadWindowContentImpl({ window, isControlPanel });
  }

  async loadMainWindow() {
    await this.loadWindowContent(this.mainWindow, false);
  }

  createSessionPayload(outputMode = "insert") {
    const payload = createSessionPayloadImpl(outputMode);
    this._purgeExpiredDictationSessions();
    this.issuedDictationSessions.set(payload.sessionId, {
      outputMode: payload.outputMode,
      expiresAt: Date.now() + ISSUED_SESSION_TTL_MS,
      insertionTargetClaimed: false,
      debugAudioClaimed: false,
    });
    return payload;
  }

  _purgeExpiredDictationSessions(now = Date.now()) {
    for (const [sessionId, session] of this.issuedDictationSessions) {
      if (!session || session.expiresAt <= now) {
        this.issuedDictationSessions.delete(sessionId);
      }
    }
  }

  isIssuedDictationSession(sessionId, outputMode = null) {
    this._purgeExpiredDictationSessions();
    const session = this.issuedDictationSessions.get(String(sessionId || ""));
    if (!session) return false;
    return !outputMode || session.outputMode === outputMode;
  }

  claimInsertionTargetSession(sessionId) {
    this._purgeExpiredDictationSessions();
    const key = String(sessionId || "");
    const session = this.issuedDictationSessions.get(key);
    if (!session || session.outputMode !== "insert" || session.insertionTargetClaimed) {
      return false;
    }
    session.insertionTargetClaimed = true;
    return true;
  }

  claimDebugAudioSession(sessionId, outputMode = null) {
    this._purgeExpiredDictationSessions();
    const session = this.issuedDictationSessions.get(String(sessionId || ""));
    if (
      !session ||
      session.debugAudioClaimed ||
      (outputMode && session.outputMode !== outputMode)
    ) {
      return false;
    }
    session.debugAudioClaimed = true;
    return true;
  }

  emitDictationEvent(channel, payload) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    this.mainWindow.webContents.send(channel, payload);
  }

  sendToggleDictation(payload = this.createSessionPayload("insert")) {
    sendToggleDictationImpl(this, payload, { logger: debugLogger });
  }

  createHotkeyCallback(outputMode = "insert", hotkeyResolver = null) {
    return createHotkeyCallbackImpl(this, outputMode, hotkeyResolver, { logger: debugLogger });
  }

  startMacCompoundPushToTalk(hotkey, outputMode = "insert") {
    startMacCompoundPushToTalkImpl(this, hotkey, outputMode);
  }

  handleMacPushModifierUp(modifier) {
    handleMacPushModifierUpImpl(this, modifier);
  }

  forceStopMacCompoundPush(reason = "manual") {
    forceStopMacCompoundPushImpl(this, reason);
  }

  getMacRequiredModifiers(hotkey) {
    return getMacRequiredModifiersImpl(hotkey);
  }

  sendStartDictation(payload = this.createSessionPayload("insert")) {
    sendStartDictationImpl(this, payload, { logger: debugLogger });
  }

  sendStopDictation(payload = this.createSessionPayload("insert")) {
    sendStopDictationImpl(this, payload, { logger: debugLogger });
  }

  sendCancelProcessing() {
    this.emitDictationEvent("cancel-dictation-processing", {});
  }

  getActivationMode() {
    return this._cachedActivationMode;
  }

  setActivationModeCache(mode) {
    this._cachedActivationMode = mode === "push" ? "push" : "tap";
  }

  setHotkeyListeningMode(enabled) {
    this.hotkeyManager.setListeningMode(enabled);
  }

  setWindowsHotkeyController(controller) {
    this.windowsHotkeyController = controller || null;
  }

  getWindowsHotkeyController() {
    return this.windowsHotkeyController;
  }

  async initializeHotkey() {
    await this.hotkeyManager.initializeHotkey(
      this.mainWindow,
      this.createHotkeyCallback("insert", () => this.hotkeyManager.getCurrentHotkey?.())
    );
  }

  async updateHotkey(hotkey) {
    if (hotkey === this.currentClipboardHotkey) {
      return {
        success: false,
        message: "Insert and Clipboard hotkeys must be different.",
      };
    }

    const result = await this.hotkeyManager.updateHotkey(
      hotkey,
      this.createHotkeyCallback("insert", () => this.hotkeyManager.getCurrentHotkey?.())
    );

    if (result?.success && this.currentClipboardHotkey) {
      this.registerClipboardHotkeyInternal(this.currentClipboardHotkey);
    }

    return result;
  }

  getCurrentClipboardHotkey() {
    return this.currentClipboardHotkey;
  }

  shouldUseWindowsNativeListener(hotkey, mode = this.getActivationMode()) {
    if (process.platform !== "win32") return false;
    if (!hotkey || hotkey === "GLOBE") return false;
    if (!isWindowsNativeHotkeySupported(hotkey)) return false;
    return (
      mode === "push" ||
      isRightSideModifier(hotkey) ||
      isModifierOnlyHotkey(hotkey) ||
      mode === "tap"
    );
  }

  canRegisterClipboardWithGlobalShortcut(hotkey) {
    if (!hotkey || hotkey === "GLOBE") return false;
    if (
      process.platform === "win32" &&
      (isRightSideModifier(hotkey) || isModifierOnlyHotkey(hotkey))
    ) {
      return false;
    }
    return true;
  }

  unregisterClipboardHotkey() {
    unregisterClipboardHotkeyImpl(this, { globalShortcut });
  }

  getClipboardHotkeyCallback() {
    return this.createHotkeyCallback("clipboard", () => this.currentClipboardHotkey);
  }

  registerClipboardHotkeyInternal(hotkey) {
    return registerClipboardHotkeyInternalImpl(this, hotkey, { globalShortcut });
  }

  async persistClipboardHotkey(hotkey) {
    return persistClipboardHotkeyImpl(this, hotkey);
  }

  async initializeClipboardHotkey() {
    return initializeClipboardHotkeyImpl(this, {
      defaultHotkey: DEFAULT_CLIPBOARD_HOTKEY,
      globalShortcut,
    });
  }

  async updateClipboardHotkey(hotkey) {
    return updateClipboardHotkeyImpl(this, hotkey, { globalShortcut });
  }

  async recoverHotkeys() {
    if (this.hotkeyManager.isInListeningMode()) {
      return {
        insert: { success: false, skipped: true, reason: "capture-active" },
        clipboard: { success: false, skipped: true, reason: "capture-active" },
      };
    }
    const activationMode = this.getActivationMode();
    const insertHotkey = this.hotkeyManager.getCurrentHotkey?.();
    const insertNativeTapActive =
      activationMode === "tap" &&
      this.canUseWindowsRegisteredTapHotkey(insertHotkey) &&
      this.isWindowsNativeListenerReady("insert");
    const clipboardNativeTapActive =
      activationMode === "tap" &&
      this.canUseWindowsRegisteredTapHotkey(this.currentClipboardHotkey) &&
      this.isWindowsNativeListenerReady("clipboard");
    const insert = insertNativeTapActive
      ? { success: true, hotkey: insertHotkey, nativeOnly: true }
      : this.hotkeyManager.refreshCurrentHotkey(
          this.createHotkeyCallback("insert", () => this.hotkeyManager.getCurrentHotkey?.())
        );
    const clipboard = clipboardNativeTapActive
      ? { success: true, hotkey: this.currentClipboardHotkey, nativeOnly: true }
      : this.currentClipboardHotkey
        ? this.registerClipboardHotkeyInternal(this.currentClipboardHotkey)
        : { success: false, message: "No clipboard hotkey configured." };
    return { insert, clipboard };
  }

  isUsingGnomeHotkeys() {
    return this.hotkeyManager.isUsingGnome();
  }

  async startWindowDrag() {
    return this.dragManager.startWindowDrag();
  }

  async stopWindowDrag() {
    return this.dragManager.stopWindowDrag();
  }

  openExternalUrl(url, showError = true) {
    openExternalUrlImpl(url, { showError });
  }

  async createControlPanelWindow() {
    return createControlPanelWindowImpl(this);
  }

  async loadControlPanel() {
    return loadControlPanelImpl(this);
  }

  showDictationPanel(options = {}) {
    showDictationPanelImpl(this, options);
  }

  showRecordingIndicator(sizeKey = "RECORDING_INDICATOR") {
    return showRecordingIndicatorImpl(this, { sizeKey });
  }

  hideControlPanelToTray() {
    hideControlPanelToTrayImpl(this);
  }

  hideDictationPanel() {
    hideDictationPanelImpl(this);
  }

  isDictationPanelVisible() {
    return isDictationPanelVisibleImpl(this);
  }

  registerMainWindowEvents() {
    registerMainWindowEventsImpl(this);
  }

  enforceMainWindowOnTop() {
    enforceMainWindowOnTopImpl(this);
  }

  showLoadFailureDialog(windowName, errorCode, errorDescription, validatedURL) {
    if (this.loadErrorShown) {
      return;
    }
    this.loadErrorShown = true;
    const detailLines = [
      `Window: ${windowName}`,
      `Error ${errorCode}: ${errorDescription}`,
      validatedURL ? `URL: ${validatedURL}` : null,
      "Try reinstalling the app or launching with --log-level=debug.",
    ].filter(Boolean);
    dialog.showMessageBox({
      type: "error",
      title: "EchoDraft failed to load",
      message: "EchoDraft could not load its UI.",
      detail: detailLines.join("\n"),
    });
  }
}

module.exports = WindowManager;
