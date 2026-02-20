const modelRegistryData = require("../../models/modelRegistryData.json");

function getLocalProviders() {
  return modelRegistryData.localProviders || [];
}

function findModelById(modelId) {
  for (const provider of getLocalProviders()) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) {
      return { model, provider };
    }
  }
  return null;
}

function getDownloadUrl(provider, model) {
  const baseUrl = provider.baseUrl || "https://huggingface.co";
  return `${baseUrl}/${model.hfRepo}/resolve/main/${model.fileName}`;
}

module.exports = { findModelById, getDownloadUrl, getLocalProviders };

