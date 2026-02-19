const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_CAPTURES = 10;
const AUDIO_SUBDIR = "audio";
const AUDIO_PREFIX = "openwhispr-audio-";

const sanitizeToken = (value, fallback = "unknown") => {
  const raw = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!raw) return fallback;
  const sanitized = raw.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || fallback;
};

const makeSafeTimestamp = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return sanitizeToken(String(Date.now()));
  }
  // Windows disallows ":" in filenames; also replace "." to keep things neat.
  return date.toISOString().replace(/[:.]/g, "-");
};

const guessExtensionFromMimeType = (mimeType = "") => {
  const normalized = typeof mimeType === "string" ? mimeType.toLowerCase() : "";
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("ogg") || normalized.includes("opus")) return "ogg";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("mp4") || normalized.includes("m4a")) return "mp4";
  if (normalized.includes("wav")) return "wav";
  return "webm";
};

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
};

const listCaptureFiles = (audioDir) => {
  let entries = [];
  try {
    entries = fs.readdirSync(audioDir);
  } catch {
    return [];
  }

  const results = [];
  for (const entry of entries) {
    if (!entry.startsWith(AUDIO_PREFIX)) continue;
    if (entry.endsWith(".json")) continue;
    const fullPath = path.join(audioDir, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
      results.push({
        fileName: entry,
        fullPath,
        mtimeMs: stat.mtimeMs,
      });
    } catch {
      // Ignore unreadable entries
    }
  }
  return results;
};

const deleteCapturePair = (capturePath) => {
  const parsed = path.parse(capturePath);
  const metaPath = path.join(parsed.dir, `${parsed.name}.json`);
  try {
    fs.unlinkSync(capturePath);
  } catch {
    // Ignore delete errors
  }
  try {
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }
  } catch {
    // Ignore delete errors
  }
};

const enforceRetention = (audioDir, maxCaptures = DEFAULT_MAX_CAPTURES) => {
  const captures = listCaptureFiles(audioDir).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const max = Number.isInteger(maxCaptures) && maxCaptures > 0 ? maxCaptures : DEFAULT_MAX_CAPTURES;
  const toDelete = captures.slice(max);
  for (const entry of toDelete) {
    deleteCapturePair(entry.fullPath);
  }
  return {
    kept: captures.length - toDelete.length,
    deleted: toDelete.length,
  };
};

const saveDebugAudioCapture = ({
  logsDir,
  audioBuffer,
  mimeType,
  sessionId,
  jobId,
  outputMode,
  durationSeconds,
  stopReason,
  stopSource,
  maxCaptures = DEFAULT_MAX_CAPTURES,
} = {}) => {
  if (!logsDir || typeof logsDir !== "string") {
    throw new Error("logsDir is required");
  }

  if (!audioBuffer) {
    throw new Error("audioBuffer is required");
  }

  const audioDir = path.join(logsDir, AUDIO_SUBDIR);
  ensureDir(audioDir);

  const ts = makeSafeTimestamp(new Date());
  const sessionToken = sanitizeToken(sessionId ? String(sessionId).slice(0, 12) : "", "nosession");
  const jobToken = sanitizeToken(jobId ?? "", "nojob");
  const rand = Math.random().toString(16).slice(2, 8);
  const ext = guessExtensionFromMimeType(mimeType);

  const baseName = `${AUDIO_PREFIX}${ts}-s${sessionToken}-j${jobToken}-${rand}`;
  const audioPath = path.join(audioDir, `${baseName}.${ext}`);
  const metaPath = path.join(audioDir, `${baseName}.json`);

  const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
  fs.writeFileSync(audioPath, buffer);
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        type: "debug_audio_capture",
        ts: new Date().toISOString(),
        fileName: path.basename(audioPath),
        mimeType: mimeType || null,
        bytes: buffer.length,
        sessionId: sessionId || null,
        jobId: jobId ?? null,
        outputMode: outputMode || null,
        durationSeconds: typeof durationSeconds === "number" ? durationSeconds : null,
        stopReason: stopReason || null,
        stopSource: stopSource || null,
      },
      null,
      2
    )
  );

  const retention = enforceRetention(audioDir, maxCaptures);

  return {
    audioDir,
    filePath: audioPath,
    bytes: buffer.length,
    kept: retention.kept,
    deleted: retention.deleted,
  };
};

module.exports = {
  AUDIO_PREFIX,
  DEFAULT_MAX_CAPTURES,
  saveDebugAudioCapture,
  enforceRetention,
  guessExtensionFromMimeType,
  makeSafeTimestamp,
  sanitizeToken,
};

