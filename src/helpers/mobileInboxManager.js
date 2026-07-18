const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { isLiveWindow } = require("./app/windowUtils");
const debugLogger = require("./debugLogger");
const { MobileInboxFileStore } = require("./mobileInboxFileStore");

const CONFIG_FILE_NAME = "mobile-inbox.json";
const POLL_INTERVAL_MS = 5_000;
const RETRY_DELAY_MS = 15_000;
const MAX_SETTLING_ATTEMPTS = 5;
const SETTLING_WINDOW_MS = 2 * 60 * 1_000;
const EVIDENCELESS_RETRY_DELAY_MS = 10 * 60 * 1_000;
const SAFE_METADATA_TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

class TemporaryMobileInboxError extends Error {}

class SettlingMobileInboxError extends TemporaryMobileInboxError {
  constructor(message, { signature = null, manifestEvidence = null } = {}) {
    super(message);
    this.signature = signature;
    this.manifestEvidence = manifestEvidence;
  }
}

class PermanentMobileInboxError extends Error {
  constructor(message, manifestEvidence = null) {
    super(message);
    this.manifestEvidence = manifestEvidence;
  }
}

const normalizeMetadataToken = (value) => {
  const token = typeof value === "string" ? value.trim() : "";
  return SAFE_METADATA_TOKEN.test(token) ? token : null;
};

class MobileInboxManager {
  constructor(options) {
    this.app = options.app;
    this.databaseManager = options.databaseManager;
    this.windowManager = options.windowManager;
    this.fs = options.fsImpl || fs;
    this.path = options.pathImpl || path;
    this.crypto = options.cryptoImpl || crypto;
    this.logger = options.logger || debugLogger;
    this.fileStore =
      options.fileStore ||
      new MobileInboxFileStore({
        fsImpl: this.fs,
        pathImpl: this.path,
        cryptoImpl: this.crypto,
      });
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
    this.maxSettlingAttempts = options.maxSettlingAttempts ?? MAX_SETTLING_ATTEMPTS;
    this.settlingWindowMs = options.settlingWindowMs ?? SETTLING_WINDOW_MS;
    this.evidencelessRetryDelayMs =
      options.evidencelessRetryDelayMs ?? EVIDENCELESS_RETRY_DELAY_MS;
    this.configPath = this.path.join(this.app.getPath("userData"), CONFIG_FILE_NAME);
    this.inboxPath = this._loadConfiguredPath();
    this.started = false;
    this.timer = null;
    this.scanPromise = null;
    this.pendingRequests = new Map();
    this.pendingRequestByExternalId = new Map();
    this.retryAfterByItemKey = new Map();
    this.settlingByItemKey = new Map();
    this.rendererReady = false;
    this.rendererGeneration = 0;
    this.state = this.inboxPath ? "waiting" : "not_configured";
  }

  _loadConfiguredPath() {
    try {
      const parsed = JSON.parse(this.fs.readFileSync(this.configPath, "utf8"));
      const folderPath =
        parsed?.version === 1 && typeof parsed?.folderPath === "string"
          ? parsed.folderPath.trim()
          : "";
      return folderPath ? this.path.resolve(folderPath) : null;
    } catch {
      return null;
    }
  }

