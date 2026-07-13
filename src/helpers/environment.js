const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { app } = require("electron");

const PERSISTED_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "CUSTOM_TRANSCRIPTION_API_KEY",
  "CUSTOM_REASONING_API_KEY",
  "CUSTOM_TRANSCRIPTION_BASE_URL",
  "CUSTOM_REASONING_BASE_URL",
  "OPENWHISPR_LOG_LEVEL",
  "LOCAL_TRANSCRIPTION_PROVIDER",
  "PARAKEET_MODEL",
  "LOCAL_WHISPER_MODEL",
  "REASONING_PROVIDER",
  "LOCAL_REASONING_MODEL",
  "DICTATION_KEY",
  "DICTATION_KEY_CLIPBOARD",
  "ACTIVATION_MODE",
];
const PERSISTED_KEY_SET = new Set(PERSISTED_KEYS);
const MAX_PERSISTED_VALUE_CHARS = 32_768;
const DEBUG_CONSENT_FILE = "debug-consent.json";

const validatePersistedValue = (envVarName, value) => {
  if (!PERSISTED_KEY_SET.has(envVarName)) {
    throw new Error("Unsupported persisted setting");
  }
  if (typeof value !== "string") {
    throw new Error("Persisted settings must be strings");
  }
  if (value.length > MAX_PERSISTED_VALUE_CHARS || /[\r\n\0]/.test(value)) {
    throw new Error("Persisted setting contains unsupported characters or exceeds its limit");
  }
  return value;
};

