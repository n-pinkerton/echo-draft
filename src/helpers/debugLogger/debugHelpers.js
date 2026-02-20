const fs = require("fs");
const path = require("path");

const logFFmpegDebug = (debugLogger, context, ffmpegPath, additionalInfo = {}) => {
  if (!debugLogger.isDebugEnabled()) return;

  const debugInfo = {
    context,
    ffmpegPath,
    exists: ffmpegPath ? fs.existsSync(ffmpegPath) : false,
    platform: process.platform,
    ...additionalInfo,
  };

  if (ffmpegPath && fs.existsSync(ffmpegPath)) {
    try {
      const stats = fs.statSync(ffmpegPath);
      debugInfo.fileInfo = {
        size: stats.size,
        isFile: stats.isFile(),
        // Skip X_OK check on Windows (not reliable)
        isExecutable: process.platform !== "win32" ? !!(stats.mode & fs.constants.X_OK) : false,
        executableCheckSkipped: process.platform === "win32",
        permissions: stats.mode.toString(8),
        modified: stats.mtime,
      };
    } catch (e) {
      debugInfo.statError = e.message;
    }
  }

  if (ffmpegPath) {
    const dir = path.dirname(ffmpegPath);
    try {
      fs.accessSync(dir, fs.constants.R_OK);
      debugInfo.dirReadable = true;
    } catch (e) {
      debugInfo.dirReadable = false;
      debugInfo.dirError = e.message;
    }
  }

  let possiblePaths = [];
  if (process.platform === "win32") {
    possiblePaths = [
      ffmpegPath,
      ffmpegPath?.replace(/app\\.asar([/\\\\])/, "app.asar.unpacked$1"),
      path.join(
        process.resourcesPath || "",
        "app.asar.unpacked",
        "node_modules",
        "ffmpeg-static",
        "ffmpeg.exe"
      ),
      path.join(process.env.ProgramFiles || "C:\\\\Program Files", "ffmpeg", "bin", "ffmpeg.exe"),
      "C:\\\\ffmpeg\\\\bin\\\\ffmpeg.exe",
    ].filter(Boolean);
  } else {
    possiblePaths = [
      ffmpegPath,
      ffmpegPath?.replace("app.asar", "app.asar.unpacked"),
      path.join(
        process.resourcesPath || "",
        "app.asar.unpacked",
        "node_modules",
        "ffmpeg-static",
        "ffmpeg"
      ),
      "/usr/local/bin/ffmpeg",
      "/opt/homebrew/bin/ffmpeg",
      "/usr/bin/ffmpeg",
    ].filter(Boolean);
  }

  debugInfo.pathChecks = possiblePaths.map((p) => ({
    path: p,
    exists: fs.existsSync(p),
    normalized: path.normalize(p),
  }));

  debugLogger.debug(`FFmpeg Debug - ${context}`, debugInfo, "ffmpeg");
};

const logAudioData = (debugLogger, context, audioBlob) => {
  if (!debugLogger.isDebugEnabled()) return;

  const audioInfo = {
    context,
    type: audioBlob?.type || "unknown",
    size: audioBlob?.size || 0,
    constructor: audioBlob?.constructor?.name || "unknown",
  };

  if (audioBlob instanceof ArrayBuffer) {
    audioInfo.byteLength = audioBlob.byteLength;
    const view = new Uint8Array(audioBlob, 0, Math.min(16, audioBlob.byteLength));
    audioInfo.firstBytes = Array.from(view)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
  } else if (audioBlob instanceof Uint8Array) {
    audioInfo.byteLength = audioBlob.byteLength;
    const view = audioBlob.slice(0, Math.min(16, audioBlob.byteLength));
    audioInfo.firstBytes = Array.from(view)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
  }

  debugLogger.debug("Audio Data Debug", audioInfo, "audio");
};

const logProcessStart = (debugLogger, command, args, options = {}) => {
  if (!debugLogger.isDebugEnabled()) return;

  debugLogger.debug(
    "Starting process",
    {
      command,
      args,
      cwd: options.cwd || process.cwd(),
      env: {
        FFMPEG_PATH: options.env?.FFMPEG_PATH,
        FFMPEG_EXECUTABLE: options.env?.FFMPEG_EXECUTABLE,
        FFMPEG_BINARY: options.env?.FFMPEG_BINARY,
        PATH_preview: options.env?.PATH?.substring(0, 200) + "...",
      },
    },
    "process"
  );
};

const logProcessOutput = (debugLogger, processName, type, data) => {
  if (!debugLogger.isDebugEnabled()) return;

  const output = data.toString().trim();
  if (output) {
    debugLogger.debug(`${processName} ${type}`, output, "process");
  }
};

const logWhisperPipeline = (debugLogger, stage, details) => {
  if (!debugLogger.isDebugEnabled()) return;
  debugLogger.debug(`Whisper Pipeline - ${stage}`, details, "whisper");
};

const logSTTPipeline = (debugLogger, stage, details) => {
  if (!debugLogger.isDebugEnabled()) return;
  debugLogger.debug(`STT Pipeline - ${stage}`, details, "stt");
};

module.exports = {
  logAudioData,
  logFFmpegDebug,
  logProcessOutput,
  logProcessStart,
  logSTTPipeline,
  logWhisperPipeline,
};

