const modelRegistryData = require("../../models/modelRegistryData.json");

function getWhisperModelConfig(modelName) {
  const modelInfo = modelRegistryData.whisperModels[modelName];
  if (!modelInfo) return null;
  return {
    url: modelInfo.downloadUrl,
    size: modelInfo.sizeMb * 1_000_000,
    fileName: modelInfo.fileName,
  };
}

function getValidWhisperModelNames() {
  return Object.keys(modelRegistryData.whisperModels);
}

module.exports = { getWhisperModelConfig, getValidWhisperModelNames };

