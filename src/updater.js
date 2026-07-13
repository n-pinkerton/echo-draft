const { isTruthyFlag } = require("./helpers/utils/flags");
const { areAutomaticUpdatesTrusted } = require("./config/updateTrust");

const UNSIGNED_WINDOWS_UPDATE_MESSAGE =
  "Automatic updates are disabled for this unsigned Windows build. Install a verified EchoDraft release manually.";
const UNSUPPORTED_LINUX_UPDATE_MESSAGE =
  "Automatic installation is disabled on Linux until independently signed update verification is available. Install a verified EchoDraft release manually.";
const VERIFIED_RELEASES_URL = "https://github.com/n-pinkerton/echo-draft/releases";
const PINNED_UPDATE_CONFIG = Object.freeze({
  provider: "github",
  owner: "n-pinkerton",
  repo: "echo-draft",
  private: false,
});

function getErrorMessage(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (typeof err?.message === "string") return err.message;
  try {
    return String(err);
  } catch {
    return "";
  }
}

function isNoPublishedVersionsError(err) {
  const message = getErrorMessage(err).toLowerCase();
  return message.includes("no published versions on github");
}

function getGithubUpdateConfig() {
  return { ...PINNED_UPDATE_CONFIG };
}

const getAutomaticUpdatesDisabledMessage = (platform) =>
  platform === "linux" ? UNSUPPORTED_LINUX_UPDATE_MESSAGE : UNSIGNED_WINDOWS_UPDATE_MESSAGE;

class UpdateManager {
  constructor({ platform = process.platform, updater = null } = {}) {
    this.platform = platform;
    this.mainWindow = null;
    this.controlPanelWindow = null;
    this.windowProvider = null;
    this.updateAvailable = false;
    this.updateDownloaded = false;
    this.hasCheckedForUpdates = false;
    this.isCheckingForUpdates = false;
    this.lastUpdateInfo = null;
    this.isInstalling = false;
    this.isDownloading = false;
    this.eventListeners = [];
    this.startupCheckTimer = null;
    this.inFlightCheckPromise = null;
    this.activeCheckContext = null;
    this.notifiedUpdateErrors = new WeakSet();
    this.updatesTrusted = areAutomaticUpdatesTrusted({ platform });
    this.disabledMessage = getAutomaticUpdatesDisabledMessage(platform);
    this.autoUpdater = updater;

    this.setupAutoUpdater();
  }

  getAutoUpdater() {
    if (!this.autoUpdater) {
      this.autoUpdater = require("electron-updater").autoUpdater;
    }
    return this.autoUpdater;
  }

  setWindows(mainWindow, controlPanelWindow) {
    this.mainWindow = mainWindow;
    this.controlPanelWindow = controlPanelWindow;
  }

  setWindowProvider(provider) {
    if (provider !== null && typeof provider !== "function") {
      throw new Error("Update window provider must be a function");
    }
    this.windowProvider = provider;
  }

  getCurrentWindows() {
    const current = this.windowProvider?.() || {};
    const hasLiveMainWindow = Object.prototype.hasOwnProperty.call(current, "mainWindow");
    const hasLiveControlPanelWindow = Object.prototype.hasOwnProperty.call(
      current,
      "controlPanelWindow"
    );
    return {
      mainWindow: hasLiveMainWindow ? current.mainWindow : this.mainWindow,
      controlPanelWindow: hasLiveControlPanelWindow
        ? current.controlPanelWindow
        : this.controlPanelWindow,
    };
  }

