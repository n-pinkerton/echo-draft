const fs = require("fs");

const debugLogger = require("../debugLogger");
const WhisperServerManager = require("../whisperServer");
const { clearCache: clearFFmpegCache, getFFmpegPath } = require("../ffmpegUtils");
const { coerceAudioBlobToBuffer } = require("../audioBufferUtils");

const { getValidWhisperModelNames } = require("./modelRegistry");
const { parseWhisperResult } = require("./resultParser");
const { WhisperModelStore } = require("./WhisperModelStore");

const CACHE_TTL_MS = 30000;

class WhisperManager {
  constructor() {
    this.ffmpegAvailabilityCache = { result: null, expiresAt: 0 };
    this.isInitialized = false;
    this.models = new WhisperModelStore();
    this.serverManager = new WhisperServerManager();
    this.currentServerModel = null;
  }

  getModelsDir() {
    return this.models.getModelsDir();
  }

  validateModelName(modelName) {
    return this.models.validateModelName(modelName);
  }

  getModelPath(modelName) {
    return this.models.getModelPath(modelName);
  }

  async initializeAtStartup(settings = {}) {
    const startTime = Date.now();

    try {
      this.isInitialized = true;

      const { localTranscriptionProvider, whisperModel } = settings;

      if (
        localTranscriptionProvider === "whisper" &&
        whisperModel &&
        this.serverManager.isAvailable()
      ) {
        const modelPath = this.getModelPath(whisperModel);

        if (fs.existsSync(modelPath)) {
          debugLogger.info("Pre-warming whisper-server", {
            model: whisperModel,
            modelPath,
          });

          try {
            const serverStartTime = Date.now();
            await this.serverManager.start(modelPath);
            this.currentServerModel = whisperModel;

            debugLogger.info("whisper-server pre-warmed successfully", {
              model: whisperModel,
              startupTimeMs: Date.now() - serverStartTime,
              port: this.serverManager.port,
            });
          } catch (err) {
            debugLogger.warn("Server pre-warm failed (will start on first use)", {
              error: err.message,
              model: whisperModel,
            });
          }
        } else {
          debugLogger.debug("Skipping server pre-warm: model not downloaded", {
            model: whisperModel,
            modelPath,
          });
        }
      } else {
        debugLogger.debug("Skipping server pre-warm", {
          reason:
            localTranscriptionProvider !== "whisper"
              ? "provider not whisper"
              : !whisperModel
                ? "no model selected"
                : "server binary not available",
        });
      }
    } catch (error) {
      debugLogger.warn("Whisper initialization error", {
        error: error.message,
      });
      this.isInitialized = true;
    }

    debugLogger.info("Whisper initialization complete", {
      totalTimeMs: Date.now() - startTime,
      serverRunning: this.serverManager.ready,
    });

    await this.logDependencyStatus();
  }

  async logDependencyStatus() {
    const status = {
      whisperServer: {
        available: this.serverManager.isAvailable(),
        path: this.serverManager.getServerBinaryPath(),
      },
      ffmpeg: {
        available: false,
        path: null,
      },
      models: [],
    };

    try {
      const ffmpegPath = getFFmpegPath();
      status.ffmpeg.available = Boolean(ffmpegPath);
      status.ffmpeg.path = ffmpegPath;
    } catch {
      // FFmpeg not available
    }

    for (const modelName of getValidWhisperModelNames()) {
      const modelPath = this.getModelPath(modelName);
      if (fs.existsSync(modelPath)) {
        try {
          const stats = fs.statSync(modelPath);
          status.models.push({
            name: modelName,
            size: `${Math.round(stats.size / (1024 * 1024))}MB`,
          });
        } catch {
          // Skip if can't stat
        }
      }
    }

    debugLogger.info("EchoDraft dependency check", status);

    const serverStatus = status.whisperServer.available
      ? `✓ ${status.whisperServer.path}`
      : "✗ Not found";
    const ffmpegStatus = status.ffmpeg.available ? `✓ ${status.ffmpeg.path}` : "✗ Not found";
    const modelsStatus =
      status.models.length > 0
        ? status.models.map((m) => `${m.name} (${m.size})`).join(", ")
        : "None downloaded";

    debugLogger.info(`[Dependencies] whisper-server: ${serverStatus}`);
    debugLogger.info(`[Dependencies] FFmpeg: ${ffmpegStatus}`);
    debugLogger.info(`[Dependencies] Models: ${modelsStatus}`);
  }

  async startServer(modelName) {
    if (!this.serverManager.isAvailable()) {
      return { success: false, reason: "whisper-server binary not found" };
    }

    const modelPath = this.getModelPath(modelName);
    if (!fs.existsSync(modelPath)) {
      return { success: false, reason: `Model \"${modelName}\" not downloaded` };
    }

    try {
      await this.serverManager.start(modelPath);
      this.currentServerModel = modelName;
      debugLogger.info("whisper-server started", {
        model: modelName,
        port: this.serverManager.port,
      });
      return { success: true, port: this.serverManager.port };
    } catch (error) {
      debugLogger.error("Failed to start whisper-server", { error: error.message });
      return { success: false, reason: error.message };
    }
  }

