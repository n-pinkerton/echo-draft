const WINDOWS_CLIPBOARD_RESTORE_FAILED = "WINDOWS_CLIPBOARD_RESTORE_FAILED";
const WINDOWS_CLIPBOARD_RESTORE_PENDING = "WINDOWS_CLIPBOARD_RESTORE_PENDING";
const RESTORE_RETRY_DELAYS_MS = Object.freeze([120, 300]);

async function attemptRestore(manager, snapshot, delayMs, webContents, expectedText) {
  try {
    return await manager.scheduleClipboardRestore(snapshot, delayMs, webContents, {
      expectedText,
    });
  } catch (error) {
    manager.safeLog("Clipboard restoration attempt rejected", {
      delayMs,
      error: error?.message || String(error),
    });
    return { success: false, reason: "restore_rejected" };
  }
}

async function restoreClipboardAfterPaste(
  manager,
  originalClipboardSnapshot,
  delayMs,
  webContents,
  expectedText
) {
  const delays = [delayMs, ...RESTORE_RETRY_DELAYS_MS];
  let result = null;
  for (const retryDelay of delays) {
    // Keep the insertion queue held until transient clipboard locks have had a
    // bounded chance to clear. The captured snapshot remains in memory if all
    // attempts fail so a later secure insertion can recover it before mutation.
    // eslint-disable-next-line no-await-in-loop
    result = await attemptRestore(
      manager,
      originalClipboardSnapshot,
      retryDelay,
      webContents,
      expectedText
    );
    if (result?.success !== false) {
      if (manager.pendingWindowsClipboardRestoration?.snapshot === originalClipboardSnapshot) {
        manager.pendingWindowsClipboardRestoration = null;
      }
      return {
        success: true,
        injected: true,
        clipboardRestored: true,
        ...(result?.skipped ? { restoreSkipped: true } : {}),
      };
    }
  }

  manager.pendingWindowsClipboardRestoration = {
    snapshot: originalClipboardSnapshot,
    webContents,
    expectedText,
    capturedAt: Date.now(),
  };
  return {
    success: true,
    injected: true,
    clipboardRestored: false,
    warningCode: WINDOWS_CLIPBOARD_RESTORE_FAILED,
  };
}

async function retryPendingWindowsClipboardRestoration(manager) {
  const pending = manager.pendingWindowsClipboardRestoration;
  if (!pending) return { success: true, skipped: true, reason: "none_pending" };

  const result = await attemptRestore(
    manager,
    pending.snapshot,
    0,
    pending.webContents,
    pending.expectedText
  );
  if (result?.success !== false && manager.pendingWindowsClipboardRestoration === pending) {
    manager.pendingWindowsClipboardRestoration = null;
  }
  return result;
}

module.exports = {
  RESTORE_RETRY_DELAYS_MS,
  WINDOWS_CLIPBOARD_RESTORE_FAILED,
  WINDOWS_CLIPBOARD_RESTORE_PENDING,
  restoreClipboardAfterPaste,
  retryPendingWindowsClipboardRestoration,
};