  setupAutoUpdater() {
    // Only configure auto-updater in production
    if (process.env.NODE_ENV === "development") {
      // Auto-updater disabled in development mode
      return;
    }

    if (!this.updatesTrusted) {
      return;
    }

    const autoUpdater = this.getAutoUpdater();

    // Configure auto-updater for GitHub releases
    autoUpdater.setFeedURL(getGithubUpdateConfig());

    // Disable auto-download - let user control when to download
    autoUpdater.autoDownload = false;

    // Enable auto-install on quit - if user ignores update and quits normally,
    // the update will install automatically (best UX)
    // User can also manually trigger install with "Install & Restart" button
    autoUpdater.autoInstallOnAppQuit = true;

    // Enable logging in production for debugging (logs are user-accessible)
    autoUpdater.logger = console;

    // Set up event handlers
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    const autoUpdater = this.getAutoUpdater();
    const handlers = {
      "checking-for-update": () => {
        const shouldNotify = !this.isCheckingForUpdates;
        this.isCheckingForUpdates = true;
        if (shouldNotify) this.notifyRenderers("checking-for-update");
      },
      "update-available": (info) => {
        this.hasCheckedForUpdates = true;
        this.isCheckingForUpdates = false;
        this.updateAvailable = true;
        if (info) {
          this.lastUpdateInfo = {
            version: info.version,
            releaseDate: info.releaseDate,
            releaseNotes: info.releaseNotes,
            files: info.files,
          };
        }
        this.notifyRenderers("update-available", info);
      },
      "update-not-available": (info) => {
        this.hasCheckedForUpdates = true;
        this.isCheckingForUpdates = false;
        this.updateAvailable = false;
        this.updateDownloaded = false;
        this.isDownloading = false;
        this.lastUpdateInfo = null;
        this.notifyRenderers("update-not-available", info);
      },
      error: (err) => {
        console.error("❌ Auto-updater error:", err);
        this.isCheckingForUpdates = false;
        this.isDownloading = false;
        if (isNoPublishedVersionsError(err)) {
          // Common in forks: electron-updater throws when the repo has no releases yet.
          // Treat as "no updates available" instead of surfacing a disruptive error toast.
          this.updateAvailable = false;
          this.updateDownloaded = false;
          this.hasCheckedForUpdates = true;
          this.lastUpdateInfo = null;
          this.notifyRenderers("update-not-available", {
            message: "No published versions available for updates",
          });
          return;
        }

        this.notifyUpdateErrorOnce(err, this.activeCheckContext);
      },
      "download-progress": (progressObj) => {
        console.log(
          `📥 Download progress: ${progressObj.percent.toFixed(2)}% (${(progressObj.transferred / 1024 / 1024).toFixed(2)}MB / ${(progressObj.total / 1024 / 1024).toFixed(2)}MB)`
        );
        this.notifyRenderers("update-download-progress", progressObj);
      },
      "update-downloaded": (info) => {
        console.log("✅ Update downloaded successfully:", info?.version);
        this.updateDownloaded = true;
        this.isDownloading = false;
        if (info) {
          this.lastUpdateInfo = {
            version: info.version,
            releaseDate: info.releaseDate,
            releaseNotes: info.releaseNotes,
            files: info.files,
          };
        }
        this.notifyRenderers("update-downloaded", info);
      },
    };

    // Register and track event listeners for cleanup
    Object.entries(handlers).forEach(([event, handler]) => {
      autoUpdater.on(event, handler);
      this.eventListeners.push({ event, handler });
    });
  }

  notifyRenderers(channel, data) {
    const { mainWindow, controlPanelWindow } = this.getCurrentWindows();
    const windows = new Set([mainWindow, controlPanelWindow]);
    for (const window of windows) {
      if (window && !window.isDestroyed() && window.webContents) {
        window.webContents.send(channel, data);
      }
    }
  }

  notifyUpdateErrorOnce(error, context = null) {
    if (context?.errorNotified) return;
    if (error && typeof error === "object" && this.notifiedUpdateErrors.has(error)) return;
    if (context) context.errorNotified = true;
    if (error && typeof error === "object") this.notifiedUpdateErrors.add(error);
    this.notifyRenderers("update-error", error);
  }

  async checkForUpdates() {
    if (process.env.NODE_ENV === "development") {
      return {
        updateAvailable: false,
        message: "Update checks are disabled in development mode",
      };
    }

    if (!this.updatesTrusted) {
      return {
        updateAvailable: false,
        message: this.disabledMessage,
      };
    }

    if (this.inFlightCheckPromise) {
      return await this.inFlightCheckPromise;
    }

    const context = { errorNotified: false };
    this.activeCheckContext = context;
    const checkPromise = (async () => {
      try {
        console.log("🔍 Checking for updates...");
        this.isCheckingForUpdates = true;
        this.notifyRenderers("checking-for-update");
        const result = await this.getAutoUpdater().checkForUpdates();

        if (result?.isUpdateAvailable && result?.updateInfo) {
          const shouldNotify = this.isCheckingForUpdates;
          this.hasCheckedForUpdates = true;
          this.isCheckingForUpdates = false;
          this.updateAvailable = true;
          this.lastUpdateInfo = {
            version: result.updateInfo.version,
            releaseDate: result.updateInfo.releaseDate,
            releaseNotes: result.updateInfo.releaseNotes,
            files: result.updateInfo.files,
          };
          if (shouldNotify) this.notifyRenderers("update-available", result.updateInfo);
          console.log("📋 Update available:", result.updateInfo.version);
          console.log(
            "📦 Download size:",
            result.updateInfo.files?.map((f) => `${(f.size / 1024 / 1024).toFixed(2)}MB`).join(", ")
          );
          return {
            updateAvailable: true,
            version: result.updateInfo.version,
            releaseDate: result.updateInfo.releaseDate,
            files: result.updateInfo.files,
            releaseNotes: result.updateInfo.releaseNotes,
          };
        } else {
          const shouldNotify = this.isCheckingForUpdates;
          this.hasCheckedForUpdates = true;
          this.isCheckingForUpdates = false;
          this.updateAvailable = false;
          this.updateDownloaded = false;
          this.lastUpdateInfo = null;
          if (shouldNotify) this.notifyRenderers("update-not-available", result?.updateInfo);
          console.log("✅ Already on latest version");
          return {
            updateAvailable: false,
            message: "You are running the latest version",
          };
        }
      } catch (error) {
        const shouldNotify = this.isCheckingForUpdates;
        this.isCheckingForUpdates = false;
        if (isNoPublishedVersionsError(error)) {
          this.hasCheckedForUpdates = true;
          this.updateAvailable = false;
          this.updateDownloaded = false;
          this.lastUpdateInfo = null;
          if (shouldNotify) {
            this.notifyRenderers("update-not-available", {
              message: "No published versions available for updates",
            });
          }
          return {
            updateAvailable: false,
            message: "No published versions available for updates",
          };
        }

        this.notifyUpdateErrorOnce(error, context);
        console.error("❌ Update check error:", error);
        throw error;
      }
    })();
    this.inFlightCheckPromise = checkPromise;
    try {
      return await checkPromise;
    } finally {
      if (this.inFlightCheckPromise === checkPromise) {
        this.inFlightCheckPromise = null;
      }
      if (this.activeCheckContext === context) {
        this.activeCheckContext = null;
      }
    }
  }

