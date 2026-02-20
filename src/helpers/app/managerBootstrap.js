const { dialog } = require("electron");

function setupProductionPath({ env = process.env, platform = process.platform } = {}) {
  if (platform === "darwin" && env.NODE_ENV !== "development") {
    const commonPaths = [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ];

    const currentPath = env.PATH || "";
    const pathsToAdd = commonPaths.filter((p) => !currentPath.includes(p));

    if (pathsToAdd.length > 0) {
      env.PATH = `${currentPath}:${pathsToAdd.join(":")}`;
    }
  }
}

function bootstrapManagers() {
  setupProductionPath();

  const debugLogger = require("../debugLogger");
  debugLogger.ensureFileLogging();

  const EnvironmentManager = require("../environment");
  const WindowManager = require("../windowManager");
  const DatabaseManager = require("../database");
  const ClipboardManager = require("../clipboard");
  const WhisperManager = require("../whisper");
  const ParakeetManager = require("../parakeet");
  const TrayManager = require("../tray");
  const UpdateManager = require("../../updater");
  const GlobeKeyManager = require("../globeKeyManager");
  const WindowsKeyManager = require("../windowsKeyManager");
  const IPCHandlers = require("../ipcHandlers");

  const environmentManager = new EnvironmentManager();
  debugLogger.refreshLogLevel();

  const windowManager = new WindowManager();
  const hotkeyManager = windowManager.hotkeyManager;
  const databaseManager = new DatabaseManager();
  const clipboardManager = new ClipboardManager();
  clipboardManager.preWarmAccessibility();
  const whisperManager = new WhisperManager();
  const parakeetManager = new ParakeetManager();
  const trayManager = new TrayManager();
  const updateManager = new UpdateManager();
  const globeKeyManager = new GlobeKeyManager();
  const windowsKeyManager = new WindowsKeyManager();

  // Set up Globe key error handler on macOS
  if (process.platform === "darwin") {
    let globeKeyAlertShown = false;
    globeKeyManager.on("error", (error) => {
      if (globeKeyAlertShown) {
        return;
      }
      globeKeyAlertShown = true;

      const detailLines = [
        error?.message || "Unknown error occurred while starting the Globe listener.",
        "The Globe key shortcut will remain disabled; existing keyboard shortcuts continue to work.",
      ];

      if (process.env.NODE_ENV === "development") {
        detailLines.push(
          "Run `npm run compile:globe` and rebuild the app to regenerate the listener binary."
        );
      } else {
        detailLines.push("Try reinstalling EchoDraft or contact support if the issue persists.");
      }

      dialog.showMessageBox({
        type: "warning",
        title: "Globe Hotkey Unavailable",
        message: "EchoDraft could not activate the Globe key hotkey.",
        detail: detailLines.join("\n\n"),
      });
    });
  }

  // Initialize IPC handlers with all managers
  // eslint-disable-next-line no-new
  new IPCHandlers({
    environmentManager,
    databaseManager,
    clipboardManager,
    whisperManager,
    parakeetManager,
    windowManager,
    updateManager,
    windowsKeyManager,
  });

  return {
    debugLogger,
    environmentManager,
    windowManager,
    hotkeyManager,
    databaseManager,
    clipboardManager,
    whisperManager,
    parakeetManager,
    trayManager,
    updateManager,
    globeKeyManager,
    windowsKeyManager,
  };
}

module.exports = {
  bootstrapManagers,
  setupProductionPath,
};

