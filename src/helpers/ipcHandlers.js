const { ipcMain, app, shell, BrowserWindow, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const crypto = require("crypto");

const debugLogger = require("./debugLogger");
const { saveDebugAudioCapture } = require("./debugAudioCapture");
const AssemblyAiStreaming = require("./assemblyAiStreaming");

const { createCloudContext } = require("./ipc/cloud/cloudContext");
const { registerAssemblyAiStreamingHandlers } = require("./ipc/handlers/assemblyAiStreamingHandlers");
const { registerAudioFileHandlers } = require("./ipc/handlers/audioFileHandlers");
const { registerAuthHandlers } = require("./ipc/handlers/authHandlers");
const { registerAutoStartHandlers } = require("./ipc/handlers/autoStartHandlers");
const { registerClipboardHandlers } = require("./ipc/handlers/clipboardHandlers");
const { registerCloudApiHandlers } = require("./ipc/handlers/cloudApiHandlers");
const { registerDebugLoggingHandlers } = require("./ipc/handlers/debugLoggingHandlers");
const { registerDictationKeyHandlers } = require("./ipc/handlers/dictationKeyHandlers");
const { registerDictionaryHandlers } = require("./ipc/handlers/dictionaryHandlers");
const { registerE2eHandlers } = require("./ipc/handlers/e2eHandlers");
const { registerEnvironmentHandlers } = require("./ipc/handlers/environmentHandlers");
const { registerLlamaCppHandlers } = require("./ipc/handlers/llamaCppHandlers");
const { registerLlamaServerHandlers } = require("./ipc/handlers/llamaServerHandlers");
const { registerModelManagementHandlers } = require("./ipc/handlers/modelManagementHandlers");
const { registerParakeetHandlers } = require("./ipc/handlers/parakeetHandlers");
const { registerRendererLogHandlers } = require("./ipc/handlers/rendererLogHandlers");
const { registerSystemSettingsHandlers } = require("./ipc/handlers/systemSettingsHandlers");
const { registerTranscriptionDbHandlers } = require("./ipc/handlers/transcriptionDbHandlers");
const { registerUpdateHandlers } = require("./ipc/handlers/updateHandlers");
const { registerUtilityHandlers } = require("./ipc/handlers/utilityHandlers");
const { registerWhisperHandlers } = require("./ipc/handlers/whisperHandlers");
const { registerWindowControlHandlers } = require("./ipc/handlers/windowControlHandlers");
const { isTruthyFlag } = require("./ipc/utils/flags");

const IS_E2E_MODE = isTruthyFlag(process.env.OPENWHISPR_E2E);

class IPCHandlers {
  constructor(managers) {
    this.environmentManager = managers.environmentManager;
    this.databaseManager = managers.databaseManager;
    this.clipboardManager = managers.clipboardManager;
    this.whisperManager = managers.whisperManager;
    this.parakeetManager = managers.parakeetManager;
    this.windowManager = managers.windowManager;
    this.updateManager = managers.updateManager;
    this.windowsKeyManager = managers.windowsKeyManager;
    this.sessionId = crypto.randomUUID();
    this.assemblyAiStreaming = null;
    this.setupHandlers();
  }

  _syncStartupEnv(setVars, clearVars = []) {
    let changed = false;
    for (const [key, value] of Object.entries(setVars)) {
      if (process.env[key] !== value) {
        process.env[key] = value;
        changed = true;
      }
    }
    for (const key of clearVars) {
      if (process.env[key]) {
        delete process.env[key];
        changed = true;
      }
    }
    if (changed) {
      debugLogger.debug("Synced startup env vars", {
        set: Object.keys(setVars),
        cleared: clearVars.filter((k) => !process.env[k]),
      });
      this.environmentManager.saveAllKeysToEnvFile();
    }
  }

  setupHandlers() {
    const broadcastToWindows = this.broadcastToWindows.bind(this);
    const cloudContext = createCloudContext({
      helpersDir: __dirname,
      fs,
      path,
      BrowserWindow,
      debugLogger,
    });

    registerWindowControlHandlers({ ipcMain, app }, { windowManager: this.windowManager });
    registerEnvironmentHandlers({ ipcMain }, { environmentManager: this.environmentManager });

    registerTranscriptionDbHandlers(
      { ipcMain, app, BrowserWindow, dialog, fs, path },
      {
        databaseManager: this.databaseManager,
        windowManager: this.windowManager,
        broadcastToWindows,
      }
    );

    if (IS_E2E_MODE) {
      const { globalShortcut } = require("electron");
      registerE2eHandlers(
        { ipcMain, app, fs, path, globalShortcut },
        {
          databaseManager: this.databaseManager,
          windowManager: this.windowManager,
        }
      );
    }

    registerDictionaryHandlers(
      { ipcMain, app, BrowserWindow, dialog, fs, path },
      {
        databaseManager: this.databaseManager,
        windowManager: this.windowManager,
      }
    );

    registerAudioFileHandlers(
      { ipcMain, BrowserWindow, dialog, fs, path },
      { windowManager: this.windowManager }
    );

    registerClipboardHandlers({ ipcMain }, { clipboardManager: this.clipboardManager });
    registerWhisperHandlers({ ipcMain }, { whisperManager: this.whisperManager });
    registerParakeetHandlers(
      { ipcMain },
      { parakeetManager: this.parakeetManager, environmentManager: this.environmentManager }
    );

    registerUtilityHandlers(
      { ipcMain, shell },
      { windowManager: this.windowManager, windowsKeyManager: this.windowsKeyManager }
    );

    registerAutoStartHandlers({ ipcMain, app });

    registerModelManagementHandlers({ ipcMain }, { environmentManager: this.environmentManager });
    registerDictationKeyHandlers(
      { ipcMain },
      {
        environmentManager: this.environmentManager,
        syncStartupEnv: (setVars, clearVars) => this._syncStartupEnv(setVars, clearVars),
      }
    );
    registerLlamaCppHandlers({ ipcMain });
    registerLlamaServerHandlers({ ipcMain });
    registerRendererLogHandlers({ ipcMain });
    registerSystemSettingsHandlers({ ipcMain, shell });
    registerAuthHandlers({ ipcMain, BrowserWindow });

    registerCloudApiHandlers(
      { ipcMain, app, http, https, shell },
      { cloudContext, sessionId: this.sessionId, whisperManager: this.whisperManager }
    );

    registerDebugLoggingHandlers(
      { ipcMain, app, path, shell, debugLogger, saveDebugAudioCapture },
      { environmentManager: this.environmentManager }
    );
    registerUpdateHandlers({ ipcMain }, { updateManager: this.updateManager });

    const streamingState = {
      get: () => this.assemblyAiStreaming,
      set: (instance) => {
        this.assemblyAiStreaming = instance;
      },
      clear: () => {
        this.assemblyAiStreaming = null;
      },
    };
    registerAssemblyAiStreamingHandlers(
      { ipcMain, BrowserWindow, debugLogger, AssemblyAiStreaming },
      { cloudContext, streamingState }
    );
  }

  broadcastToWindows(channel, payload) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    });
  }
}

module.exports = IPCHandlers;

