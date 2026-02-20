const modelRegistryData = require("../../models/modelRegistryData.json");

function getParakeetModelConfig(modelName) {
  const modelInfo = modelRegistryData.parakeetModels[modelName];
  if (!modelInfo) return null;
  return {
    url: modelInfo.downloadUrl,
    size: modelInfo.sizeMb * 1_000_000,
    language: modelInfo.language,
    supportedLanguages: modelInfo.supportedLanguages || [],
    extractDir: modelInfo.extractDir,
  };
}

function getValidParakeetModelNames() {
  return Object.keys(modelRegistryData.parakeetModels);
}

module.exports = { getParakeetModelConfig, getValidParakeetModelNames };

