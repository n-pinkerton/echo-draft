const { app, dialog, globalShortcut } = require("electron");
const HotkeyManager = require("./hotkeyManager");
const { isModifierOnlyHotkey, isRightSideModifier } = HotkeyManager;
const DragManager = require("./dragManager");
const debugLogger = require("./debugLogger");
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
} = require("./windowManager/mainWindow");

const DEFAULT_CLIPBOARD_HOTKEY =
  process.platform === "darwin" ? "Control+Option+Space" : "Control+Alt";

class WindowManager {
  constructor() {
    this.mainWindow = null;
    this.controlPanelWindow = null;
    this.tray = null;
    this.hotkeyManager = new HotkeyManager();
    this.dragManager = new DragManager();
    this.isQuitting = false;
    this.isMainWindowInteractive = false;
    this.loadErrorShown = false;
    this.windowsPushToTalkAvailable = false;
    this.macCompoundPushState = null;
    this._cachedActivationMode = "tap";
    this.currentClipboardHotkey = DEFAULT_CLIPBOARD_HOTKEY;
    this.registeredClipboardAccelerator = null;

    app.on("before-quit", () => {
      this.isQuitting = true;
    });
  }

  setWindowsPushToTalkAvailable(available) {
    this.windowsPushToTalkAvailable = available;
  }

  async createMainWindow() {
    return createMainWindowImpl(this);
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
    return createSessionPayloadImpl(outputMode);
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

  getActivationMode() {
    return this._cachedActivationMode;
  }

  setActivationModeCache(mode) {
    this._cachedActivationMode = mode === "push" ? "push" : "tap";
  }

  setHotkeyListeningMode(enabled) {
    this.hotkeyManager.setListeningMode(enabled);
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
    if (mode === "push") return true;
    return isRightSideModifier(hotkey) || isModifierOnlyHotkey(hotkey);
  }

  canRegisterClipboardWithGlobalShortcut(hotkey) {
    if (!hotkey || hotkey === "GLOBE") return false;
    return !this.shouldUseWindowsNativeListener(hotkey);
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
