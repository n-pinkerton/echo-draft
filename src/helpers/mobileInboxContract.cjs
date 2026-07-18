const MOBILE_INBOX_PROTOCOL_VERSION = 1;
const MAX_MOBILE_AUDIO_BYTES = 32 * 1024 * 1024;
const MAX_MOBILE_MANIFEST_BYTES = 64 * 1024;
const MOBILE_AUDIO_EXTENSION = "m4a";
const MOBILE_AUDIO_MIME_TYPE = "audio/mp4";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

const getMobileAudioFileName = (externalId) => `${externalId}.${MOBILE_AUDIO_EXTENSION}`;
const getMobileManifestFileName = (externalId) => `${externalId}.ready.json`;

function normalizeMobileInboxManifest(value, manifestFileName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Mobile inbox manifest must be an object");
  }
  if (value.version !== MOBILE_INBOX_PROTOCOL_VERSION) {
    throw new Error("Unsupported mobile inbox manifest version");
  }

  const externalId = typeof value.externalId === "string" ? value.externalId.toLowerCase() : "";
  if (!UUID_PATTERN.test(externalId)) {
    throw new Error("Invalid mobile inbox external ID");
  }
  if (manifestFileName !== getMobileManifestFileName(externalId)) {
    throw new Error("Mobile inbox manifest filename does not match its external ID");
  }

  const audioFile = typeof value.audioFile === "string" ? value.audioFile : "";
  if (audioFile !== getMobileAudioFileName(externalId)) {
    throw new Error("Mobile inbox audio filename does not match its external ID");
  }

  const audioSha256 =
    typeof value.audioSha256 === "string" ? value.audioSha256.toLowerCase() : "";
  if (!SHA256_PATTERN.test(audioSha256)) {
    throw new Error("Invalid mobile inbox audio hash");
  }

  const sizeBytes = value.sizeBytes;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_MOBILE_AUDIO_BYTES) {
    throw new Error("Invalid mobile inbox audio size");
  }

  const createdAt = typeof value.createdAt === "string" ? value.createdAt : "";
  const createdAtMs = Date.parse(createdAt);
  if (!createdAt || createdAt.length > 64 || !Number.isFinite(createdAtMs)) {
    throw new Error("Invalid mobile inbox timestamp");
  }

  return {
    version: MOBILE_INBOX_PROTOCOL_VERSION,
    externalId,
    audioFile,
    audioSha256,
    sizeBytes,
    createdAt: new Date(createdAtMs).toISOString(),
    mimeType: MOBILE_AUDIO_MIME_TYPE,
  };
}

module.exports = {
  MAX_MOBILE_AUDIO_BYTES,
  MAX_MOBILE_MANIFEST_BYTES,
  MOBILE_AUDIO_EXTENSION,
  MOBILE_AUDIO_MIME_TYPE,
  MOBILE_INBOX_PROTOCOL_VERSION,
  UUID_PATTERN,
  getMobileAudioFileName,
  getMobileManifestFileName,
  normalizeMobileInboxManifest,
};
