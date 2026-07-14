function isPrimaryClipboardFormat(format) {
  const normalized = String(format || "")
    .trim()
    .toLowerCase();
  return (
    normalized === "text/plain" ||
    normalized.startsWith("text/plain;") ||
    normalized === "text/html" ||
    normalized.startsWith("text/html;") ||
    normalized === "text/rtf" ||
    normalized.startsWith("text/rtf;") ||
    normalized.startsWith("image/")
  );
}

function snapshotClipboard(manager) {
  const { clipboard } = manager.deps;
  const requireExactCustomFormatPreservation = manager.deps.platform === "win32";
  const snapshot = {
    text: "",
    html: "",
    rtf: "",
    imagePng: null,
    formats: [],
    restorable: true,
  };

  try {
    snapshot.text = clipboard.readText();
  } catch {
    snapshot.text = "";
  }

  try {
    snapshot.html = clipboard.readHTML();
  } catch {
    snapshot.html = "";
  }

  try {
    snapshot.rtf = clipboard.readRTF();
  } catch {
    snapshot.rtf = "";
  }

  try {
    const image = clipboard.readImage();
    if (image && !image.isEmpty()) {
      snapshot.imagePng = image.toPNG();
    }
  } catch {
    snapshot.imagePng = null;
  }

  if (typeof clipboard.availableFormats === "function") {
    try {
      const formats = clipboard.availableFormats();
      for (const format of formats) {
        // Stable Electron APIs above preserve the primary representations. Electron cannot
        // atomically replay arbitrary Windows formats with them, so record their presence and
        // let the insertion path fail before touching the user's clipboard.
        if (isPrimaryClipboardFormat(format)) continue;
        if (requireExactCustomFormatPreservation) {
          snapshot.restorable = false;
          snapshot.formats.push({ format: String(format) });
        }
      }
    } catch {
      if (requireExactCustomFormatPreservation) {
        snapshot.restorable = false;
        snapshot.formatEnumerationFailed = true;
      }
    }
  }

  return snapshot;
}

function isClipboardSnapshotRestorable(snapshot) {
  return Boolean(
    snapshot &&
    snapshot.restorable !== false &&
    snapshot.formatEnumerationFailed !== true &&
    (!Array.isArray(snapshot.formats) || snapshot.formats.length === 0)
  );
}

function restoreClipboardSnapshot(manager, snapshot, webContents = null) {
  if (!snapshot) {
    return { success: false, reason: "missing_snapshot" };
  }
  if (!isClipboardSnapshotRestorable(snapshot)) {
    manager.safeLog("⚠️ Clipboard restore skipped because custom formats cannot be preserved", {
      formats: Array.isArray(snapshot.formats) ? snapshot.formats.length : 0,
    });
    return { success: false, reason: "custom_formats" };
  }

  const { clipboard, nativeImage, platform } = manager.deps;

  const data = {};
  if (typeof snapshot.text === "string" && snapshot.text.length > 0) {
    data.text = snapshot.text;
  }
  if (typeof snapshot.html === "string" && snapshot.html.length > 0) {
    data.html = snapshot.html;
  }
  if (typeof snapshot.rtf === "string" && snapshot.rtf.length > 0) {
    data.rtf = snapshot.rtf;
  }
  if (Buffer.isBuffer(snapshot.imagePng) && snapshot.imagePng.length > 0) {
    try {
      data.image = nativeImage.createFromBuffer(snapshot.imagePng);
    } catch {
      // Ignore invalid image data.
    }
  }

  let restoredSomething = false;

  if (Object.keys(data).length > 0) {
    try {
      // clipboard.write atomically restores all stable primary representations. Do not replay
      // generic formats afterward: writeBuffer is experimental and may replace this content.
      clipboard.write(data);
      restoredSomething = true;
    } catch (error) {
      manager.safeLog("⚠️ Failed to restore primary clipboard data", {
        error: error?.message,
      });
    }
  }

  if (!restoredSomething && Object.keys(data).length > 0) {
    try {
      if (typeof data.text === "string") {
        if (platform === "linux" && manager._isWayland()) {
          manager._writeClipboardWayland(data.text, webContents);
        } else {
          clipboard.writeText(data.text);
        }
      } else if (typeof data.html === "string") {
        clipboard.writeHTML(data.html);
      } else if (typeof data.rtf === "string") {
        clipboard.writeRTF(data.rtf);
      } else if (data.image) {
        clipboard.writeImage(data.image);
      }
      restoredSomething = true;
    } catch (error) {
      manager.safeLog("⚠️ Failed to restore fallback clipboard data", {
        error: error?.message,
      });
    }
  }

  if (!restoredSomething) {
    const textValue = typeof snapshot.text === "string" ? snapshot.text : "";
    try {
      if (platform === "linux" && manager._isWayland()) {
        manager._writeClipboardWayland(textValue, webContents);
      } else {
        clipboard.writeText(textValue);
      }
      restoredSomething = true;
    } catch (error) {
      manager.safeLog("⚠️ Failed to restore clipboard text", { error: error?.message });
    }
  }

  return restoredSomething ? { success: true } : { success: false, reason: "restore_failed" };
}

function scheduleClipboardRestore(
  manager,
  snapshot,
  delayMs,
  webContents = null,
  { expectedText } = {}
) {
  const setTimeoutFn = manager.deps.setTimeout || setTimeout;
  return new Promise((resolve) => {
    setTimeoutFn(() => {
      if (typeof expectedText === "string") {
        try {
          if (manager.deps.clipboard.readText() !== expectedText) {
            const result = { success: true, skipped: true, reason: "clipboard_changed" };
            manager.safeLog("↪️ Clipboard restore skipped because newer content was copied", {
              delayMs,
            });
            resolve(result);
            return;
          }
        } catch {
          // If the lease cannot be inspected, attempt the already-captured restoration.
        }
      }

      const result = restoreClipboardSnapshot(manager, snapshot, webContents);
      manager.safeLog(result.success ? "🔄 Clipboard restored" : "⚠️ Clipboard restore failed", {
        delayMs,
        restoredFormats: snapshot?.formats?.length || 0,
        reason: result.reason || null,
      });
      resolve(result);
    }, delayMs);
  });
}

module.exports = {
  isClipboardSnapshotRestorable,
  isPrimaryClipboardFormat,
  restoreClipboardSnapshot,
  scheduleClipboardRestore,
  snapshotClipboard,
};
