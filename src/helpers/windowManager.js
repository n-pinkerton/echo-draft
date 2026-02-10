const { app, screen, BrowserWindow, shell, dialog, globalShortcut } = require("electron");
const crypto = require("crypto");
const HotkeyManager = require("./hotkeyManager");
const { isModifierOnlyHotkey, isRightSideModifier } = HotkeyManager;
const DragManager = require("./dragManager");
const MenuManager = require("./menuManager");
const DevServerManager = require("./devServerManager");
const { DEV_SERVER_PORT } = DevServerManager;
const {
  MAIN_WINDOW_CONFIG,
  CONTROL_PANEL_CONFIG,
  WINDOW_SIZES,
  WindowPositionUtil,
} = require("./windowConfig");

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
    const display = screen.getPrimaryDisplay();
    const position = WindowPositionUtil.getMainWindowPosition(display);

    this.mainWindow = new BrowserWindow({
      ...MAIN_WINDOW_CONFIG,
      ...position,
    });

    // Main window (dictation overlay) should never appear in dock/taskbar
    // On macOS, users access the app via the menu bar tray icon
    // On Windows/Linux, the control panel stays in the taskbar when minimized
    this.mainWindow.setSkipTaskbar(true);

    this.setMainWindowInteractivity(false);
    this.registerMainWindowEvents();

    // Register load event handlers BEFORE loading to catch all events
    this.mainWindow.webContents.on(
      "did-fail-load",
      async (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) {
          return;
        }
        if (
          process.env.NODE_ENV === "development" &&
          validatedURL &&
          validatedURL.includes(`localhost:${DEV_SERVER_PORT}`)
        ) {
          // Retry connection to dev server
          setTimeout(async () => {
            const isReady = await DevServerManager.waitForDevServer();
            if (isReady) {
              this.mainWindow.reload();
            }
          }, 2000);
        } else {
          this.showLoadFailureDialog("Dictation panel", errorCode, errorDescription, validatedURL);
        }
      }
    );

    this.mainWindow.webContents.on("did-finish-load", () => {
      this.mainWindow.setTitle("Voice Recorder");
      this.enforceMainWindowOnTop();
    });

    // Now load the window content
    await this.loadMainWindow();
    await this.initializeHotkey();
    await this.initializeClipboardHotkey();
    this.dragManager.setTargetWindow(this.mainWindow);
    MenuManager.setupMainMenu();
  }

  setMainWindowInteractivity(shouldCapture) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    if (shouldCapture) {
      this.mainWindow.setIgnoreMouseEvents(false);
    } else {
      this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }
    this.isMainWindowInteractive = shouldCapture;
  }

  resizeMainWindow(sizeKey) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return { success: false, message: "Window not available" };
    }

    const newSize = WINDOW_SIZES[sizeKey] || WINDOW_SIZES.BASE;
    const currentBounds = this.mainWindow.getBounds();

    const bottomRightX = currentBounds.x + currentBounds.width;
    const bottomRightY = currentBounds.y + currentBounds.height;

    const display = screen.getDisplayNearestPoint({ x: bottomRightX, y: bottomRightY });
    const workArea = display.workArea || display.bounds;

    let newX = bottomRightX - newSize.width;
    let newY = bottomRightY - newSize.height;

    newX = Math.max(workArea.x, Math.min(newX, workArea.x + workArea.width - newSize.width));
    newY = Math.max(workArea.y, Math.min(newY, workArea.y + workArea.height - newSize.height));

    this.mainWindow.setBounds({
      x: newX,
      y: newY,
      width: newSize.width,
      height: newSize.height,
    });

    return { success: true, bounds: { x: newX, y: newY, ...newSize } };
  }

  /**
   * Load content into a BrowserWindow, handling both dev server and production file loading.
   * @param {BrowserWindow} window - The window to load content into
   * @param {boolean} isControlPanel - Whether this is the control panel
   */
  async loadWindowContent(window, isControlPanel = false) {
    if (process.env.NODE_ENV === "development") {
      const appUrl = DevServerManager.getAppUrl(isControlPanel);
      await DevServerManager.waitForDevServer();
      await window.loadURL(appUrl);
    } else {
      // Production: use loadFile() for better compatibility with Electron 36+
      const fileInfo = DevServerManager.getAppFilePath(isControlPanel);
      if (!fileInfo) {
        throw new Error("Failed to get app file path");
      }

      const fs = require("fs");
      if (!fs.existsSync(fileInfo.path)) {
        throw new Error(`HTML file not found: ${fileInfo.path}`);
      }

      await window.loadFile(fileInfo.path, { query: fileInfo.query });
    }
  }

  async loadMainWindow() {
    await this.loadWindowContent(this.mainWindow, false);
  }

  createSessionPayload(outputMode = "insert") {
    return {
      outputMode,
      sessionId: crypto.randomUUID(),
      triggeredAt: Date.now(),
    };
  }

  emitDictationEvent(channel, payload) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    this.mainWindow.webContents.send(channel, payload);
  }

  sendToggleDictation(payload = this.createSessionPayload("insert")) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    this.showDictationPanel({ focus: false });
    this.emitDictationEvent("toggle-dictation", payload);
  }

  createHotkeyCallback(outputMode = "insert", hotkeyResolver = null) {
    let lastToggleTime = 0;
    const DEBOUNCE_MS = 150;

    return async () => {
      if (this.hotkeyManager.isInListeningMode()) {
        return;
      }

      const activationMode = await this.getActivationMode();
      const resolvedHotkey =
        typeof hotkeyResolver === "function"
          ? hotkeyResolver()
          : this.hotkeyManager.getCurrentHotkey?.();

      if (
        process.platform === "darwin" &&
        activationMode === "push" &&
        resolvedHotkey &&
        resolvedHotkey !== "GLOBE" &&
        resolvedHotkey.includes("+")
      ) {
        this.startMacCompoundPushToTalk(resolvedHotkey, outputMode);
        return;
      }

      // Windows push mode: defer to windowsKeyManager if available, else fall through to toggle
      if (process.platform === "win32" && this.windowsPushToTalkAvailable) {
        if (activationMode === "push") {
          return;
        }
      }

      const now = Date.now();
      if (now - lastToggleTime < DEBOUNCE_MS) {
        return;
      }
      lastToggleTime = now;

      this.sendToggleDictation(this.createSessionPayload(outputMode));
    };
  }

  startMacCompoundPushToTalk(hotkey, outputMode = "insert") {
    if (this.macCompoundPushState?.active) {
      return;
    }

    const requiredModifiers = this.getMacRequiredModifiers(hotkey);
    if (requiredModifiers.size === 0) {
      return;
    }

    const MIN_HOLD_DURATION_MS = 150;
    const MAX_PUSH_DURATION_MS = 300000; // 5 minutes max recording
    const downTime = Date.now();
    const payload = this.createSessionPayload(outputMode);

    this.showDictationPanel();

    // Set up safety timeout
    const safetyTimeoutId = setTimeout(() => {
      if (this.macCompoundPushState?.active) {
        console.warn("[WindowManager] Compound PTT safety timeout triggered - stopping recording");
        this.forceStopMacCompoundPush("timeout");
      }
    }, MAX_PUSH_DURATION_MS);

    this.macCompoundPushState = {
      active: true,
      downTime,
      isRecording: false,
      requiredModifiers,
      payload,
      safetyTimeoutId,
    };

    setTimeout(() => {
      if (!this.macCompoundPushState || this.macCompoundPushState.downTime !== downTime) {
        return;
      }

      if (!this.macCompoundPushState.isRecording) {
        this.macCompoundPushState.isRecording = true;
        this.sendStartDictation(this.macCompoundPushState.payload);
      }
    }, MIN_HOLD_DURATION_MS);
  }

  handleMacPushModifierUp(modifier) {
    if (!this.macCompoundPushState?.active) {
      return;
    }

    if (!this.macCompoundPushState.requiredModifiers.has(modifier)) {
      return;
    }

    // Clear safety timeout
    if (this.macCompoundPushState.safetyTimeoutId) {
      clearTimeout(this.macCompoundPushState.safetyTimeoutId);
    }

    const wasRecording = this.macCompoundPushState.isRecording;
    const payload = this.macCompoundPushState.payload;
    this.macCompoundPushState = null;

    if (wasRecording) {
      this.sendStopDictation(payload);
    } else {
      this.hideDictationPanel();
    }
  }

  forceStopMacCompoundPush(reason = "manual") {
    if (!this.macCompoundPushState) {
      return;
    }

    // Clear safety timeout
    if (this.macCompoundPushState.safetyTimeoutId) {
      clearTimeout(this.macCompoundPushState.safetyTimeoutId);
    }

    const wasRecording = this.macCompoundPushState.isRecording;
    const payload = this.macCompoundPushState.payload;
    this.macCompoundPushState = null;

    if (wasRecording) {
      this.sendStopDictation(payload);
    }
    this.hideDictationPanel();

    // Notify renderer about forced stop
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("compound-ptt-force-stopped", { reason });
    }
  }

  getMacRequiredModifiers(hotkey) {
    const required = new Set();
    const parts = hotkey.split("+").map((part) => part.trim());

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

  sendStartDictation(payload = this.createSessionPayload("insert")) {
    if (this.hotkeyManager.isInListeningMode()) {
      return;
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.showDictationPanel({ focus: false });
      this.emitDictationEvent("start-dictation", payload);
    }
  }

  sendStopDictation(payload = this.createSessionPayload("insert")) {
    if (this.hotkeyManager.isInListeningMode()) {
      return;
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.emitDictationEvent("stop-dictation", payload);
    }
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
    if (!this.registeredClipboardAccelerator) {
      return;
    }
    try {
      globalShortcut.unregister(this.registeredClipboardAccelerator);
    } catch {
      // Ignore unregister errors
    }
    this.registeredClipboardAccelerator = null;
  }

  getClipboardHotkeyCallback() {
    return this.createHotkeyCallback("clipboard", () => this.currentClipboardHotkey);
  }

  registerClipboardHotkeyInternal(hotkey) {
    if (!hotkey || !hotkey.trim()) {
      return { success: false, message: "Please enter a valid clipboard hotkey." };
    }

    const trimmedHotkey = hotkey.trim();
    if (trimmedHotkey === this.hotkeyManager.getCurrentHotkey()) {
      return {
        success: false,
        message: "Insert and Clipboard hotkeys must be different.",
      };
    }

    this.unregisterClipboardHotkey();

    if (!this.canRegisterClipboardWithGlobalShortcut(trimmedHotkey)) {
      this.currentClipboardHotkey = trimmedHotkey;
      return { success: true, hotkey: trimmedHotkey };
    }

    const accelerator = trimmedHotkey.startsWith("Fn+") ? trimmedHotkey.slice(3) : trimmedHotkey;
    const callback = this.getClipboardHotkeyCallback();
    const registered = globalShortcut.register(accelerator, callback);
    if (!registered) {
      return {
        success: false,
        message: `Could not register "${trimmedHotkey}". It may be in use by another application.`,
      };
    }

    this.currentClipboardHotkey = trimmedHotkey;
    this.registeredClipboardAccelerator = accelerator;
    return { success: true, hotkey: trimmedHotkey };
  }

  async persistClipboardHotkey(hotkey) {
    process.env.DICTATION_KEY_CLIPBOARD = hotkey;

    try {
      const EnvironmentManager = require("./environment");
      const envManager = new EnvironmentManager();
      envManager.saveClipboardDictationKey(hotkey);
    } catch {
      // Ignore persistence errors
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const escapedHotkey = hotkey.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      await this.mainWindow.webContents.executeJavaScript(
        `localStorage.setItem("dictationKeyClipboard", "${escapedHotkey}"); true;`
      );
    }
  }

  async initializeClipboardHotkey() {
    const defaultHotkey = DEFAULT_CLIPBOARD_HOTKEY;
    let savedHotkey = process.env.DICTATION_KEY_CLIPBOARD || "";

    if (!savedHotkey && this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        savedHotkey = await this.mainWindow.webContents.executeJavaScript(`
          localStorage.getItem("dictationKeyClipboard") || ""
        `);
      } catch {
        savedHotkey = "";
      }
    }

    const desiredHotkey = savedHotkey && savedHotkey.trim() ? savedHotkey.trim() : defaultHotkey;
    const registrationResult = this.registerClipboardHotkeyInternal(desiredHotkey);
    if (registrationResult.success) {
      await this.persistClipboardHotkey(desiredHotkey);
      return registrationResult;
    }

    const fallbackHotkeys = [defaultHotkey, "F9", "Alt+F7"];
    for (const fallback of fallbackHotkeys) {
      if (!fallback || fallback === desiredHotkey) continue;
      const fallbackResult = this.registerClipboardHotkeyInternal(fallback);
      if (fallbackResult.success) {
        await this.persistClipboardHotkey(fallback);
        return fallbackResult;
      }
    }

    return registrationResult;
  }

  async updateClipboardHotkey(hotkey) {
    const previousHotkey = this.currentClipboardHotkey;
    const result = this.registerClipboardHotkeyInternal(hotkey);

    if (!result.success) {
      if (previousHotkey) {
        this.registerClipboardHotkeyInternal(previousHotkey);
      }
      return result;
    }

    await this.persistClipboardHotkey(this.currentClipboardHotkey);
    return {
      success: true,
      message: `Clipboard hotkey updated to: ${this.currentClipboardHotkey}`,
    };
  }

  isUsingGnomeHotkeys() {
    return this.hotkeyManager.isUsingGnome();
  }

  async startWindowDrag() {
    return await this.dragManager.startWindowDrag();
  }

  async stopWindowDrag() {
    return await this.dragManager.stopWindowDrag();
  }

  openExternalUrl(url, showError = true) {
    shell.openExternal(url).catch((error) => {
      if (showError) {
        dialog.showErrorBox(
          "Unable to Open Link",
          `Failed to open the link in your browser:\n${url}\n\nError: ${error.message}`
        );
      }
    });
  }

  async createControlPanelWindow() {
    if (this.controlPanelWindow && !this.controlPanelWindow.isDestroyed()) {
      if (this.controlPanelWindow.isMinimized()) {
        this.controlPanelWindow.restore();
      }
      if (!this.controlPanelWindow.isVisible()) {
        this.controlPanelWindow.show();
      }
      this.controlPanelWindow.focus();
      return;
    }

    this.controlPanelWindow = new BrowserWindow(CONTROL_PANEL_CONFIG);

    this.controlPanelWindow.webContents.on("will-navigate", (event, url) => {
      const appUrl = DevServerManager.getAppUrl(true);
      const controlPanelUrl = appUrl.startsWith("http") ? appUrl : `file://${appUrl}`;

      if (
        url.startsWith(controlPanelUrl) ||
        url.startsWith("file://") ||
        url.startsWith("devtools://")
      ) {
        return;
      }

      event.preventDefault();
      this.openExternalUrl(url);
    });

    this.controlPanelWindow.webContents.setWindowOpenHandler(({ url }) => {
      this.openExternalUrl(url);
      return { action: "deny" };
    });

    this.controlPanelWindow.webContents.on("did-create-window", (childWindow, details) => {
      childWindow.close();
      if (details.url && !details.url.startsWith("devtools://")) {
        this.openExternalUrl(details.url, false);
      }
    });

    const visibilityTimer = setTimeout(() => {
      if (!this.controlPanelWindow || this.controlPanelWindow.isDestroyed()) {
        return;
      }
      if (!this.controlPanelWindow.isVisible()) {
        this.controlPanelWindow.show();
        this.controlPanelWindow.focus();
      }
    }, 10000);

    const clearVisibilityTimer = () => {
      clearTimeout(visibilityTimer);
    };

    this.controlPanelWindow.once("ready-to-show", () => {
      clearVisibilityTimer();
      // Show dock icon on macOS when control panel opens
      if (process.platform === "darwin" && app.dock) {
        app.dock.show();
      }
      this.controlPanelWindow.show();
      this.controlPanelWindow.focus();
    });

    this.controlPanelWindow.on("close", (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        if (process.platform === "darwin") {
          this.hideControlPanelToTray();
        } else {
          this.controlPanelWindow.minimize();
        }
      }
    });

    this.controlPanelWindow.on("closed", () => {
      clearVisibilityTimer();
      this.controlPanelWindow = null;
    });

    // Set up menu for control panel to ensure text input works
    MenuManager.setupControlPanelMenu(this.controlPanelWindow);

    this.controlPanelWindow.webContents.on("did-finish-load", () => {
      clearVisibilityTimer();
      this.controlPanelWindow.setTitle("Control Panel");
    });

    this.controlPanelWindow.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) {
          return;
        }
        clearVisibilityTimer();
        if (process.env.NODE_ENV !== "development") {
          this.showLoadFailureDialog("Control panel", errorCode, errorDescription, validatedURL);
        }
        if (!this.controlPanelWindow.isVisible()) {
          this.controlPanelWindow.show();
          this.controlPanelWindow.focus();
        }
      }
    );

    await this.loadControlPanel();
  }

  async loadControlPanel() {
    await this.loadWindowContent(this.controlPanelWindow, true);
  }

  showDictationPanel(options = {}) {
    const { focus = false } = options;
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (!this.mainWindow.isVisible()) {
        if (typeof this.mainWindow.showInactive === "function") {
          this.mainWindow.showInactive();
        } else {
          this.mainWindow.show();
        }
      }
      if (focus) {
        this.mainWindow.focus();
      }
    }
  }

  hideControlPanelToTray() {
    if (!this.controlPanelWindow || this.controlPanelWindow.isDestroyed()) {
      return;
    }

    this.controlPanelWindow.hide();

    // Hide dock icon on macOS when control panel is hidden
    if (process.platform === "darwin" && app.dock) {
      app.dock.hide();
    }
  }

  hideDictationPanel() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (process.platform === "darwin") {
        this.mainWindow.hide();
      } else {
        this.mainWindow.minimize();
      }
    }
  }

  isDictationPanelVisible() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return false;
    }

    if (this.mainWindow.isMinimized && this.mainWindow.isMinimized()) {
      return false;
    }

    return this.mainWindow.isVisible();
  }

  registerMainWindowEvents() {
    if (!this.mainWindow) {
      return;
    }

    // Safety timeout: force show the window if ready-to-show doesn't fire within 10 seconds
    const showTimeout = setTimeout(() => {
      if (this.mainWindow && !this.mainWindow.isDestroyed() && !this.mainWindow.isVisible()) {
        this.mainWindow.show();
      }
    }, 10000);

    this.mainWindow.once("ready-to-show", () => {
      clearTimeout(showTimeout);
      this.enforceMainWindowOnTop();
      if (!this.mainWindow.isVisible()) {
        if (typeof this.mainWindow.showInactive === "function") {
          this.mainWindow.showInactive();
        } else {
          this.mainWindow.show();
        }
      }
    });

    this.mainWindow.on("show", () => {
      this.enforceMainWindowOnTop();
    });

    this.mainWindow.on("focus", () => {
      this.enforceMainWindowOnTop();
    });

    this.mainWindow.on("closed", () => {
      this.dragManager.cleanup();
      this.mainWindow = null;
      this.isMainWindowInteractive = false;
    });
  }

  enforceMainWindowOnTop() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      WindowPositionUtil.setupAlwaysOnTop(this.mainWindow);
    }
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
      title: "OpenWhispr failed to load",
      message: "OpenWhispr could not load its UI.",
      detail: detailLines.join("\n"),
    });
  }
}

module.exports = WindowManager;
