const path = require("path");
const fs = require("fs");
const { app } = require("electron");

const PERSISTED_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "CUSTOM_TRANSCRIPTION_API_KEY",
  "CUSTOM_REASONING_API_KEY",
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

class EnvironmentManager {
  constructor() {
    this._envWriteInProgress = false;
    this._envWriteNeedsRetry = false;
    this.loadEnvironmentVariables();
  }

  loadEnvironmentVariables() {
    // Loaded in priority order — dotenv won't override, so first file wins per variable
    const possibleEnvPaths = [
      path.join(app.getPath("userData"), ".env"),
      path.join(__dirname, "..", "..", ".env"), // Development
      path.join(process.resourcesPath, ".env"),
      path.join(process.resourcesPath, "app.asar.unpacked", ".env"),
      path.join(process.resourcesPath, "app", ".env"), // Legacy
    ];

    for (const envPath of possibleEnvPaths) {
      try {
        if (fs.existsSync(envPath)) {
          require("dotenv").config({ path: envPath });
        }
      } catch (error) {}
    }
  }

  _getKey(envVarName) {
    return process.env[envVarName] || "";
  }

  _saveKey(envVarName, key) {
    process.env[envVarName] = key;
    return { success: true };
  }

  _getUserDataEnvPath() {
    return path.join(app.getPath("userData"), ".env");
  }

  _readDotEnvFile(envPath) {
    try {
      if (!fs.existsSync(envPath)) {
        return "";
      }
      return fs.readFileSync(envPath, "utf8");
    } catch {
      return "";
    }
  }

  _parseEnvLine(line) {
    const trimmed = typeof line === "string" ? line.trim() : "";
    if (!trimmed || trimmed.startsWith("#")) {
      return null;
    }
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) {
      return null;
    }
    return {
      key: line.slice(0, eqIndex),
      value: line.slice(eqIndex + 1),
      raw: line,
    };
  }

  _persistAllKeysToEnvFile(envPath) {
    try {
      const existingLines = this._readDotEnvFile(envPath).split(/\r?\n/);
      const persistedKeySet = new Set(PERSISTED_KEYS);
      const wroteKeys = new Set();
      const keptLines = [];

      for (const line of existingLines) {
        const parsed = this._parseEnvLine(line);
        if (!parsed) {
          if (line !== undefined && line !== null && line.length > 0) {
            keptLines.push(line);
          }
          continue;
        }

        if (!persistedKeySet.has(parsed.key)) {
          keptLines.push(line);
          continue;
        }

        const envValue = process.env[parsed.key];
        if (envValue) {
          keptLines.push(`${parsed.key}=${envValue}`);
          wroteKeys.add(parsed.key);
        }
      }

      for (const key of PERSISTED_KEYS) {
        if (wroteKeys.has(key)) {
          continue;
        }
        const value = process.env[key];
        if (!value) {
          continue;
        }
        keptLines.push(`${key}=${value}`);
        wroteKeys.add(key);
      }

      const output = keptLines.join("\n");
      fs.writeFileSync(envPath, output, "utf8");
      require("dotenv").config({ path: envPath });

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
    return this._saveKey("OPENAI_API_KEY", key);
  }

  getAnthropicKey() {
    return this._getKey("ANTHROPIC_API_KEY");
  }

  saveAnthropicKey(key) {
    return this._saveKey("ANTHROPIC_API_KEY", key);
  }

  getGeminiKey() {
    return this._getKey("GEMINI_API_KEY");
  }

  saveGeminiKey(key) {
    return this._saveKey("GEMINI_API_KEY", key);
  }

  getGroqKey() {
    return this._getKey("GROQ_API_KEY");
  }

  saveGroqKey(key) {
    return this._saveKey("GROQ_API_KEY", key);
  }

  getMistralKey() {
    return this._getKey("MISTRAL_API_KEY");
  }

  saveMistralKey(key) {
    return this._saveKey("MISTRAL_API_KEY", key);
  }

  getCustomTranscriptionKey() {
    return this._getKey("CUSTOM_TRANSCRIPTION_API_KEY");
  }

  saveCustomTranscriptionKey(key) {
    return this._saveKey("CUSTOM_TRANSCRIPTION_API_KEY", key);
  }

  getCustomReasoningKey() {
    return this._getKey("CUSTOM_REASONING_API_KEY");
  }

  saveCustomReasoningKey(key) {
    return this._saveKey("CUSTOM_REASONING_API_KEY", key);
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
      normalizedLevel === "trace" || normalizedLevel === "debug" || normalizedLevel === "warn" || normalizedLevel === "error" || normalizedLevel === "fatal"
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

  createProductionEnvFile(apiKey) {
    const envPath = path.join(app.getPath("userData"), ".env");

    const envContent = `# EchoDraft Environment Variables
# This file was created automatically for production use
OPENAI_API_KEY=${apiKey}
`;

    fs.writeFileSync(envPath, envContent, "utf8");
    require("dotenv").config({ path: envPath });

    return { success: true, path: envPath };
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
