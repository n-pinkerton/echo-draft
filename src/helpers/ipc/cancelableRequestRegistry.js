const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{15,79}$/;
const CANCEL_TOMBSTONE_TTL_MS = 30_000;

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

  _pruneTombstones() {
    const cutoff = this.now() - CANCEL_TOMBSTONE_TTL_MS;
    for (const [key, cancelledAt] of this.cancelledBeforeRegistration) {
      if (cancelledAt < cutoff) this.cancelledBeforeRegistration.delete(key);
    }
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

    const controller = new AbortController();
    const onSenderDestroyed = () => controller.abort(createAbortError());
    const entry = { controller, event, key, onSenderDestroyed };
    this.active.set(key, entry);
    event.sender.once?.("destroyed", onSenderDestroyed);

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
        event.sender.removeListener?.("destroyed", onSenderDestroyed);
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
    this.cancelledBeforeRegistration.set(key, this.now());
    return false;
  }

  get activeCount() {
    return this.active.size;
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
  createAbortError,
  registerCancelableRequestHandler,
};