const writePrivateFileAtomic = (targetPath, content) => {
  const parent = path.dirname(targetPath);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const tempPath = path.join(
    parent,
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  try {
    fs.writeFileSync(tempPath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      fs.chmodSync(tempPath, 0o600);
    } catch {
      // Windows does not expose POSIX mode bits; the user-data ACL remains authoritative.
    }
    fs.renameSync(tempPath, targetPath);
    try {
      fs.chmodSync(targetPath, 0o600);
    } catch {
      // See note above.
    }
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
  }
};

class EnvironmentManager {
  constructor({ appImpl = app } = {}) {
    if (!appImpl || typeof appImpl.getPath !== "function") {
      throw new Error("Electron app paths are unavailable");
    }
    this.app = appImpl;
    this._envWriteInProgress = false;
    this._envWriteNeedsRetry = false;
    this.loadEnvironmentVariables();
  }

  loadEnvironmentVariables() {
    // Loaded in priority order — dotenv won't override, so first file wins per variable
    const resourcesPath = typeof process.resourcesPath === "string" ? process.resourcesPath : "";
    const possibleEnvPaths = [
      path.join(this.app.getPath("userData"), ".env"),
      path.join(__dirname, "..", "..", ".env"), // Development
      ...(resourcesPath
        ? [
            path.join(resourcesPath, ".env"),
            path.join(resourcesPath, "app.asar.unpacked", ".env"),
            path.join(resourcesPath, "app", ".env"), // Legacy
          ]
        : []),
    ];

    const userDataEnvPath = possibleEnvPaths[0];
    for (const envPath of possibleEnvPaths) {
      try {
        if (fs.existsSync(envPath)) {
          if (envPath === userDataEnvPath) {
            const parsed = require("dotenv").parse(fs.readFileSync(envPath, "utf8"));
            for (const key of PERSISTED_KEYS) {
              if (process.env[key] !== undefined || parsed[key] === undefined) continue;
              process.env[key] = validatePersistedValue(key, parsed[key]);
            }
          } else {
            require("dotenv").config({ path: envPath });
          }
        }
      } catch {}
    }
  }

  _getKey(envVarName) {
    return process.env[envVarName] || "";
  }

  _saveKey(envVarName, key) {
    const normalized = validatePersistedValue(envVarName, key);
    if (normalized) process.env[envVarName] = normalized;
    else delete process.env[envVarName];
    return { success: true };
  }

  _saveKeyDurably(envVarName, key) {
    const hadPreviousValue = Object.prototype.hasOwnProperty.call(process.env, envVarName);
    const previousValue = process.env[envVarName];
    const saveResult = this._saveKey(envVarName, key);
    const persistResult = this.saveAllKeysToEnvFile();

    if (persistResult?.success === true) {
      return { ...saveResult, path: persistResult.path };
    }

    if (hadPreviousValue) process.env[envVarName] = previousValue;
    else delete process.env[envVarName];
    return {
      success: false,
      error: "The setting could not be written to durable storage",
    };
  }

  savePersistedValue(envVarName, value) {
    return this._saveKey(envVarName, value);
  }

  clearPersistedValue(envVarName) {
    if (!PERSISTED_KEY_SET.has(envVarName)) {
      throw new Error("Unsupported persisted setting");
    }
    delete process.env[envVarName];
    return { success: true };
  }

  _getUserDataEnvPath() {
    return path.join(this.app.getPath("userData"), ".env");
  }

  _persistAllKeysToEnvFile(envPath) {
    try {
      const keptLines = ["# EchoDraft user settings (managed by EchoDraft)"];
      for (const key of PERSISTED_KEYS) {
        const value = process.env[key];
        if (!value) continue;
        const validated = validatePersistedValue(key, value);
        keptLines.push(`${key}=${JSON.stringify(validated)}`);
      }

      const output = `${keptLines.join("\n")}\n`;
      writePrivateFileAtomic(envPath, output);

      return { success: true, path: envPath };
    } catch (error) {
      return { success: false, path: envPath, error: error?.message || String(error) };
    }
  }

  _queueEnvWrite(fn) {
    if (this._envWriteInProgress) {
      this._envWriteNeedsRetry = true;
      return { success: true, queued: true };
    }

    this._envWriteInProgress = true;
    let result = { success: true };
    try {
      const fnResult = fn();
      if (fnResult && typeof fnResult === "object" && !Array.isArray(fnResult)) {
        result = fnResult;
      } else {
        result = { success: true };
      }
      this._envWriteNeedsRetry = false;
    } catch (error) {
      result = { success: false, error: error?.message || String(error) };
    } finally {
      this._envWriteInProgress = false;
      if (this._envWriteNeedsRetry) {
        this._envWriteNeedsRetry = false;
        return this._queueEnvWrite(fn);
      }
    }

    return result;
  }

  getOpenAIKey() {
    return this._getKey("OPENAI_API_KEY");
  }

  saveOpenAIKey(key) {
    return this._saveKeyDurably("OPENAI_API_KEY", key);
  }

  getAnthropicKey() {
    return this._getKey("ANTHROPIC_API_KEY");
  }

  saveAnthropicKey(key) {
    return this._saveKeyDurably("ANTHROPIC_API_KEY", key);
  }

  getGeminiKey() {
    return this._getKey("GEMINI_API_KEY");
  }

  saveGeminiKey(key) {
    return this._saveKeyDurably("GEMINI_API_KEY", key);
  }

  getGroqKey() {
    return this._getKey("GROQ_API_KEY");
  }

  saveGroqKey(key) {
    return this._saveKeyDurably("GROQ_API_KEY", key);
  }

  getMistralKey() {
    return this._getKey("MISTRAL_API_KEY");
  }

  saveMistralKey(key) {
    return this._saveKeyDurably("MISTRAL_API_KEY", key);
  }

  getCustomTranscriptionKey() {
    return this._getKey("CUSTOM_TRANSCRIPTION_API_KEY");
  }

  saveCustomTranscriptionKey(key) {
    return this._saveKeyDurably("CUSTOM_TRANSCRIPTION_API_KEY", key);
  }

  getCustomReasoningKey() {
    return this._getKey("CUSTOM_REASONING_API_KEY");
  }

  saveCustomReasoningKey(key) {
    return this._saveKeyDurably("CUSTOM_REASONING_API_KEY", key);
  }

  getCustomTranscriptionBaseUrl() {
    return this._getKey("CUSTOM_TRANSCRIPTION_BASE_URL");
  }

  saveCustomTranscriptionBaseUrl(url) {
    return this._saveKey("CUSTOM_TRANSCRIPTION_BASE_URL", url);
  }

  getCustomReasoningBaseUrl() {
    return this._getKey("CUSTOM_REASONING_BASE_URL");
  }

  saveCustomReasoningBaseUrl(url) {
    return this._saveKey("CUSTOM_REASONING_BASE_URL", url);
  }

  getDictationKey() {
    return this._getKey("DICTATION_KEY");
  }

  saveDictationKey(key) {
    const result = this._saveKey("DICTATION_KEY", key);
    this.saveAllKeysToEnvFile();
    return result;
  }

  getClipboardDictationKey() {
    return this._getKey("DICTATION_KEY_CLIPBOARD");
  }

  saveClipboardDictationKey(key) {
    const result = this._saveKey("DICTATION_KEY_CLIPBOARD", key);
    this.saveAllKeysToEnvFile();
    return result;
  }

  getActivationMode() {
    const mode = this._getKey("ACTIVATION_MODE");
    return mode === "push" ? "push" : "tap";
  }

  saveActivationMode(mode) {
    const validMode = mode === "push" ? "push" : "tap";
    const result = this._saveKey("ACTIVATION_MODE", validMode);
    this.saveAllKeysToEnvFile();
    return result;
  }

  saveDebugLogLevel(level) {
    const normalizedLevel = typeof level === "string" ? level.trim().toLowerCase() : "info";
    const nextLevel =
      normalizedLevel === "trace" ||
      normalizedLevel === "debug" ||
      normalizedLevel === "warn" ||
      normalizedLevel === "error" ||
      normalizedLevel === "fatal"
        ? normalizedLevel
        : "info";
    const result = this._saveKey("OPENWHISPR_LOG_LEVEL", nextLevel);
    const envWrite = this.saveAllKeysToEnvFile();
    return {
      ...result,
      saveAllKeysResult: envWrite,
      logLevel: nextLevel,
    };
  }

  _getDebugConsentPath() {
    return path.join(this.app.getPath("userData"), DEBUG_CONSENT_FILE);
  }

  hasDebugConsent() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this._getDebugConsentPath(), "utf8"));
      return parsed?.version === 1 && parsed?.consented === true;
    } catch {
      return false;
    }
  }

  setDebugConsent(consented) {
    const consentPath = this._getDebugConsentPath();
    if (!consented) {
      try {
        fs.unlinkSync(consentPath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      return { success: true };
    }
    writePrivateFileAtomic(consentPath, `${JSON.stringify({ version: 1, consented: true })}\n`);
    return { success: true };
  }

  enforceDebugConsent() {
    const level = String(process.env.OPENWHISPR_LOG_LEVEL || "").toLowerCase();
    if ((level === "debug" || level === "trace") && !this.hasDebugConsent()) {
      process.env.OPENWHISPR_LOG_LEVEL = "info";
      return this.saveAllKeysToEnvFile();
    }
    return { success: true };
  }

  saveAllKeysToEnvFile() {
    const envPath = this._getUserDataEnvPath();
    const result = this._queueEnvWrite(() => {
      return this._persistAllKeysToEnvFile(envPath);
    });
    if (result?.success !== false) {
      return { success: true, path: envPath, queued: Boolean(result?.queued) };
    }
    return result;
  }
}

module.exports = EnvironmentManager;
module.exports.PERSISTED_KEYS = PERSISTED_KEYS;
module.exports.validatePersistedValue = validatePersistedValue;
module.exports.writePrivateFileAtomic = writePrivateFileAtomic;
