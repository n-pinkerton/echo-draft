const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");

const { downloadFile, createDownloadSignal } = require("../downloadUtils");
const { getModelsDirForService } = require("../modelDirUtils");
const { getWhisperModelConfig, getValidWhisperModelNames } = require("./modelRegistry");

class WhisperModelStore {
  constructor() {
    this.currentDownloadProcess = null;
  }

  getModelsDir() {
    return getModelsDirForService("whisper");
  }

  validateModelName(modelName) {
    const validModels = getValidWhisperModelNames();
    if (!validModels.includes(modelName)) {
      throw new Error(`Invalid model name: ${modelName}. Valid models: ${validModels.join(", ")}`);
    }
    return true;
  }

  getModelPath(modelName) {
    this.validateModelName(modelName);
    const config = getWhisperModelConfig(modelName);
    return path.join(this.getModelsDir(), config.fileName);
  }

  async downloadModel(modelName, progressCallback = null) {
    this.validateModelName(modelName);
    const modelConfig = getWhisperModelConfig(modelName);

    const modelPath = this.getModelPath(modelName);
    const modelsDir = this.getModelsDir();

    await fsPromises.mkdir(modelsDir, { recursive: true });

    if (fs.existsSync(modelPath)) {
      const stats = await fsPromises.stat(modelPath);
      return {
        model: modelName,
        downloaded: true,
        path: modelPath,
        size_bytes: stats.size,
        size_mb: Math.round(stats.size / (1024 * 1024)),
        success: true,
      };
    }

    const { signal, abort } = createDownloadSignal();
    this.currentDownloadProcess = { abort };

    try {
      await downloadFile(modelConfig.url, modelPath, {
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

      const stats = await fsPromises.stat(modelPath);

      if (progressCallback) {
        progressCallback({ type: "complete", model: modelName, percentage: 100 });
      }

      return {
        model: modelName,
        downloaded: true,
        path: modelPath,
        size_bytes: stats.size,
        size_mb: Math.round(stats.size / (1024 * 1024)),
        success: true,
      };
    } catch (error) {
      if (error.isAbort) {
        throw new Error("Download interrupted by user");
      }
      throw error;
    } finally {
      this.currentDownloadProcess = null;
    }
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

    if (fs.existsSync(modelPath)) {
      const stats = await fsPromises.stat(modelPath);
      return {
        model: modelName,
        downloaded: true,
        path: modelPath,
        size_bytes: stats.size,
        size_mb: Math.round(stats.size / (1024 * 1024)),
        success: true,
      };
    }

    return { model: modelName, downloaded: false, success: true };
  }

  async listModels() {
    const models = getValidWhisperModelNames();
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
      const stats = await fsPromises.stat(modelPath);
      await fsPromises.unlink(modelPath);
      return {
        model: modelName,
        deleted: true,
        freed_bytes: stats.size,
        freed_mb: Math.round(stats.size / (1024 * 1024)),
        success: true,
      };
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

      const files = await fsPromises.readdir(modelsDir);
      for (const file of files) {
        if (file.endsWith(".bin")) {
          const filePath = path.join(modelsDir, file);
          try {
            const stats = await fsPromises.stat(filePath);
            await fsPromises.unlink(filePath);
            totalFreed += stats.size;
            deletedCount += 1;
          } catch {
            // Continue with other files if one fails
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

module.exports = { WhisperModelStore };

