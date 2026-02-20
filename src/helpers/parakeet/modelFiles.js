const fs = require("fs");
const path = require("path");

const REQUIRED_PARAKEET_FILES = [
  "encoder.int8.onnx",
  "decoder.int8.onnx",
  "joiner.int8.onnx",
  "tokens.txt",
];

const isParakeetModelDownloaded = (modelsDir, modelName) => {
  const modelDir = path.join(modelsDir, modelName);
  if (!fs.existsSync(modelDir)) return false;

  for (const file of REQUIRED_PARAKEET_FILES) {
    if (!fs.existsSync(path.join(modelDir, file))) {
      return false;
    }
  }

  return true;
};

module.exports = { REQUIRED_PARAKEET_FILES, isParakeetModelDownloaded };