  async stopServer() {
    await this.serverManager.stop();
    this.currentServerModel = null;
  }

  getServerStatus() {
    return this.serverManager.getStatus();
  }

  async checkWhisperInstallation() {
    const serverPath = this.serverManager.getServerBinaryPath();
    if (!serverPath) {
      return { installed: false, working: false };
    }

    return {
      installed: true,
      working: this.serverManager.isAvailable(),
      path: serverPath,
    };
  }

  async transcribeLocalWhisper(audioBlob, options = {}) {
    debugLogger.logWhisperPipeline("transcribeLocalWhisper - start", {
      options,
      audioBlobType: audioBlob?.constructor?.name,
      audioBlobSize: audioBlob?.byteLength || audioBlob?.size || 0,
      serverAvailable: this.serverManager.isAvailable(),
      serverReady: this.serverManager.ready,
    });

    if (!this.serverManager.isAvailable()) {
      throw new Error(
        "whisper-server binary not found. Please ensure the app is installed correctly."
      );
    }

    const model = options.model || "base";
    const language = options.language || null;
    const initialPrompt = options.initialPrompt || null;
    const modelPath = this.getModelPath(model);

    if (!fs.existsSync(modelPath)) {
      throw new Error(`Whisper model \"${model}\" not downloaded. Please download it from Settings.`);
    }

    return await this.transcribeViaServer(audioBlob, model, language, initialPrompt);
  }

  async transcribeViaServer(audioBlob, model, language, initialPrompt = null) {
    debugLogger.info("Transcription mode: SERVER", { model, language: language || "auto" });
    const modelPath = this.getModelPath(model);

    if (!this.serverManager.ready || this.currentServerModel !== model) {
      debugLogger.debug("Starting/restarting whisper-server for model", { model });
      await this.serverManager.start(modelPath);
      this.currentServerModel = model;
    }

    const audioBuffer = coerceAudioBlobToBuffer(audioBlob);

    debugLogger.logWhisperPipeline("transcribeViaServer - sending to server", {
      bufferSize: audioBuffer.length,
      model,
      language,
      port: this.serverManager.port,
    });

    const startTime = Date.now();
    const result = await this.serverManager.transcribe(audioBuffer, { language, initialPrompt });
    const elapsed = Date.now() - startTime;

    debugLogger.logWhisperPipeline("transcribeViaServer - completed", {
      elapsed,
      resultKeys: Object.keys(result),
    });

    return parseWhisperResult(result);
  }

  async downloadWhisperModel(modelName, progressCallback = null) {
    return await this.models.downloadModel(modelName, progressCallback);
  }

  async cancelDownload() {
    return await this.models.cancelDownload();
  }

  async checkModelStatus(modelName) {
    return await this.models.checkModelStatus(modelName);
  }

  async listWhisperModels() {
    return await this.models.listModels();
  }

  async deleteWhisperModel(modelName) {
    return await this.models.deleteModel(modelName);
  }

  async deleteAllWhisperModels() {
    return await this.models.deleteAllModels();
  }

  async checkFFmpegAvailability() {
    const now = Date.now();
    if (this.ffmpegAvailabilityCache.result !== null && now < this.ffmpegAvailabilityCache.expiresAt) {
      return this.ffmpegAvailabilityCache.result;
    }

    const ffmpegPath = getFFmpegPath();
    const result = ffmpegPath
      ? { available: true, path: ffmpegPath }
      : { available: false, error: "FFmpeg not found" };

    this.ffmpegAvailabilityCache = { result, expiresAt: now + CACHE_TTL_MS };
    return result;
  }

  async getDiagnostics() {
    const diagnostics = {
      platform: process.platform,
      arch: process.arch,
      resourcesPath: process.resourcesPath || null,
      isPackaged: !!process.resourcesPath && !process.resourcesPath.includes("node_modules"),
      ffmpeg: { available: false, path: null, error: null },
      whisperServer: { available: false, path: null },
      modelsDir: this.getModelsDir(),
      models: [],
    };

    try {
      clearFFmpegCache();
      const ffmpegPath = getFFmpegPath();
      if (ffmpegPath) {
        diagnostics.ffmpeg = { available: true, path: ffmpegPath, error: null };
      } else {
        diagnostics.ffmpeg = { available: false, path: null, error: "Not found" };
      }
    } catch (err) {
      diagnostics.ffmpeg = { available: false, path: null, error: err.message };
    }

    if (this.serverManager) {
      const serverPath = this.serverManager.getServerBinaryPath?.();
      diagnostics.whisperServer = {
        available: this.serverManager.isAvailable(),
        path: serverPath || null,
      };
    }

    try {
      const modelsDir = this.getModelsDir();
      if (fs.existsSync(modelsDir)) {
        const files = fs.readdirSync(modelsDir);
        diagnostics.models = files
          .filter((f) => f.startsWith("ggml-") && f.endsWith(".bin"))
          .map((f) => f.replace("ggml-", "").replace(".bin", ""));
      }
    } catch {
      // Ignore errors reading models dir
    }

    return diagnostics;
  }
}

module.exports = WhisperManager;

