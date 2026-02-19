const AUDIO_MIME_BY_EXTENSION = {
  mp3: "audio/mpeg",
  mpeg: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  webm: "audio/webm",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  wma: "audio/x-ms-wma",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  caf: "audio/x-caf",
};

function guessAudioMimeType(extension) {
  const normalized = typeof extension === "string" ? extension.trim().toLowerCase() : "";
  return AUDIO_MIME_BY_EXTENSION[normalized] || "application/octet-stream";
}

module.exports = {
  AUDIO_MIME_BY_EXTENSION,
  guessAudioMimeType,
};