  async downloadUpdate() {
    try {
      if (process.env.NODE_ENV === "development") {
        return {
          success: false,
          message: "Update downloads are disabled in development mode",
        };
      }

      if (!this.updatesTrusted) {
        return { success: false, message: this.disabledMessage };
      }

      if (this.isDownloading) {
        return {
          success: true,
          message: "Download already in progress",
        };
      }

      if (this.updateDownloaded) {
        return {
          success: true,
          message: "Update already downloaded. Ready to install.",
        };
      }

      this.isDownloading = true;
      console.log("📥 Starting update download...");
      await this.getAutoUpdater().downloadUpdate();
      console.log("📥 Download initiated successfully");

      return { success: true, message: "Update download started" };
    } catch (error) {
      this.isDownloading = false;
      console.error("❌ Update download error:", error);
      throw error;
    }
  }

  async installUpdate() {
    try {
      if (process.env.NODE_ENV === "development") {
        return {
          success: false,
          message: "Update installation is disabled in development mode",
        };
      }

      if (!this.updatesTrusted) {
        return { success: false, message: this.disabledMessage };
      }

      if (!this.updateDownloaded) {
        return {
          success: false,
          message: "No update available to install",
        };
      }

      if (this.isInstalling) {
        return {
          success: false,
          message: "Update installation already in progress",
        };
      }

      this.isInstalling = true;
      console.log("🔄 Installing update and restarting...");

      const { app, BrowserWindow } = require("electron");

      // Remove listeners that prevent windows from closing
      // so quitAndInstall can shut down cleanly
      app.removeAllListeners("window-all-closed");
      BrowserWindow.getAllWindows().forEach((win) => {
        win.removeAllListeners("close");
      });

      const isSilent = process.platform === "win32";
      this.getAutoUpdater().quitAndInstall(isSilent, true);

      return { success: true, message: "Update installation started" };
    } catch (error) {
      this.isInstalling = false;
      console.error("❌ Update installation error:", error);
      throw error;
    }
  }

  async getAppVersion() {
    try {
      const { app } = require("electron");
      return { version: app.getVersion() };
    } catch (error) {
      console.error("❌ Error getting app version:", error);
      throw error;
    }
  }

  async getUpdateStatus() {
    try {
      return {
        updateAvailable: this.updateAvailable,
        updateDownloaded: this.updateDownloaded,
        hasCheckedForUpdates: this.hasCheckedForUpdates,
        isChecking: this.isCheckingForUpdates,
        isDevelopment: process.env.NODE_ENV === "development",
        updatesEnabled: process.env.NODE_ENV !== "development" && this.updatesTrusted,
        ...(!this.updatesTrusted ? { disabledReason: this.disabledMessage } : {}),
      };
    } catch (error) {
      console.error("❌ Error getting update status:", error);
      throw error;
    }
  }

  async getUpdateInfo() {
    try {
      return this.lastUpdateInfo;
    } catch (error) {
      console.error("❌ Error getting update info:", error);
      throw error;
    }
  }

  checkForUpdatesOnStartup() {
    if (
      isTruthyFlag(process.env.OPENWHISPR_E2E) ||
      isTruthyFlag(process.env.OPENWHISPR_DISABLE_UPDATES) ||
      !this.updatesTrusted
    ) {
      return;
    }
    if (process.env.NODE_ENV !== "development") {
      if (this.startupCheckTimer) clearTimeout(this.startupCheckTimer);
      this.startupCheckTimer = setTimeout(() => {
        this.startupCheckTimer = null;
        console.log("🔄 Checking for updates on startup...");
        this.checkForUpdates().catch((err) => {
          console.error("Startup update check failed:", err);
        });
      }, 3000);
    }
  }

  cleanup() {
    if (this.startupCheckTimer) {
      clearTimeout(this.startupCheckTimer);
      this.startupCheckTimer = null;
    }
    const autoUpdater = this.autoUpdater;
    if (!autoUpdater) {
      this.eventListeners = [];
      return;
    }
    this.eventListeners.forEach(({ event, handler }) => {
      autoUpdater.removeListener(event, handler);
    });
    this.eventListeners = [];
  }
}

module.exports = UpdateManager;
module.exports.PINNED_UPDATE_CONFIG = PINNED_UPDATE_CONFIG;
module.exports.VERIFIED_RELEASES_URL = VERIFIED_RELEASES_URL;
module.exports.getGithubUpdateConfig = getGithubUpdateConfig;
