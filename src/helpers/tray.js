const { Tray, Menu, nativeImage, app, clipboard, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const { getTrayIconAssetPath } = require("../config/iconPaths.cjs");

const ECHODRAFT_TRAY_GUID = "2f8f0c66-4d16-4aa8-a3ef-8dc364d7c9c4";
const STATUS_ICON_COLORS = {
  idle: "#64748b",
  starting: "#38bdf8",
  listening: "#ef4444",
  transcribing: "#f59e0b",
  cleaning: "#a855f7",
  inserting: "#22c55e",
  saving: "#22c55e",
  done: "#22c55e",
  error: "#ef4444",
  cancelled: "#94a3b8",
};

class TrayManager {
  constructor({ databaseManager = null, clipboardManager = null } = {}) {
    this.tray = null;
    this.mainWindow = null;
    this.controlPanelWindow = null;
    this.windowManager = null;
    this.databaseManager = databaseManager;
    this.clipboardManager = clipboardManager;
    this.lastActionStatus = "";
    this.lastActionStatusAt = 0;
    this.attachedControlPanels = new WeakSet();
    this.dictationStatus = { stage: "idle", stageLabel: "Ready", message: "" };
    this.statusImages = new Map();
    this.baseTrayIcon = null;
  }

  setWindows(mainWindow, controlPanelWindow) {
    this.mainWindow = mainWindow;
    this.controlPanelWindow = controlPanelWindow;

    if (this.mainWindow) {
      this.mainWindow.on("show", () => this.updateTrayMenu?.());
      this.mainWindow.on("hide", () => this.updateTrayMenu?.());
      this.mainWindow.on("minimize", () => this.updateTrayMenu?.());
      this.mainWindow.on("restore", () => this.updateTrayMenu?.());
    }

    if (this.controlPanelWindow) {
      this.attachControlPanelListeners(this.controlPanelWindow);
    }

    this.updateTrayMenu?.();
  }

  setWindowManager(windowManager) {
    this.windowManager = windowManager;
  }

  setDatabaseManager(databaseManager) {
    this.databaseManager = databaseManager;
    this.updateTrayMenu?.();
  }

  setClipboardManager(clipboardManager) {
    this.clipboardManager = clipboardManager;
  }

  setCreateControlPanelCallback(callback) {
    this.createControlPanelCallback = callback;
  }

  attachControlPanelListeners(window) {
    if (!window || this.attachedControlPanels.has(window)) {
      return;
    }

    this.attachedControlPanels.add(window);

    window.on("show", () => {
      this.updateTrayMenu?.();
    });

    window.on("hide", () => {
      this.updateTrayMenu?.();
    });

    window.on("destroyed", () => {
      this.controlPanelWindow = null;
      this.updateTrayMenu?.();
    });
  }

  async showControlPanelFromTray() {
    try {
      if (this.windowManager) {
        this.controlPanelWindow = this.windowManager.controlPanelWindow || this.controlPanelWindow;
      }
      this.attachControlPanelListeners(this.controlPanelWindow);

      if (this.controlPanelWindow && !this.controlPanelWindow.isDestroyed()) {
        // Show dock icon on macOS when control panel opens
        if (process.platform === "darwin" && app.dock) {
          app.dock.show();
        }
        if (this.controlPanelWindow.isMinimized()) {
          this.controlPanelWindow.restore();
        }
        if (!this.controlPanelWindow.isVisible()) {
          this.controlPanelWindow.show();
        }
        this.controlPanelWindow.focus();
        return;
      }

      if (this.createControlPanelCallback) {
        await this.createControlPanelCallback();
        if (this.windowManager) {
          this.controlPanelWindow =
            this.windowManager.controlPanelWindow || this.controlPanelWindow;
        }
        this.attachControlPanelListeners(this.controlPanelWindow);

        if (this.controlPanelWindow && !this.controlPanelWindow.isDestroyed()) {
          this.controlPanelWindow.show();
          this.controlPanelWindow.focus();
        }
        return;
      }

      console.error("No control panel callback available");
    } catch (error) {
      console.error("Failed to open control panel:", error);
    }
  }

  async createTray() {
    if (process.platform !== "darwin" && process.platform !== "win32") return;

    try {
      if (this.tray && !this.tray.isDestroyed?.()) {
        this.updateTrayMenu();
        return;
      }

      const trayIcon = await this.loadTrayIcon();
      if (!trayIcon || trayIcon.isEmpty()) {
        console.error("Failed to load tray icon");
        return;
      }

      this.baseTrayIcon = trayIcon;
      const initialIcon = this.getStatusTrayIcon() || trayIcon;
      this.tray =
        process.platform === "win32"
          ? new Tray(initialIcon, ECHODRAFT_TRAY_GUID)
          : new Tray(initialIcon);

      if (process.platform === "darwin") {
        this.tray.setIgnoreDoubleClickEvents(true);
      }

      this.updateTrayMenu();
      this.setupTrayEventHandlers();
    } catch (error) {
      console.error("Error creating tray icon:", error.message);
    }
  }

  async loadTrayIcon() {
    const platform = process.platform;
    const isDevelopment = process.env.NODE_ENV === "development";
    const trayAssetRelativePath = getTrayIconAssetPath(platform);
    const trayAssetFileName = path.basename(trayAssetRelativePath);

    const candidatePaths = [];

    if (platform === "darwin") {
      if (isDevelopment) {
        candidatePaths.push(path.join(__dirname, "..", "assets", trayAssetFileName));
      } else {
        candidatePaths.push(
          path.join(process.resourcesPath, "src", "assets", trayAssetFileName),
          path.join(process.resourcesPath, "assets", trayAssetFileName),
          path.join(
            process.resourcesPath,
            "app.asar.unpacked",
            "src",
            "assets",
            trayAssetFileName
          ),
          path.join(__dirname, "..", "..", "src", "assets", trayAssetFileName),
          path.join(app.getAppPath(), "src", "assets", trayAssetFileName)
        );
      }
    } else {
      if (isDevelopment) {
        candidatePaths.push(path.join(__dirname, "..", "assets", trayAssetFileName));
      } else {
        candidatePaths.push(
          path.join(process.resourcesPath, "src", "assets", trayAssetFileName),
          path.join(process.resourcesPath, "assets", trayAssetFileName),
          path.join(process.resourcesPath, "app.asar.unpacked", "src", "assets", trayAssetFileName),
          path.join(__dirname, "..", "..", "src", "assets", trayAssetFileName),
          path.join(app.getAppPath(), "src", "assets", trayAssetFileName)
        );
      }
    }

    for (const testPath of candidatePaths) {
      try {
        if (fs.existsSync(testPath)) {
          const icon = nativeImage.createFromPath(testPath);
          if (icon && !icon.isEmpty()) {
            if (platform === "darwin") {
              icon.setTemplateImage(true);
            }
            console.log("Using tray icon:", testPath);
            return icon;
          }
        }
      } catch (error) {
        console.error("Error checking tray icon path:", testPath, error.message);
      }
    }

    if (platform === "win32" && !isDevelopment) {
      try {
        const executableIcon = await app.getFileIcon(process.execPath, { size: "normal" });
        if (executableIcon && !executableIcon.isEmpty()) {
          console.log("Using tray icon from executable:", process.execPath);
          return executableIcon;
        }
      } catch (error) {
        console.error("Error loading tray icon from executable:", error.message);
      }
    }

    console.error("Could not find tray icon in any expected location");
    return this.createFallbackIcon();
  }

  createFallbackIcon() {
    try {
      // Create a simple 16x16 PNG icon programmatically
      const { createCanvas } = require("canvas");
      const canvas = createCanvas(16, 16);
      const ctx = canvas.getContext("2d");

      ctx.fillStyle = "#000000";
      ctx.beginPath();
      ctx.arc(8, 8, 6, 0, 2 * Math.PI);
      ctx.fill();

      const buffer = canvas.toBuffer("image/png");
      const fallbackIcon = nativeImage.createFromBuffer(buffer);
      console.log("✅ Created fallback tray icon");
      return fallbackIcon;
    } catch (fallbackError) {
      console.warn("Canvas not available, creating minimal fallback icon");
      // Create a minimal 16x16 black square PNG as fallback
      const pngData = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
        0x91, 0x68, 0x36, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x28, 0x53, 0x63, 0x08,
        0x05, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe5, 0x27, 0xde, 0xfc, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
      ]);

      const fallbackIcon = nativeImage.createFromBuffer(pngData);
      console.log("✅ Created minimal fallback tray icon");
      return fallbackIcon;
    }
  }

  normalizeTrayStatus(status = {}) {
    if (!status || typeof status !== "object") {
      return { stage: "idle", stageLabel: "Ready", message: "" };
    }

    const stage = typeof status.stage === "string" && status.stage ? status.stage : "idle";
    return {
      stage,
      stageLabel:
        typeof status.stageLabel === "string" && status.stageLabel.trim()
          ? status.stageLabel.trim()
          : this.getDefaultStageLabel(stage),
      message: typeof status.message === "string" ? status.message.trim() : "",
      recordedMs: typeof status.recordedMs === "number" ? status.recordedMs : null,
      elapsedMs: typeof status.elapsedMs === "number" ? status.elapsedMs : null,
      generatedWords: typeof status.generatedWords === "number" ? status.generatedWords : null,
      jobCount: typeof status.jobCount === "number" ? status.jobCount : 0,
      hasTranscript: Boolean(status.hasTranscript),
      outputMode: status.outputMode === "clipboard" ? "clipboard" : "insert",
      provider: typeof status.provider === "string" ? status.provider : "",
      model: typeof status.model === "string" ? status.model : "",
    };
  }

  updateDictationStatus(status = {}) {
    const nextStatus = this.normalizeTrayStatus(status);
    const previousSnapshot = this.getStatusRenderSnapshot(this.dictationStatus);
    const nextSnapshot = this.getStatusRenderSnapshot(nextStatus);
    this.dictationStatus = nextStatus;
    if (previousSnapshot === nextSnapshot) {
      return;
    }
    this.updateTrayMenu();
  }

  getStatusRenderSnapshot(status = {}) {
    return JSON.stringify({
      stage: status.stage || "idle",
      stageLabel: status.stageLabel || "",
      message: status.message || "",
      recorded: typeof status.recordedMs === "number" ? this.formatDuration(status.recordedMs) : "",
      elapsed: typeof status.elapsedMs === "number" ? this.formatDuration(status.elapsedMs) : "",
      generatedWords: status.generatedWords ?? null,
      jobCount: status.jobCount ?? 0,
      hasTranscript: Boolean(status.hasTranscript),
      provider: status.provider || "",
      model: status.model || "",
    });
  }

  getDefaultStageLabel(stage) {
    switch (stage) {
      case "starting":
        return "Starting";
      case "listening":
        return "Recording";
      case "transcribing":
        return "Transcribing";
      case "cleaning":
        return "Cleaning";
      case "inserting":
        return "Inserting";
      case "saving":
        return "Saving";
      case "done":
        return "Done";
      case "error":
        return "Error";
      case "cancelled":
        return "Cancelled";
      default:
        return "Ready";
    }
  }

  getStatusIconKey() {
    const stage = this.dictationStatus?.stage || "idle";
    if (stage === "idle") {
      return this.lastActionStatus && Date.now() - this.lastActionStatusAt < 2500
        ? "done"
        : "idle";
    }
    return STATUS_ICON_COLORS[stage] ? stage : "idle";
  }

  getStatusTrayIcon() {
    if (process.platform !== "win32") {
      return this.baseTrayIcon;
    }

    const key = this.getStatusIconKey();
    if (!this.statusImages.has(key)) {
      const image = this.createStatusIcon(STATUS_ICON_COLORS[key] || STATUS_ICON_COLORS.idle);
      if (image && !image.isEmpty()) {
        this.statusImages.set(key, image);
      }
    }

    return this.statusImages.get(key) || this.baseTrayIcon;
  }

  createStatusIcon(statusColor) {
    const size = 32;
    const pixels = Buffer.alloc(size * size * 4, 0);
    const setPixel = (x, y, color) => {
      if (x < 0 || x >= size || y < 0 || y >= size) return;
      const offset = (y * size + x) * 4;
      pixels[offset] = color.r;
      pixels[offset + 1] = color.g;
      pixels[offset + 2] = color.b;
      pixels[offset + 3] = color.a;
    };
    const hexToRgba = (hex, alpha = 255) => {
      const value = hex.replace("#", "");
      return {
        r: parseInt(value.slice(0, 2), 16),
        g: parseInt(value.slice(2, 4), 16),
        b: parseInt(value.slice(4, 6), 16),
        a: alpha,
      };
    };
    const drawCircle = (cx, cy, radius, color) => {
      const r2 = radius * radius;
      for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
        for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy <= r2) {
            setPixel(x, y, color);
          }
        }
      }
    };
    const drawRect = (x1, y1, x2, y2, color) => {
      for (let y = y1; y <= y2; y += 1) {
        for (let x = x1; x <= x2; x += 1) {
          setPixel(x, y, color);
        }
      }
    };

    const background = hexToRgba("#0f172a");
    const foreground = hexToRgba("#f8fafc");
    const muted = hexToRgba("#94a3b8");
    const dot = hexToRgba(statusColor);

    drawCircle(16, 16, 12, background);
    drawCircle(16, 16, 13, foreground);
    drawCircle(16, 16, 11, background);
    drawRect(9, 15, 11, 17, foreground);
    drawRect(13, 12, 15, 20, foreground);
    drawRect(17, 9, 19, 23, foreground);
    drawRect(21, 13, 23, 19, muted);
    drawCircle(24, 24, 7, foreground);
    drawCircle(24, 24, 5, dot);

    try {
      return nativeImage.createFromBuffer(this.encodePng(size, size, pixels));
    } catch (error) {
      console.error("Failed to create tray status icon:", error.message);
      return this.baseTrayIcon;
    }
  }

  encodePng(width, height, rgbaPixels) {
    const scanlines = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y += 1) {
      const rowStart = y * (width * 4 + 1);
      scanlines[rowStart] = 0;
      rgbaPixels.copy(scanlines, rowStart + 1, y * width * 4, (y + 1) * width * 4);
    }

    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    return Buffer.concat([
      pngSignature,
      this.createPngChunk("IHDR", ihdr),
      this.createPngChunk("IDAT", zlib.deflateSync(scanlines)),
      this.createPngChunk("IEND", Buffer.alloc(0)),
    ]);
  }

  createPngChunk(type, data) {
    const typeBuffer = Buffer.from(type, "ascii");
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(data.length, 0);
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(this.crc32(Buffer.concat([typeBuffer, data])), 0);
    return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
  }

  crc32(buffer) {
    let crc = 0xffffffff;
    for (let i = 0; i < buffer.length; i += 1) {
      crc ^= buffer[i];
      for (let j = 0; j < 8; j += 1) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  getLatestTranscription() {
    try {
      if (!this.databaseManager?.getLatestTranscription) {
        return null;
      }
      return this.databaseManager.getLatestTranscription();
    } catch (error) {
      console.error("Failed to load latest transcription for tray:", error.message);
      return null;
    }
  }

  formatLatestTranscriptionLabel(transcription) {
    if (!transcription?.timestamp) {
      return "Last: None";
    }

    const timestamp = new Date(transcription.timestamp);
    if (Number.isNaN(timestamp.getTime())) {
      return "Last: Saved";
    }

    return `Last: ${timestamp.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  getStatusLabel(dictationVisible) {
    if (this.lastActionStatus && Date.now() - this.lastActionStatusAt < 2500) {
      return this.lastActionStatus;
    }
    void dictationVisible;
    const status = this.dictationStatus || {};
    const label = status.stageLabel || this.getDefaultStageLabel(status.stage || "idle");
    if (status.stage === "listening" && typeof status.recordedMs === "number") {
      return `Status: ${label} ${this.formatDuration(status.recordedMs)}`;
    }
    if (
      ["transcribing", "cleaning", "inserting", "saving"].includes(status.stage) &&
      typeof status.elapsedMs === "number"
    ) {
      return `Status: ${label} ${this.formatDuration(status.elapsedMs)}`;
    }
    if (status.stage === "error" && status.message) {
      return `Status: Error - ${status.message}`;
    }
    return `Status: ${label}`;
  }

  formatDuration(ms = 0) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  setTemporaryStatus(status) {
    this.lastActionStatus = status;
    this.lastActionStatusAt = Date.now();
    this.updateTrayMenu();

    setTimeout(() => {
      if (Date.now() - this.lastActionStatusAt >= 2500) {
        this.lastActionStatus = "";
        this.updateTrayMenu();
      }
    }, 2600);
  }

  async copyLastTranscription() {
    const latest = this.getLatestTranscription();
    const text = typeof latest?.text === "string" ? latest.text : "";

    if (!text.trim()) {
      this.setTemporaryStatus("Status: No saved dictation");
      return;
    }

    try {
      if (this.clipboardManager?.writeClipboard) {
        await this.clipboardManager.writeClipboard(text);
      } else {
        clipboard.writeText(text);
      }
      this.setTemporaryStatus("Status: Copied last dictation");
    } catch (error) {
      console.error("Failed to copy latest transcription from tray:", error.message);
      this.setTemporaryStatus("Status: Copy failed");
    }
  }

  buildContextMenuTemplate() {
    const dictationVisible = false;
    const latestTranscription = this.getLatestTranscription();
    const latestText =
      typeof latestTranscription?.text === "string" ? latestTranscription.text.trim() : "";
    const statusLabel = this.getStatusLabel(dictationVisible);
    const isRecording = this.dictationStatus?.stage === "listening";
    const isBusy = ["starting", "transcribing", "cleaning", "inserting", "saving"].includes(
      this.dictationStatus?.stage
    );

    return [
      {
        label: statusLabel,
        enabled: false,
      },
      {
        label: this.formatLatestTranscriptionLabel(latestTranscription),
        enabled: false,
      },
      {
        label: this.windowManager?.windowsPushToTalkAvailable
          ? "Push-to-talk: Available"
          : "Push-to-talk: Standard hotkey",
        enabled: false,
        visible: process.platform === "win32",
      },
      { type: "separator" },
      {
        label: isRecording ? "Stop Dictation" : "Start Clipboard Dictation",
        enabled: !isBusy,
        click: async () => {
          const payload = this.windowManager?.createSessionPayload?.("clipboard") || {
            outputMode: "clipboard",
          };
          if (isRecording) {
            this.windowManager?.sendStopDictation?.(payload);
          } else {
            this.windowManager?.sendStartDictation?.(payload);
          }
        },
      },
      {
        label: "Copy Last Dictation",
        enabled: Boolean(latestText),
        click: async () => {
          await this.copyLastTranscription();
        },
      },
      {
        label: "Open Control Panel",
        click: async () => {
          await this.showControlPanelFromTray();
        },
      },
      {
        label: "Make Tray Icon Visible...",
        visible: process.platform === "win32",
        click: async () => {
          await shell.openExternal("ms-settings:taskbar");
          this.setTemporaryStatus("Status: Opened taskbar settings");
        },
      },
      { type: "separator" },
      {
        label: "Quit EchoDraft",
        click: () => {
          console.log("Quitting app via tray menu");
          app.quit();
        },
      },
    ];
  }

  updateTrayMenu() {
    if (!this.tray) return;

    const contextMenu = Menu.buildFromTemplate(this.buildContextMenuTemplate());
    const dictationVisible = false;
    const latestLabel = this.formatLatestTranscriptionLabel(this.getLatestTranscription());
    const statusIcon = this.getStatusTrayIcon();
    if (statusIcon && !statusIcon.isEmpty()) {
      this.tray.setImage(statusIcon);
    }
    this.tray.setToolTip(`EchoDraft - ${this.getStatusLabel(dictationVisible)} - ${latestLabel}`);
    this.tray.setContextMenu(contextMenu);
  }

  setupTrayEventHandlers() {
    if (!this.tray) {
      return;
    }

    if (process.platform === "win32") {
      this.tray.on("click", () => {
        this.tray?.popUpContextMenu();
      });
      this.tray.on("right-click", () => {
        this.tray?.popUpContextMenu();
      });
    } else {
      this.tray.on("click", () => {
        this.tray?.popUpContextMenu();
      });
    }

    this.tray.on("destroyed", () => {
      console.log("Tray icon destroyed");
      this.tray = null;
    });
  }
}

module.exports = TrayManager;
