const { app, globalShortcut, BrowserWindow, dialog, ipcMain, session } = require("electron");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const {
  getOAuthProtocol,
  parseAuthBridgePort,
  resolveAppChannel,
  shouldRegisterProtocolWithAppArg,
} = require("./src/helpers/app/appConfig");
const { applyPlatformPreReadySetup } = require("./src/helpers/app/platformSetup");
const { startAuthBridgeServer, DEFAULT_AUTH_BRIDGE_HOST, DEFAULT_AUTH_BRIDGE_PATH } = require("./src/helpers/app/authBridgeServer");
const { handleOAuthDeepLink, navigateControlPanelWithVerifier } = require("./src/helpers/app/oauthDeepLink");
const { bootstrapManagers } = require("./src/helpers/app/managerBootstrap");
const { installNeonAuthOriginFix } = require("./src/helpers/app/neonAuthOriginFix");
const { isLiveWindow } = require("./src/helpers/app/windowUtils");
const { registerMacOsGlobeHotkeys } = require("./src/helpers/app/platformHotkeys/macosGlobeHotkeys");
const { registerWindowsPushToTalk } = require("./src/helpers/app/platformHotkeys/windowsPushToTalk");

const APP_CHANNEL = resolveAppChannel();
process.env.OPENWHISPR_CHANNEL = APP_CHANNEL;
applyPlatformPreReadySetup({ app, channel: APP_CHANNEL });

const OAUTH_PROTOCOL = getOAuthProtocol({ channel: APP_CHANNEL });

// Register custom protocol for OAuth callbacks.
// In development, always include the app path argument so macOS/Windows/Linux
// can launch the project app instead of opening bare Electron.
function registerEchoDraftProtocol() {
  const protocol = OAUTH_PROTOCOL;

  if (shouldRegisterProtocolWithAppArg()) {
    const appArg = process.argv[1] ? path.resolve(process.argv[1]) : path.resolve(".");
    return app.setAsDefaultProtocolClient(protocol, process.execPath, [appArg]);
  }

  return app.setAsDefaultProtocolClient(protocol);
}

const protocolRegistered = registerEchoDraftProtocol();
if (!protocolRegistered) {
  console.warn(`[Auth] Failed to register ${OAUTH_PROTOCOL}:// protocol handler`);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.exit(0);
}

// Ensure macOS menus use the proper casing for the app name
if (process.platform === "darwin" && app.getName() !== "EchoDraft") {
  app.setName("EchoDraft");
}

// Add global error handling for uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  // Don't exit the process for EPIPE errors as they're harmless
  if (error.code === "EPIPE") {
    return;
  }
  // For other errors, log and continue
  console.error("Error stack:", error.stack);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Manager instances - initialized after app.whenReady()
let debugLogger = null;
let environmentManager = null;
let windowManager = null;
let hotkeyManager = null;
let clipboardManager = null;
let whisperManager = null;
let parakeetManager = null;
let trayManager = null;
let updateManager = null;
let globeKeyManager = null;
let windowsKeyManager = null;
let authBridgeServer = null;

const AUTH_BRIDGE_HOST = DEFAULT_AUTH_BRIDGE_HOST;
const AUTH_BRIDGE_PORT = parseAuthBridgePort();
const AUTH_BRIDGE_PATH = DEFAULT_AUTH_BRIDGE_PATH;

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (!url.startsWith(`${OAUTH_PROTOCOL}://`)) return;

  handleOAuthDeepLink({
    deepLinkUrl: url,
    windowManager,
    appChannel: APP_CHANNEL,
    oauthProtocol: OAUTH_PROTOCOL,
    debugLogger,
  });

  if (windowManager && isLiveWindow(windowManager.controlPanelWindow)) {
    windowManager.controlPanelWindow.show();
    windowManager.controlPanelWindow.focus();
  }
});

