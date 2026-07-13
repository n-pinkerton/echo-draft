const fs = require("fs");
const path = require("path");

const { getSafeTempDir } = require("../safeTempDir");

const convertBufferToWav = async ({
  audioBuffer,
  convertToWav,
  sampleRate = 16000,
  channels = 1,
  tempPrefix = "whisper",
  signal = null,
} = {}) => {
  const tempDir = getSafeTempDir();
  const timestamp = Date.now();
  const tempInputPath = path.join(tempDir, `${tempPrefix}-input-${timestamp}.webm`);
  const tempWavPath = path.join(tempDir, `${tempPrefix}-output-${timestamp}.wav`);

  try {
    fs.writeFileSync(tempInputPath, audioBuffer);
    await convertToWav(tempInputPath, tempWavPath, { sampleRate, channels, signal });
    return fs.readFileSync(tempWavPath);
  } finally {
    for (const filePath of [tempInputPath, tempWavPath]) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // ignore cleanup errors
      }
    }
  }
};

module.exports = { convertBufferToWav };