  _saveConfiguredPath() {
    const parent = this.path.dirname(this.configPath);
    this.fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    const tempPath = this.path.join(parent, `.${CONFIG_FILE_NAME}.${process.pid}.tmp`);
    try {
      this.fs.writeFileSync(
        tempPath,
        `${JSON.stringify({ version: 1, folderPath: this.inboxPath }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 }
      );
      this.fs.renameSync(tempPath, this.configPath);
    } finally {
      try {
        if (this.fs.existsSync(tempPath)) this.fs.unlinkSync(tempPath);
      } catch {}
    }
  }

  getStatus() {
    return {
      configured: Boolean(this.inboxPath),
      folderPath: this.inboxPath,
      state: this.state,
    };
  }

  async setInboxPath(folderPath) {
    const canonicalPath = await this.fileStore.canonicalizeFolder(folderPath);
    this.inboxPath = canonicalPath;
    this.state = "waiting";
    this.retryAfterByItemKey.clear();
    this.settlingByItemKey.clear();
    this._saveConfiguredPath();
    if (this.started && this.rendererReady) void this.scanNow();
    return this.getStatus();
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.timer = setInterval(() => void this.scanNow(), this.pollIntervalMs);
    this.timer.unref?.();
    if (this.rendererReady) void this.scanNow();
  }

  markRendererReady() {
    this.rendererReady = true;
    this.retryAfterByItemKey.clear();
    if (this.started) void this.scanNow();
    return { success: true };
  }

  observeRendererWindow(window) {
    const generation = ++this.rendererGeneration;
    this.markRendererUnavailable();
    const markUnavailableIfCurrent = () => {
      if (generation === this.rendererGeneration) this.markRendererUnavailable();
    };
    window?.webContents?.on?.("did-start-loading", markUnavailableIfCurrent);
    window?.webContents?.on?.("render-process-gone", markUnavailableIfCurrent);
    window?.on?.("closed", markUnavailableIfCurrent);
    return generation;
  }

  markRendererUnavailable() {
    this.rendererReady = false;
    this._rejectPending("EchoDraft renderer became unavailable");
  }

  stop() {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.rendererReady = false;
    this._rejectPending("Mobile inbox stopped");
    this.state = this.inboxPath ? "stopped" : "not_configured";
  }

  _rejectPending(message) {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new TemporaryMobileInboxError(message));
    }
    this.pendingRequests.clear();
    this.pendingRequestByExternalId.clear();
  }

  async scanNow() {
    if (!this.inboxPath || !this.rendererReady) return;
    if (this.scanPromise) return await this.scanPromise;
    const selectedPath = this.inboxPath;
    this.scanPromise = this._scanOnce(selectedPath).finally(() => {
      this.scanPromise = null;
    });
    return await this.scanPromise;
  }

  async _scanOnce(selectedPath) {
    let root;
    let manifests;
    try {
      root = await this.fileStore.snapshotRoot(selectedPath);
      manifests = await this.fileStore.listManifests(root);
    } catch (error) {
      this.state = "folder_unavailable";
      this.logger.warn("Mobile inbox folder is unavailable", { errorCategory: error?.code });
      return;
    }

    this.state = "waiting";
    for (const manifestFileName of manifests) {
      const externalId = manifestFileName.slice(0, 36).toLowerCase();
      const itemKey = `${root.realPath}\0${externalId}`;
      if ((this.retryAfterByItemKey.get(itemKey) || 0) > Date.now()) continue;

      try {
        this.state = "processing";
        await this._processManifest(root, manifestFileName);
        this._clearItemState(itemKey);
        this.state = "waiting";
        break;
      } catch (error) {
        if (error instanceof SettlingMobileInboxError) {
          await this._handleSettlingFailure(root, manifestFileName, itemKey, externalId, error);
          continue;
        }
        if (error instanceof TemporaryMobileInboxError) {
          this._scheduleRetry(itemKey);
          this.state = "retrying";
          this.logger.warn("Mobile inbox item will be retried", {
            externalId,
            errorCategory: error?.code || error?.name,
          });
          break;
        }

        const manifestEvidence = error?.manifestEvidence || null;
        if (manifestEvidence) {
          try {
            await this.fileStore.quarantineManifest(root, manifestEvidence);
            this._clearItemState(itemKey);
            this.state = "item_error";
            this.logger.error("Mobile inbox manifest was quarantined", {
              externalId,
              errorCategory: error?.code || error?.name,
            });
          } catch (quarantineError) {
            this._scheduleRetry(itemKey);
            this.state = "retrying";
            this.logger.warn("Mobile inbox quarantine will be retried", {
              externalId,
              errorCategory: quarantineError?.code || quarantineError?.name,
            });
          }
          continue;
        }

        this._scheduleRetry(itemKey);
        this.state = "retrying";
        this.logger.warn("Mobile inbox item could not be classified and will be retried", {
          externalId,
          errorCategory: error?.code || error?.name,
        });
      }
    }
  }

  _scheduleRetry(itemKey, delayMs = this.retryDelayMs) {
    this.retryAfterByItemKey.set(itemKey, Date.now() + delayMs);
  }

  _clearItemState(itemKey) {
    this.retryAfterByItemKey.delete(itemKey);
    this.settlingByItemKey.delete(itemKey);
  }

  async _handleSettlingFailure(root, manifestFileName, itemKey, externalId, error) {
    const now = Date.now();
    const previous = this.settlingByItemKey.get(itemKey);
    const signature = error.signature || `manifest-error:${error.name}`;
    const sameSignature = Boolean(previous?.signature === signature);
    const next = {
      signature,
      firstSeenAt: sameSignature ? previous.firstSeenAt : now,
      attempts: sameSignature ? previous.attempts + 1 : 1,
      manifestEvidence: error.manifestEvidence || null,
    };
    this.settlingByItemKey.set(itemKey, next);

    const stableLongEnough = now - next.firstSeenAt >= this.settlingWindowMs;
    const reachedSettlingLimit =
      next.attempts >= this.maxSettlingAttempts && stableLongEnough;
    const shouldQuarantine =
      Boolean(next.signature && next.manifestEvidence) && reachedSettlingLimit;
    if (shouldQuarantine) {
      try {
        await this.fileStore.quarantineManifest(root, next.manifestEvidence);
        this._clearItemState(itemKey);
        this.state = "item_error";
        this.logger.error("Stable invalid mobile inbox item was quarantined", {
          externalId,
          errorCategory: error?.code || error?.name,
        });
        return;
      } catch (quarantineError) {
        this.logger.warn("Mobile inbox quarantine will be retried", {
          externalId,
          errorCategory: quarantineError?.code || quarantineError?.name,
        });
      }
    }

    if (reachedSettlingLimit && !next.manifestEvidence) {
      this._scheduleRetry(itemKey, this.evidencelessRetryDelayMs);
      this.state = "item_error";
      this.logger.error("Unreadable mobile inbox item entered delayed retry", {
        externalId,
        errorCategory: error?.code || error?.name,
      });
      return;
    }

    this._scheduleRetry(itemKey);
    this.state = "retrying";
    this.logger.warn("Mobile inbox item is still settling", {
      externalId,
      manifestFileName,
      attempts: next.attempts,
      errorCategory: error?.code || error?.name,
    });
  }

  async _readManifest(root, manifestFileName) {
    try {
      return await this.fileStore.readManifest(root, manifestFileName);
    } catch (error) {
      throw new SettlingMobileInboxError(error?.message || "Mobile manifest is still syncing", {
        signature:
          error?.mobileInboxSignature ||
          `manifest-error:${error?.code || error?.name || "unknown"}`,
        manifestEvidence: error?.mobileInboxEvidence || null,
      });
    }
  }

  async _readAudio(root, manifest, manifestEvidence) {
    try {
      const result = await this.fileStore.readAudio(root, manifest);
      if (result.evidence.sha256 !== manifest.audioSha256) {
        throw new SettlingMobileInboxError("Mobile audio hash does not match yet", {
          signature: `audio-hash:${result.evidence.sha256}`,
          manifestEvidence,
        });
      }
      return result;
    } catch (error) {
      if (error instanceof SettlingMobileInboxError) throw error;
      const signature =
        error?.mobileInboxSignature ||
        (error?.code === "ENOENT" ? `audio-missing:${manifest.audioSha256}` : null);
      throw new SettlingMobileInboxError(error?.message || "Mobile audio is still syncing", {
        signature,
        manifestEvidence,
      });
    }
  }

  async _processManifest(root, manifestFileName) {
    const { manifest, evidence: manifestEvidence } = await this._readManifest(
      root,
      manifestFileName
    );
    const existing = this.databaseManager.getTodoByExternalId(manifest.externalId);
    if (existing) {
      if (existing.meta?.mobileInbox?.audioSha256 !== manifest.audioSha256) {
        throw new PermanentMobileInboxError(
          "Mobile inbox external ID already belongs to different audio",
          manifestEvidence
        );
      }

      let audioEvidence = null;
      try {
        audioEvidence = (await this._readAudio(root, manifest, manifestEvidence)).evidence;
      } catch (error) {
        if (!(error instanceof SettlingMobileInboxError) || !/audio-missing:/.test(error.signature)) {
          throw error;
        }
      }
      await this._removeCompletedInput(root, { manifestEvidence, audioEvidence });
      return;
    }

    const { buffer, evidence: audioEvidence } = await this._readAudio(
      root,
      manifest,
      manifestEvidence
    );
    const result = await this._dispatchToRenderer(manifest, buffer);
    if (!result?.success || typeof result.text !== "string" || !result.text.trim()) {
      throw new TemporaryMobileInboxError("Mobile transcription did not complete");
    }

    const provider = normalizeMetadataToken(result.provider || result.source);
    const model = normalizeMetadataToken(result.model);
    const saved = this.databaseManager.saveTodo({
      externalId: manifest.externalId,
      title: result.title,
      text: result.text,
      rawText: result.rawText,
      meta: {
        source: "android",
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
        ...(result.cleanup && typeof result.cleanup === "object"
          ? { cleanup: result.cleanup }
          : {}),
        ...(result.timings && typeof result.timings === "object"
          ? { timings: result.timings }
          : {}),
        mobileInbox: {
          version: manifest.version,
          audioSha256: audioEvidence.sha256,
          createdAt: manifest.createdAt,
          mimeType: manifest.mimeType,
          sizeBytes: manifest.sizeBytes,
        },
      },
    });
    if (!saved?.success) throw new TemporaryMobileInboxError("Mobile To Do item was not saved");

    this._notifyTodoAdded(saved.todo);
    await this._removeCompletedInput(root, { manifestEvidence, audioEvidence });
  }

  _notifyTodoAdded(todo) {
    const controlPanel = this.windowManager?.controlPanelWindow;
    if (!isLiveWindow(controlPanel)) return;
    controlPanel.webContents.send("todo-added", {
      id: todo.id,
      text: todo.text,
      title: todo.meta?.title || null,
      created_at: todo.created_at,
    });
  }

  _dispatchToRenderer(manifest, buffer) {
    const mainWindow = this.windowManager?.mainWindow;
    if (!this.rendererReady || !isLiveWindow(mainWindow)) {
      throw new TemporaryMobileInboxError("EchoDraft renderer is unavailable");
    }
    if (this.pendingRequestByExternalId.has(manifest.externalId)) {
      throw new TemporaryMobileInboxError("Mobile inbox item is already processing");
    }

    const requestId = this.crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { externalId: manifest.externalId, resolve, reject });
      this.pendingRequestByExternalId.set(manifest.externalId, requestId);
      try {
        mainWindow.webContents.send("mobile-inbox-process", {
          requestId,
          externalId: manifest.externalId,
          mimeType: manifest.mimeType,
          createdAt: manifest.createdAt,
          data: buffer,
        });
      } catch (error) {
        this.pendingRequests.delete(requestId);
        this.pendingRequestByExternalId.delete(manifest.externalId);
        reject(new TemporaryMobileInboxError(error?.message || "Mobile dispatch failed"));
      }
    });
  }

  completeRequest(requestId, result) {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return { success: false, stale: true };
    this.pendingRequests.delete(requestId);
    this.pendingRequestByExternalId.delete(pending.externalId);
    pending.resolve(result);
    return { success: true };
  }

  async _removeCompletedInput(root, evidence) {
    try {
      await this.fileStore.removeCompleted(root, evidence);
    } catch (error) {
      throw new TemporaryMobileInboxError(
        error?.message || "Completed mobile inbox cleanup will be retried"
      );
    }
  }
}

module.exports = {
  MobileInboxManager,
  PermanentMobileInboxError,
  SettlingMobileInboxError,
  TemporaryMobileInboxError,
};
