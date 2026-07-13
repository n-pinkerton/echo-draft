const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{15,79}$/;
const CANCEL_TOMBSTONE_TTL_MS = 30_000;
const MAX_ACTIVE_REQUESTS_PER_SENDER = 16;
const MAX_TOMBSTONES_PER_SENDER = 64;
const MAX_TOMBSTONES_TOTAL = 512;

const createAbortError = () => {
  const error = new Error("Request cancelled");
  error.name = "AbortError";
  error.code = "REQUEST_CANCELLED";
  return error;
};

class CancelableRequestRegistry {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.active = new Map();
    this.cancelledBeforeRegistration = new Map();
    this.senderStates = new Map();
  }

  _validateRequestId(requestId) {
    if (typeof requestId !== "string" || !REQUEST_ID_PATTERN.test(requestId)) {
      const error = new Error("A valid cancelable request ID is required");
      error.code = "INVALID_REQUEST_ID";
      throw error;
    }
    return requestId;
  }

  _senderId(event) {
    const senderId = event?.sender?.id;
    if (!Number.isInteger(senderId) || senderId < 0) {
      const error = new Error("Cancelable request sender is unavailable");
      error.code = "INVALID_REQUEST_SENDER";
      throw error;
    }
    return senderId;
  }

  _key(senderId, requestId) {
    return `${senderId}:${requestId}`;
  }

  _countForSender(entries, senderId) {
    const prefix = `${senderId}:`;
    let count = 0;
    for (const key of entries.keys()) {
      if (key.startsWith(prefix)) count += 1;
    }
    return count;
  }

  _removeOldestTombstoneForSender(senderId) {
    const prefix = `${senderId}:`;
    for (const key of this.cancelledBeforeRegistration.keys()) {
      if (key.startsWith(prefix)) {
        this.cancelledBeforeRegistration.delete(key);
        return;
      }
    }
  }

  _ensureSenderState(event, senderId) {
    const existing = this.senderStates.get(senderId);
    if (existing) return existing;

    const sender = event.sender;
    const activeKeys = new Set();
    const onDestroyed = () => {
      for (const key of activeKeys) {
        this.active.get(key)?.controller.abort(createAbortError());
        this.active.delete(key);
      }
      const prefix = `${senderId}:`;
      for (const key of this.cancelledBeforeRegistration.keys()) {
        if (key.startsWith(prefix)) this.cancelledBeforeRegistration.delete(key);
      }
      this.senderStates.delete(senderId);
    };
    const state = { sender, activeKeys, onDestroyed };
    this.senderStates.set(senderId, state);
    sender.once?.("destroyed", onDestroyed);
    return state;
  }

  _cleanupSenderStateIfIdle(senderId) {
    const state = this.senderStates.get(senderId);
    if (!state || state.activeKeys.size > 0) return;
    if (this._countForSender(this.cancelledBeforeRegistration, senderId) > 0) return;
    state.sender.removeListener?.("destroyed", state.onDestroyed);
    this.senderStates.delete(senderId);
  }

  _pruneTombstones() {
    const cutoff = this.now() - CANCEL_TOMBSTONE_TTL_MS;
    const affectedSenders = new Set();
    for (const [key, cancelledAt] of this.cancelledBeforeRegistration) {
      if (cancelledAt < cutoff) {
        this.cancelledBeforeRegistration.delete(key);
        affectedSenders.add(Number(key.slice(0, key.indexOf(":"))));
      }
    }
    for (const senderId of affectedSenders) this._cleanupSenderStateIfIdle(senderId);
  }

  createScope(event, requestId) {
    const normalizedRequestId = this._validateRequestId(requestId);
    const senderId = this._senderId(event);
    const key = this._key(senderId, normalizedRequestId);
    this._pruneTombstones();
    if (this.active.has(key)) {
      const error = new Error("Duplicate cancelable request ID");
      error.code = "DUPLICATE_REQUEST_ID";
      throw error;
    }
    if (this._countForSender(this.active, senderId) >= MAX_ACTIVE_REQUESTS_PER_SENDER) {
      const error = new Error("Too many active cancelable requests");
      error.code = "TOO_MANY_ACTIVE_REQUESTS";
      throw error;
    }

    const controller = new AbortController();
    const senderState = this._ensureSenderState(event, senderId);
    const entry = { controller, key, senderId };
    this.active.set(key, entry);
    senderState.activeKeys.add(key);

    if (this.cancelledBeforeRegistration.delete(key)) {
      controller.abort(createAbortError());
    }

    let finished = false;
    return {
      requestId: normalizedRequestId,
      signal: controller.signal,
      finish: () => {
        if (finished) return;
        finished = true;
        if (this.active.get(key) === entry) this.active.delete(key);
        senderState.activeKeys.delete(key);
        this._cleanupSenderStateIfIdle(senderId);
      },
    };
  }

  cancel(event, requestId) {
    const normalizedRequestId = this._validateRequestId(requestId);
    const senderId = this._senderId(event);
    const key = this._key(senderId, normalizedRequestId);
    const entry = this.active.get(key);
    if (entry) {
      entry.controller.abort(createAbortError());
      return true;
    }

    this._pruneTombstones();
    this._ensureSenderState(event, senderId);
    if (
      !this.cancelledBeforeRegistration.has(key) &&
      this._countForSender(this.cancelledBeforeRegistration, senderId) >= MAX_TOMBSTONES_PER_SENDER
    ) {
      this._removeOldestTombstoneForSender(senderId);
    }
    while (
      !this.cancelledBeforeRegistration.has(key) &&
      this.cancelledBeforeRegistration.size >= MAX_TOMBSTONES_TOTAL
    ) {
      const oldestKey = this.cancelledBeforeRegistration.keys().next().value;
      if (!oldestKey) break;
      this.cancelledBeforeRegistration.delete(oldestKey);
    }
    this.cancelledBeforeRegistration.set(key, this.now());
    return false;
  }

  get activeCount() {
    return this.active.size;
  }

  get tombstoneCount() {
    return this.cancelledBeforeRegistration.size;
  }
}

function registerCancelableRequestHandler({ ipcMain }, { registry }) {
  ipcMain.handle("cancel-ipc-request", (event, requestId) => {
    try {
      return { success: registry.cancel(event, requestId) };
    } catch (error) {
      return { success: false, error: error.message, code: error.code };
    }
  });
}

module.exports = {
  CancelableRequestRegistry,
  MAX_ACTIVE_REQUESTS_PER_SENDER,
  MAX_TOMBSTONES_PER_SENDER,
  createAbortError,
  registerCancelableRequestHandler,
};
