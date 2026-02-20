const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const { spawn } = require("child_process");

const debugLogger = require("../debugLogger");
const { downloadFile, createDownloadSignal } = require("../downloadUtils");
const { getModelsDirForService } = require("../modelDirUtils");
const { getParakeetModelConfig, getValidParakeetModelNames } = require("./modelRegistry");
const { isParakeetModelDownloaded } = require("./modelFiles");

class ParakeetModelStore {
  constructor() {
    this.currentDownloadProcess = null;
  }

  getModelsDir() {
    return getModelsDirForService("parakeet");
  }

  validateModelName(modelName) {
    const validModels = getValidParakeetModelNames();
    if (!validModels.includes(modelName)) {
      throw new Error(
        `Invalid Parakeet model: ${modelName}. Valid models: ${validModels.join(", ")}`
      );
    }
    return true;
  }

  getModelPath(modelName) {
    this.validateModelName(modelName);
    return path.join(this.getModelsDir(), modelName);
  }

  isModelDownloaded(modelName) {
    return isParakeetModelDownloaded(this.getModelsDir(), modelName);
  }

  async downloadModel(modelName, progressCallback = null) {
    this.validateModelName(modelName);
    const modelConfig = getParakeetModelConfig(modelName);

    const modelPath = this.getModelPath(modelName);
    const modelsDir = this.getModelsDir();

    await fsPromises.mkdir(modelsDir, { recursive: true });

    if (this.isModelDownloaded(modelName)) {
      return { model: modelName, downloaded: true, path: modelPath, success: true };
    }

    const archivePath = path.join(modelsDir, `${modelName}.tar.bz2`);
    const { signal, abort } = createDownloadSignal();
    this.currentDownloadProcess = { abort };

    try {
      await downloadFile(modelConfig.url, archivePath, {
        timeout: 600000,
        signal,
        onProgress: (downloadedBytes, totalBytes) => {
          if (progressCallback) {
            progressCallback({
              type: "progress",
              model: modelName,
              downloaded_bytes: downloadedBytes,
              total_bytes: totalBytes,
              percentage: totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0,
            });
          }
        },
      });

      if (progressCallback) {
        progressCallback({ type: "installing", model: modelName, percentage: 100 });
      }

      await this._extractModel(archivePath, modelName);
      await fsPromises.unlink(archivePath).catch(() => {});

      if (progressCallback) {
        progressCallback({ type: "complete", model: modelName, percentage: 100 });
      }

      return { model: modelName, downloaded: true, path: modelPath, success: true };
    } catch (error) {
      await fsPromises.unlink(archivePath).catch(() => {});
      if (error.isAbort) {
        throw new Error("Download interrupted by user");
      }
      throw error;
    } finally {
      this.currentDownloadProcess = null;
    }
  }

  async _extractModel(archivePath, modelName) {
    const modelsDir = this.getModelsDir();
    const modelConfig = getParakeetModelConfig(modelName);
    const extractDir = path.join(modelsDir, `temp-extract-${modelName}`);

    try {
      await fsPromises.mkdir(extractDir, { recursive: true });
      await this._runTarExtract(archivePath, extractDir);

      const extractedDir = path.join(extractDir, modelConfig.extractDir);
      const targetDir = this.getModelPath(modelName);

      if (fs.existsSync(extractedDir)) {
        if (fs.existsSync(targetDir)) {
          await fsPromises.rm(targetDir, { recursive: true, force: true });
        }
        await fsPromises.rename(extractedDir, targetDir);
      } else {
        const entries = await fsPromises.readdir(extractDir);
        let modelDir = null;

        for (const entry of entries) {
          const entryPath = path.join(extractDir, entry);
          const stat = await fsPromises.stat(entryPath);
          if (stat.isDirectory() && entry.includes("parakeet")) {
            modelDir = entry;
            break;
          }
        }

        if (modelDir) {
          if (fs.existsSync(targetDir)) {
            await fsPromises.rm(targetDir, { recursive: true, force: true });
          }
          await fsPromises.rename(path.join(extractDir, modelDir), targetDir);
        } else {
          throw new Error("Could not find model directory in extracted archive");
        }
      }

      await fsPromises.rm(extractDir, { recursive: true, force: true });

      debugLogger.info("Parakeet model extracted", { modelName, targetDir });
    } catch (error) {
      try {
        await fsPromises.rm(extractDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  _runTarExtract(archivePath, extractDir) {
    return new Promise((resolve, reject) => {
      const tarProcess = spawn("tar", ["-xjf", archivePath, "-C", extractDir], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stderr = "";

      tarProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      tarProcess.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`tar extraction failed with code ${code}: ${stderr}`));
        }
      });

      tarProcess.on("error", (err) => {
        reject(new Error(`Failed to start tar process: ${err.message}`));
      });
    });
  }

