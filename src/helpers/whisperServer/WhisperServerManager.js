const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const debugLogger = require("../debugLogger");
const {
  abortableDelay,
  createAbortError,
  raceWithAbort,
  throwIfAborted,
} = require("../abortUtils");
const { killProcess } = require("../../utils/process");
const { convertToWav, getFFmpegPath } = require("../ffmpegUtils");
const { getSafeTempDir } = require("../safeTempDir");
const { findAvailablePort } = require("./portUtils");
const { getWhisperServerBinaryPath } = require("./serverBinary");
const { buildWhisperMultipartBody } = require("./multipartBody");
const { convertBufferToWav } = require("./audioConversion");

const STARTUP_TIMEOUT_MS = 30000;
const HEALTH_CHECK_INTERVAL_MS = 5000;
const HEALTH_CHECK_TIMEOUT_MS = 2000;
const MAX_TRANSCRIPTION_RESPONSE_BYTES = 8 * 1024 * 1024;

class WhisperServerManager {
  constructor() {
    this.process = null;
    this.port = null;
    this.ready = false;
    this.modelPath = null;
    this.startupPromise = null;
    this.healthCheckInterval = null;
    this.cachedServerBinaryPath = null;
    this.canConvert = false;
  }

  _markProcessUnavailable(targetProcess, { clearModel = false } = {}) {
    if (this.process !== targetProcess) return;

    this.process = null;
    this.ready = false;
    this.port = null;
    if (clearModel) this.modelPath = null;
    this.stopHealthCheck();
  }

  _handleProcessClose(startedProcess, code) {
    debugLogger.debug("whisper-server process exited", { code });
    this._markProcessUnavailable(startedProcess);
  }

