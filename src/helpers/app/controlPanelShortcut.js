const debugLogger = require("../debugLogger");
const { accelerator: CONTROL_PANEL_ACCELERATOR } = require("../../shared/controlPanelShortcut");

function registerControlPanelShortcut(
  { globalShortcut },
  {
    windowManager,
    logger = debugLogger,
    accelerator = CONTROL_PANEL_ACCELERATOR,
    retryMs = 5000,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    onStatusChange = null,
  }
) {
  let opening = false;
  let registered = false;
  let disposed = false;
  let retryTimer = null;

  const status = (reason = null) => ({ accelerator, registered, reason });
  const publishStatus = (reason = null) => {
    const next = status(reason);
    onStatusChange?.(next);
    return next;
  };

  const clearRetry = () => {
    if (!retryTimer) return;
    clearTimeoutFn(retryTimer);
    retryTimer = null;
  };

  const scheduleRetry = () => {
    if (disposed || registered || retryTimer || retryMs <= 0) return;
    retryTimer = setTimeoutFn(() => {
      retryTimer = null;
      tryRegister("retry");
    }, retryMs);
    retryTimer?.unref?.();
  };

  const openControlPanel = () => {
    if (opening) return;
    opening = true;
    Promise.resolve(windowManager?.createControlPanelWindow?.())
      .catch((error) => {
        logger?.warn?.("Control panel shortcut could not open the window", {
          error: error?.message || String(error),
        });
      })
      .finally(() => {
        opening = false;
      });
  };

  const tryRegister = (reason = "startup") => {
    if (disposed) return status("disposed");
    clearRetry();
    if (registered && globalShortcut?.isRegistered?.(accelerator)) {
      return publishStatus(null);
    }

    registered = Boolean(globalShortcut?.register?.(accelerator, openControlPanel));
    if (registered) {
      logger?.info?.("Control panel shortcut registered", { accelerator, reason });
      return publishStatus(null);
    }

    logger?.warn?.("Control panel shortcut registration failed", { accelerator, reason });
    const next = publishStatus("unavailable");
    scheduleRetry();
    return next;
  };

  tryRegister("startup");

  return {
    accelerator,
    get registered() {
      return registered;
    },
    getStatus: () => status(registered ? null : "unavailable"),
    refresh(reason = "manual") {
      if (registered) {
        globalShortcut?.unregister?.(accelerator);
        registered = false;
      }
      return tryRegister(reason);
    },
    dispose() {
      disposed = true;
      clearRetry();
      if (registered) globalShortcut?.unregister?.(accelerator);
      registered = false;
    },
  };
}

module.exports = { registerControlPanelShortcut };