// Main application startup
async function startApp() {
  // Initialize all managers now that app is ready
  const managers = bootstrapManagers();
  debugLogger = managers.debugLogger;
  environmentManager = managers.environmentManager;
  windowManager = managers.windowManager;
  hotkeyManager = managers.hotkeyManager;
  clipboardManager = managers.clipboardManager;
  whisperManager = managers.whisperManager;
  parakeetManager = managers.parakeetManager;
  trayManager = managers.trayManager;
  updateManager = managers.updateManager;
  globeKeyManager = managers.globeKeyManager;
  windowsKeyManager = managers.windowsKeyManager;
  if (!authBridgeServer) {
    authBridgeServer = startAuthBridgeServer({
      channel: APP_CHANNEL,
      host: AUTH_BRIDGE_HOST,
      port: AUTH_BRIDGE_PORT,
      path: AUTH_BRIDGE_PATH,
      debugLogger,
      onVerifier: (verifier) =>
        navigateControlPanelWithVerifier({
          windowManager,
          verifier,
          appChannel: APP_CHANNEL,
          oauthProtocol: OAUTH_PROTOCOL,
          debugLogger,
        }),
    });
  }

  installNeonAuthOriginFix(session);

  // Initialize activation mode cache from persisted .env value
  windowManager.setActivationModeCache(environmentManager.getActivationMode());

  // Update cache + persist when renderer changes activation mode (all platforms)
  ipcMain.on("activation-mode-changed", (_event, mode) => {
    windowManager.setActivationModeCache(mode);
    environmentManager.saveActivationMode(mode);
  });

  // In development, add a small delay to let Vite start properly
  if (process.env.NODE_ENV === "development") {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // On macOS, set activation policy to allow dock icon to be shown/hidden dynamically
  // The dock icon visibility is managed by WindowManager based on control panel state
  if (process.platform === "darwin") {
    app.setActivationPolicy("regular");
  }

  // Initialize Whisper manager at startup (don't await to avoid blocking)
  // Settings can be provided via environment variables for server pre-warming:
  // - LOCAL_TRANSCRIPTION_PROVIDER=whisper to enable local whisper mode
  // - LOCAL_WHISPER_MODEL=base (or tiny, small, medium, large, turbo)
  const whisperSettings = {
    localTranscriptionProvider: process.env.LOCAL_TRANSCRIPTION_PROVIDER || "",
    whisperModel: process.env.LOCAL_WHISPER_MODEL,
  };
  whisperManager.initializeAtStartup(whisperSettings).catch((err) => {
    // Whisper not being available at startup is not critical
    debugLogger.debug("Whisper startup init error (non-fatal)", { error: err.message });
  });

  // Initialize Parakeet manager at startup (don't await to avoid blocking)
  // Settings can be provided via environment variables for server pre-warming:
  // - LOCAL_TRANSCRIPTION_PROVIDER=nvidia to enable parakeet
  // - PARAKEET_MODEL=parakeet-tdt-0.6b-v3 (model name)
  const parakeetSettings = {
    localTranscriptionProvider: process.env.LOCAL_TRANSCRIPTION_PROVIDER || "",
    parakeetModel: process.env.PARAKEET_MODEL,
  };
  parakeetManager.initializeAtStartup(parakeetSettings).catch((err) => {
    // Parakeet not being available at startup is not critical
    debugLogger.debug("Parakeet startup init error (non-fatal)", { error: err.message });
  });

  // Pre-warm llama-server if local reasoning is configured
  // Settings can be provided via environment variables:
  // - REASONING_PROVIDER=local to enable local reasoning
  // - LOCAL_REASONING_MODEL=qwen3-8b-q4_k_m (or another model ID)
  if (process.env.REASONING_PROVIDER === "local" && process.env.LOCAL_REASONING_MODEL) {
    const modelManager = require("./src/helpers/modelManagerBridge").default;
    modelManager.prewarmServer(process.env.LOCAL_REASONING_MODEL).catch((err) => {
      debugLogger.debug("llama-server pre-warm error (non-fatal)", { error: err.message });
    });
  }

  // Log nircmd status on Windows (for debugging bundled dependencies)
  if (process.platform === "win32") {
    const nircmdStatus = clipboardManager.getNircmdStatus();
    debugLogger.debug("Windows paste tool status", nircmdStatus);
  }

  // Create main window
  await windowManager.createMainWindow();

  // Create control panel window
  await windowManager.createControlPanelWindow();

  // Set up tray
  trayManager.setWindows(windowManager.mainWindow, windowManager.controlPanelWindow);
  trayManager.setWindowManager(windowManager);
  trayManager.setCreateControlPanelCallback(() => windowManager.createControlPanelWindow());
  await trayManager.createTray();

  // Set windows for update manager and check for updates
  updateManager.setWindows(windowManager.mainWindow, windowManager.controlPanelWindow);
  updateManager.checkForUpdatesOnStartup();

  registerMacOsGlobeHotkeys({ ipcMain, windowManager, hotkeyManager, globeKeyManager });
  registerWindowsPushToTalk({
    ipcMain,
    windowManager,
    hotkeyManager,
    windowsKeyManager,
    debugLogger,
  });
}

// Listen for usage limit reached from dictation overlay, forward to control panel
ipcMain.on("limit-reached", (_event, data) => {
  if (isLiveWindow(windowManager?.controlPanelWindow)) {
    windowManager.controlPanelWindow.webContents.send("limit-reached", data);
  }
});

// App event handlers
if (gotSingleInstanceLock) {
  app.on("second-instance", async (_event, commandLine) => {
    await app.whenReady();
    if (!windowManager) {
      return;
    }

    if (isLiveWindow(windowManager.controlPanelWindow)) {
      if (windowManager.controlPanelWindow.isMinimized()) {
        windowManager.controlPanelWindow.restore();
      }
      windowManager.controlPanelWindow.show();
      windowManager.controlPanelWindow.focus();
    } else {
      windowManager.createControlPanelWindow();
    }

    if (isLiveWindow(windowManager.mainWindow)) {
      windowManager.enforceMainWindowOnTop();
    } else {
      windowManager.createMainWindow();
    }

    // Check for OAuth protocol URL in command line arguments (Windows/Linux)
    const url = commandLine.find((arg) => arg.startsWith(`${OAUTH_PROTOCOL}://`));
    if (url) {
      handleOAuthDeepLink({
        deepLinkUrl: url,
        windowManager,
        appChannel: APP_CHANNEL,
        oauthProtocol: OAUTH_PROTOCOL,
        debugLogger,
      });
    }
  });

  app.whenReady().then(() => {
    // On Linux, --enable-transparent-visuals requires a short delay before creating
    // windows to allow the compositor to set up the ARGB visual correctly.
    // Without this delay, transparent windows flicker on both X11 and Wayland.
    const delay = process.platform === "linux" ? 300 : 0;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }).then(() => {
    startApp().catch((error) => {
      console.error("Failed to start app:", error);
      dialog.showErrorBox(
        "EchoDraft Startup Error",
        `Failed to start the application:\n\n${error.message}\n\nPlease report this issue.`
      );
      app.exit(1);
    });
  });

  app.on("window-all-closed", () => {
    // Don't quit on macOS when all windows are closed
    // The app should stay in the dock/menu bar
    if (process.platform !== "darwin") {
      app.quit();
    }
    // On macOS, keep the app running even without windows
  });

  app.on("browser-window-focus", (event, window) => {
    // Only apply always-on-top to the dictation window, not the control panel
    if (windowManager && isLiveWindow(windowManager.mainWindow)) {
      // Check if the focused window is the dictation window
      if (window === windowManager.mainWindow) {
        windowManager.enforceMainWindowOnTop();
      }
    }

    // Control panel doesn't need any special handling on focus
    // It should behave like a normal window
  });

  app.on("activate", () => {
    // On macOS, re-create windows when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      if (windowManager) {
        windowManager.createMainWindow();
        windowManager.createControlPanelWindow();
      }
    } else {
      // Show control panel when dock icon is clicked (most common user action)
      if (windowManager && isLiveWindow(windowManager.controlPanelWindow)) {
        // Ensure dock icon is visible when control panel opens
        if (process.platform === "darwin" && app.dock) {
          app.dock.show();
        }
        if (windowManager.controlPanelWindow.isMinimized()) {
          windowManager.controlPanelWindow.restore();
        }
        windowManager.controlPanelWindow.show();
        windowManager.controlPanelWindow.focus();
      } else if (windowManager) {
        // If control panel doesn't exist, create it
        windowManager.createControlPanelWindow();
      }

      // Ensure dictation panel maintains its always-on-top status
      if (windowManager && isLiveWindow(windowManager.mainWindow)) {
        windowManager.enforceMainWindowOnTop();
      }
    }
  });

  app.on("will-quit", () => {
    if (authBridgeServer) {
      authBridgeServer.close();
      authBridgeServer = null;
    }
    if (hotkeyManager) {
      hotkeyManager.unregisterAll();
    } else {
      globalShortcut.unregisterAll();
    }
    if (globeKeyManager) {
      globeKeyManager.stop();
    }
    if (windowsKeyManager) {
      windowsKeyManager.stop();
    }
    if (updateManager) {
      updateManager.cleanup();
    }
    // Stop whisper server if running
    if (whisperManager) {
      whisperManager.stopServer().catch(() => {});
    }
    // Stop parakeet WS server if running
    if (parakeetManager) {
      parakeetManager.stopServer().catch(() => {});
    }
    // Stop llama-server if running
    const modelManager = require("./src/helpers/modelManagerBridge").default;
    modelManager.stopServer().catch(() => {});
  });
}
