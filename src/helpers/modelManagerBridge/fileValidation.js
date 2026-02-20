const fs = require("fs");
const { promises: fsPromises } = require("fs");

const MIN_FILE_SIZE = 1_000_000; // 1MB minimum for valid model files

async function checkFileExists(filePath) {
  try {
    await fsPromises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function checkModelValid(filePath) {
  try {
    const stats = await fsPromises.stat(filePath);
    return stats.size > MIN_FILE_SIZE;
  } catch {
    return false;
  }
}

module.exports = { MIN_FILE_SIZE, checkFileExists, checkModelValid };