  async cancelDownload() {
    if (this.currentDownloadProcess) {
      this.currentDownloadProcess.abort();
      this.currentDownloadProcess = null;
      return { success: true, message: "Download cancelled" };
    }
    return { success: false, error: "No active download to cancel" };
  }

  async checkModelStatus(modelName) {
    const modelPath = this.getModelPath(modelName);

    if (this.isModelDownloaded(modelName)) {
      try {
        const encoderPath = path.join(modelPath, "encoder.int8.onnx");
        const stats = fs.statSync(encoderPath);
        return {
          model: modelName,
          downloaded: true,
          path: modelPath,
          size_bytes: stats.size,
          size_mb: Math.round(stats.size / (1024 * 1024)),
          success: true,
        };
      } catch {
        return { model: modelName, downloaded: false, success: true };
      }
    }

    return { model: modelName, downloaded: false, success: true };
  }

  async listModels() {
    const models = getValidParakeetModelNames();
    const modelInfo = [];

    for (const model of models) {
      // eslint-disable-next-line no-await-in-loop
      const status = await this.checkModelStatus(model);
      modelInfo.push(status);
    }

    return {
      models: modelInfo,
      cache_dir: this.getModelsDir(),
      success: true,
    };
  }

  async deleteModel(modelName) {
    const modelPath = this.getModelPath(modelName);

    if (fs.existsSync(modelPath)) {
      try {
        const encoderPath = path.join(modelPath, "encoder.int8.onnx");
        let freedBytes = 0;

        if (fs.existsSync(encoderPath)) {
          const stats = fs.statSync(encoderPath);
          freedBytes = stats.size;
        }

        fs.rmSync(modelPath, { recursive: true, force: true });

        return {
          model: modelName,
          deleted: true,
          freed_bytes: freedBytes,
          freed_mb: Math.round(freedBytes / (1024 * 1024)),
          success: true,
        };
      } catch (error) {
        return { model: modelName, deleted: false, error: error.message, success: false };
      }
    }

    return { model: modelName, deleted: false, error: "Model not found", success: false };
  }

  async deleteAllModels() {
    const modelsDir = this.getModelsDir();
    let totalFreed = 0;
    let deletedCount = 0;

    try {
      if (!fs.existsSync(modelsDir)) {
        return { success: true, deleted_count: 0, freed_bytes: 0, freed_mb: 0 };
      }

      const entries = fs.readdirSync(modelsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirPath = path.join(modelsDir, entry.name);
          try {
            const encoderPath = path.join(dirPath, "encoder.int8.onnx");
            if (fs.existsSync(encoderPath)) {
              const stats = fs.statSync(encoderPath);
              totalFreed += stats.size;
            }

            fs.rmSync(dirPath, { recursive: true, force: true });
            deletedCount += 1;
          } catch {
            // Continue with other models if one fails
          }
        }
      }

      return {
        success: true,
        deleted_count: deletedCount,
        freed_bytes: totalFreed,
        freed_mb: Math.round(totalFreed / (1024 * 1024)),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = { ParakeetModelStore };

