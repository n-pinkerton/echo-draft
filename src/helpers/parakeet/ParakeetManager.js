const fs = require("fs");

const debugLogger = require("../debugLogger");
const ParakeetServerManager = require("../parakeetServer");
const { coerceAudioBlobToBuffer } = require("../audioBufferUtils");

const { getValidParakeetModelNames } = require("./modelRegistry");
const { parseParakeetResult } = require("./resultParser");
const { ParakeetModelStore } = require("./ParakeetModelStore");

class ParakeetManager {
  constructor() {
    this.isInitialized = false;
    this.serverManager = new ParakeetServerManager();
    this.models = new ParakeetModelStore();
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

      await this.logDependencyStatus();

      const { localTranscriptionProvider, parakeetModel } = settings;

      if (
        localTranscriptionProvider === "nvidia" &&
        parakeetModel &&
        this.serverManager.isAvailable()
      ) {
        if (this.serverManager.isModelDownloaded(parakeetModel)) {
          debugLogger.info("Pre-warming parakeet server", { model: parakeetModel });

          try {
            const serverStartTime = Date.now();
            await this.serverManager.startServer(parakeetModel);
            debugLogger.info("Parakeet server pre-warmed successfully", {
              model: parakeetModel,
              startupTimeMs: Date.now() - serverStartTime,
            });
          } catch (err) {
            debugLogger.warn("Parakeet server pre-warm failed (will start on first use)", {
              error: err.message,
              model: parakeetModel,
            });
          }
        } else {
          debugLogger.debug("Skipping parakeet server pre-warm: model not downloaded", {
            model: parakeetModel,
          });
        }
      } else {
        debugLogger.debug("Skipping parakeet server pre-warm", {
          reason:
            localTranscriptionProvider !== "nvidia"
              ? "provider not nvidia"
              : !parakeetModel
                ? "no model selected"
                : "server binary not available",
        });
      }
    } catch (error) {
      debugLogger.warn("Parakeet initialization error", { error: error.message });
      this.isInitialized = true;
    }

    debugLogger.info("Parakeet initialization complete", {
      totalTimeMs: Date.now() - startTime,
      binaryAvailable: this.serverManager.isAvailable(),
    });
  }

  async logDependencyStatus() {
    const status = {
      sherpaOnnx: {
        available: this.serverManager.isAvailable(),
        path: this.serverManager.getBinaryPath(),
      },
      models: [],
    };

    for (const modelName of getValidParakeetModelNames()) {
      const modelPath = this.getModelPath(modelName);
      if (this.serverManager.isModelDownloaded(modelName)) {
        try {
          const encoderPath = require("path").join(modelPath, "encoder.int8.onnx");
          const stats = fs.statSync(encoderPath);
          status.models.push({
            name: modelName,
            size: `${Math.round(stats.size / (1024 * 1024))}MB`,
          });
        } catch {
          // Skip if can't stat
        }
      }
    }

    debugLogger.info("Parakeet dependency check", status);

    const binaryStatus = status.sherpaOnnx.available
      ? `✓ ${status.sherpaOnnx.path}`
      : "✗ Not found";
    const modelsStatus =
      status.models.length > 0 ? status.models.map((m) => `${m.name}`).join(", ") : "None downloaded";

    debugLogger.info(`[Parakeet] sherpa-onnx: ${binaryStatus}`);
    debugLogger.info(`[Parakeet] Models: ${modelsStatus}`);
  }

  async checkInstallation() {
    const binaryPath = this.serverManager.getBinaryPath();
    if (!binaryPath) {
      return { installed: false, working: false };
    }

    return {
      installed: true,
      working: this.serverManager.isAvailable(),
      path: binaryPath,
    };
  }

  async startServer(modelName) {
    this.validateModelName(modelName);
    return this.serverManager.startServer(modelName);
  }

  async stopServer() {
    await this.serverManager.stopServer();
  }

  getServerStatus() {
    return this.serverManager.getServerStatus();
  }

  async transcribeLocalParakeet(audioBlob, options = {}) {
    debugLogger.logSTTPipeline("transcribeLocalParakeet - start", {
      options,
      audioBlobType: audioBlob?.constructor?.name,
      audioBlobSize: audioBlob?.byteLength || audioBlob?.size || 0,
      serverAvailable: this.serverManager.isAvailable(),
    });

    if (!this.serverManager.isAvailable()) {
      throw new Error(
        "sherpa-onnx binary not found. Please ensure the app is installed correctly."
      );
    }

    const model = options.model || "parakeet-tdt-0.6b-v3";

    if (!this.serverManager.isModelDownloaded(model)) {
      throw new Error(
        `Parakeet model \"${model}\" not downloaded. Please download it from Settings.`
      );
    }

    const audioBuffer = coerceAudioBlobToBuffer(audioBlob);

    debugLogger.logSTTPipeline("transcribeLocalParakeet - processing", {
      bufferSize: audioBuffer.length,
      model,
    });

    const startTime = Date.now();
    const language = options.language || "auto";
    const result = await this.serverManager.transcribe(audioBuffer, { modelName: model, language });
    const elapsed = Date.now() - startTime;

    debugLogger.logSTTPipeline("transcribeLocalParakeet - completed", {
      elapsed,
      textLength: result.text?.length || 0,
    });

    return parseParakeetResult(result);
  }

  async downloadParakeetModel(modelName, progressCallback = null) {
    const result = await this.models.downloadModel(modelName, progressCallback);

    if (this.serverManager.isAvailable()) {
      this.serverManager.startServer(modelName).catch((err) => {
        debugLogger.warn("Post-download server pre-warm failed (non-fatal)", {
          error: err.message,
          model: modelName,
        });
      });
    }

    return result;
  }

  async cancelDownload() {
    return await this.models.cancelDownload();
  }

  async checkModelStatus(modelName) {
    return await this.models.checkModelStatus(modelName);
  }

  async listParakeetModels() {
    return await this.models.listModels();
  }

  async deleteParakeetModel(modelName) {
    return await this.models.deleteModel(modelName);
  }

  async deleteAllParakeetModels() {
    return await this.models.deleteAllModels();
  }

  async getDiagnostics() {
    const diagnostics = {
      platform: process.platform,
      arch: process.arch,
      resourcesPath: process.resourcesPath || null,
      isPackaged: !!process.resourcesPath && !process.resourcesPath.includes("node_modules"),
      sherpaOnnx: { available: false, path: null },
      modelsDir: this.getModelsDir(),
      models: [],
    };

    const binaryPath = this.serverManager.getBinaryPath();
    if (binaryPath) {
      diagnostics.sherpaOnnx = { available: true, path: binaryPath };
    }

    try {
      const modelsDir = this.getModelsDir();
      if (fs.existsSync(modelsDir)) {
        const entries = fs.readdirSync(modelsDir, { withFileTypes: true });
        diagnostics.models = entries
          .filter((e) => e.isDirectory() && this.serverManager.isModelDownloaded(e.name))
          .map((e) => e.name);
      }
    } catch {
      // Ignore errors reading models dir
    }

    return diagnostics;
  }
}

module.exports = ParakeetManager;