  async _terminateProcess(targetProcess, { clearModel = false } = {}) {
    if (!targetProcess) return;

    this._markProcessUnavailable(targetProcess, { clearModel });
    if (targetProcess.exitCode !== null || targetProcess.signalCode !== null) return;

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forceKillTimeout);
        targetProcess.removeListener("close", finish);
        resolve();
      };
      const forceKillTimeout = setTimeout(() => {
        killProcess(targetProcess, "SIGKILL");
      }, 5000);

      targetProcess.once("close", finish);
      killProcess(targetProcess, "SIGTERM");

      if (targetProcess.exitCode !== null || targetProcess.signalCode !== null) finish();
    });
  }

  getServerBinaryPath() {
    if (this.cachedServerBinaryPath) return this.cachedServerBinaryPath;
    const candidate = getWhisperServerBinaryPath({ baseDir: __dirname });
    this.cachedServerBinaryPath = candidate;
    return candidate;
  }

  isAvailable() {
    return this.getServerBinaryPath() !== null;
  }

  async start(modelPath, options = {}) {
    const signal = options?.signal || null;
    throwIfAborted(signal);
    if (this.startupPromise) return await raceWithAbort(this.startupPromise, signal);
    if (this.ready && this.modelPath === modelPath) return;
    if (this.process) {
      await this.stop();
    }

    this.startupPromise = this._doStart(modelPath, options);
    try {
      await this.startupPromise;
    } finally {
      this.startupPromise = null;
    }
  }

  async _doStart(modelPath, options = {}) {
    const signal = options?.signal || null;
    throwIfAborted(signal);
    const serverBinary = this.getServerBinaryPath();
    if (!serverBinary) throw new Error("whisper-server binary not found");
    if (!fs.existsSync(modelPath)) throw new Error(`Model file not found: ${modelPath}`);

    this.port = await findAvailablePort();
    throwIfAborted(signal);
    this.modelPath = modelPath;

    const ffmpegPath = getFFmpegPath();
    const spawnEnv = { ...process.env };
    const pathSep = process.platform === "win32" ? ";" : ":";

    if (process.platform === "win32") {
      const safeTmp = getSafeTempDir();
      spawnEnv.TEMP = safeTmp;
      spawnEnv.TMP = safeTmp;
    }

    const serverBinaryDir = path.dirname(serverBinary);
    spawnEnv.PATH = serverBinaryDir + pathSep + (process.env.PATH || "");

    const args = ["--model", modelPath, "--host", "127.0.0.1", "--port", String(this.port)];

    this.canConvert = Boolean(ffmpegPath);
    if (ffmpegPath) {
      const ffmpegDir = path.dirname(ffmpegPath);
      spawnEnv.PATH = ffmpegDir + pathSep + spawnEnv.PATH;
    } else {
      debugLogger.warn("FFmpeg not found - whisper-server will only accept 16kHz mono WAV");
    }

    if (options.threads) args.push("--threads", String(options.threads));
    if (options.language && options.language !== "auto") {
      args.push("--language", options.language);
    }

    debugLogger.debug("Starting whisper-server", {
      port: this.port,
      modelPath,
      args,
      cwd: serverBinaryDir,
    });

    this.process = spawn(serverBinary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: spawnEnv,
      cwd: serverBinaryDir,
    });
    const startedProcess = this.process;
    const onAbort = () => {
      if (this.process === startedProcess) {
        this.ready = false;
        killProcess(startedProcess, "SIGKILL");
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    let stderrBuffer = "";
    let exitCode = null;

    this.process.stdout.on("data", (data) => {
      debugLogger.debug("whisper-server stdout", { data: data.toString().trim() });
    });

    this.process.stderr.on("data", (data) => {
      stderrBuffer += data.toString();
      debugLogger.debug("whisper-server stderr", { data: data.toString().trim() });
    });

    this.process.on("error", (error) => {
      debugLogger.error("whisper-server process error", { error: error.message });
      if (this.process === startedProcess) this.ready = false;
    });

    this.process.on("close", (code) => {
      exitCode = code;
      this._handleProcessClose(startedProcess, code);
    });

    try {
      await this.waitForReady(() => ({ stderr: stderrBuffer, exitCode }), signal);
      throwIfAborted(signal);
      this.startHealthCheck();
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }

    debugLogger.info("whisper-server started successfully", {
      port: this.port,
      model: path.basename(modelPath),
    });
  }

  async waitForReady(getProcessInfo, signal = null) {
    const startTime = Date.now();
    let pollCount = 0;
    const STARTUP_POLL_INTERVAL_MS = 100;

    while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
      throwIfAborted(signal);
      if (!this.process || this.process.killed) {
        const info = getProcessInfo ? getProcessInfo() : {};
        const stderr = info.stderr ? info.stderr.trim().slice(0, 200) : "";
        const details = stderr || (info.exitCode !== null ? `exit code: ${info.exitCode}` : "");
        throw new Error(
          `whisper-server process died during startup${details ? `: ${details}` : ""}`
        );
      }

      pollCount += 1;
      // eslint-disable-next-line no-await-in-loop
      if (await this.checkHealth(signal)) {
        this.ready = true;
        debugLogger.debug("whisper-server ready", {
          startupTimeMs: Date.now() - startTime,
          pollCount,
        });
        return;
      }

      // eslint-disable-next-line no-await-in-loop
      await abortableDelay(STARTUP_POLL_INTERVAL_MS, signal);
    }

    throw new Error(`whisper-server failed to start within ${STARTUP_TIMEOUT_MS}ms`);
  }

  checkHealth(signal = null) {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        fn(value);
      };
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: this.port,
          path: "/",
          method: "GET",
          timeout: HEALTH_CHECK_TIMEOUT_MS,
        },
        (res) => {
          finish(resolve, true);
          res.resume();
        }
      );
      const onAbort = () => {
        req.destroy();
        finish(reject, createAbortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      req.on("error", () => finish(resolve, false));
      req.on("timeout", () => {
        req.destroy();
        finish(resolve, false);
      });
      req.end();
    });
  }

  startHealthCheck() {
    this.stopHealthCheck();
    this.healthCheckInterval = setInterval(async () => {
      const checkedProcess = this.process;
      if (!checkedProcess) {
        this.stopHealthCheck();
        return;
      }
      if (!(await this.checkHealth()) && this.process === checkedProcess) {
        debugLogger.warn("whisper-server health check failed");
        this.ready = false;
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  async transcribe(audioBuffer, options = {}) {
    const signal = options?.signal || null;
    throwIfAborted(signal);
    if (!this.ready || !this.process) {
      throw new Error("whisper-server is not running");
    }

    debugLogger.debug("whisper-server transcribe called", {
      bufferLength: audioBuffer?.length || 0,
      bufferType: audioBuffer?.constructor?.name,
      firstBytes:
        audioBuffer?.length >= 16
          ? Array.from(audioBuffer.slice(0, 16))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(" ")
          : "too short",
    });

    const { language, initialPrompt } = options;

    if (!this.canConvert) {
      throw new Error("FFmpeg not found - required for audio conversion");
    }

    const finalBuffer = await this.convertAudioBuffer(audioBuffer, signal);
    throwIfAborted(signal);

    const { boundary, body } = buildWhisperMultipartBody({
      audioBuffer: finalBuffer,
      language,
      initialPrompt,
    });

    if (initialPrompt) {
      debugLogger.info("Using custom dictionary prompt", {
        promptPresent: true,
        promptLength: initialPrompt.length,
        entryCount: initialPrompt.split(",").filter(Boolean).length,
      });
    }

    const servingProcess = this.process;
    const servingPort = this.port;

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let settled = false;
      let cancelling = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        fn(value);
      };
      let req;
      const terminateServingProcess = (error) => {
        if (cancelling) return;
        cancelling = true;
        req?.destroy();
        this._terminateProcess(servingProcess).then(
          () => finish(reject, error),
          () => finish(reject, new Error("whisper-server failed and could not be stopped cleanly"))
        );
      };
      req = http.request(
        {
          hostname: "127.0.0.1",
          port: servingPort,
          path: "/inference",
          method: "POST",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": body.length,
          },
          timeout: 300000,
        },
        (res) => {
          const chunks = [];
          let responseBytes = 0;
          res.on("data", (chunk) => {
            if (cancelling) return;
            const bytes = Buffer.from(chunk);
            responseBytes += bytes.length;
            if (responseBytes > MAX_TRANSCRIPTION_RESPONSE_BYTES) {
              terminateServingProcess(new Error("whisper-server response exceeded the size limit"));
              return;
            }
            chunks.push(bytes);
          });
          res.on("end", () => {
            if (cancelling) return;
            const data = Buffer.concat(chunks, responseBytes).toString("utf8");
            debugLogger.debug("whisper-server transcription completed", {
              statusCode: res.statusCode,
              elapsed: Date.now() - startTime,
              responseLength: data.length,
            });

            if (res.statusCode !== 200) {
              finish(reject, new Error(`whisper-server returned status ${res.statusCode}`));
              return;
            }

            try {
              finish(resolve, JSON.parse(data));
            } catch (e) {
              finish(
                reject,
                new Error(
                  `Failed to parse whisper-server response (${data.length} bytes): ${e.message}`
                )
              );
            }
          });
        }
      );
      const onAbort = () => {
        terminateServingProcess(createAbortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      req.on("error", () => {
        if (cancelling) return;
        terminateServingProcess(new Error("whisper-server request failed"));
      });
      req.on("timeout", () => {
        terminateServingProcess(new Error("whisper-server request timed out"));
      });

      req.write(body);
      req.end();
    });
  }

  async convertAudioBuffer(audioBuffer, signal = null) {
    return await convertBufferToWav({
      audioBuffer,
      convertToWav,
      tempPrefix: "whisper",
      signal,
    });
  }

  async stop() {
    this.stopHealthCheck();

    if (!this.process) {
      this.ready = false;
      this.port = null;
      this.modelPath = null;
      return;
    }

    debugLogger.debug("Stopping whisper-server");
    const targetProcess = this.process;

    try {
      await this._terminateProcess(targetProcess, { clearModel: true });
    } catch (error) {
      debugLogger.error("Error stopping whisper-server", { error: error.message });
    }

    this._markProcessUnavailable(targetProcess, { clearModel: true });
  }

  getStatus() {
    return {
      available: this.isAvailable(),
      running: this.ready && this.process !== null,
      port: this.port,
      modelPath: this.modelPath,
      modelName: this.modelPath ? path.basename(this.modelPath, ".bin").replace("ggml-", "") : null,
    };
  }
}

module.exports = WhisperServerManager;
module.exports.MAX_TRANSCRIPTION_RESPONSE_BYTES = MAX_TRANSCRIPTION_RESPONSE_BYTES;
