function snapshotClipboard(manager) {
  const { clipboard } = manager.deps;
  const snapshot = {
    text: "",
    html: "",
    rtf: "",
    imagePng: null,
    formats: [],
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

  try {
    const formats = clipboard.availableFormats();
    for (const format of formats) {
      try {
        const buffer = clipboard.readBuffer(format);
        if (Buffer.isBuffer(buffer)) {
          snapshot.formats.push({ format, buffer: Buffer.from(buffer) });
        }
      } catch {
        // Ignore unreadable formats and preserve what we can.
      }
    }
  } catch {
    // Ignore format enumeration failures and fall back to plain text.
  }

  return snapshot;
}

function restoreClipboardSnapshot(manager, snapshot, webContents = null) {
  if (!snapshot) {
    return;
  }

  const { clipboard, nativeImage, platform } = manager.deps;

  if (Buffer.isBuffer(snapshot.imagePng) && snapshot.imagePng.length > 0) {
    try {
      clipboard.clear();
      clipboard.writeImage(nativeImage.createFromBuffer(snapshot.imagePng));
      return;
    } catch (error) {
      manager.safeLog("⚠️ Failed to restore clipboard image", {
        error: error?.message,
      });
    }
  }

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

  const formatEntries = Array.isArray(snapshot.formats) ? snapshot.formats : [];
  let restoredSomething = false;

  if (Object.keys(data).length > 0) {
    try {
      clipboard.clear();
      clipboard.write(data);
      restoredSomething = true;
    } catch (error) {
      manager.safeLog("⚠️ Failed to restore primary clipboard data", {
        error: error?.message,
      });
    }
  }

  if (formatEntries.length > 0) {
    if (!restoredSomething) {
      try {
        clipboard.clear();
      } catch {
        // ignore
      }
    }

    for (const entry of formatEntries) {
      if (!entry?.format || !Buffer.isBuffer(entry.buffer)) {
        continue;
      }
      try {
        clipboard.writeBuffer(entry.format, entry.buffer);
        restoredSomething = true;
      } catch {
        // Ignore format restore failures and preserve what we can.
      }
    }
  }

  if (!restoredSomething) {
    const textValue = typeof snapshot.text === "string" ? snapshot.text : "";
    if (platform === "linux" && manager._isWayland()) {
      manager._writeClipboardWayland(textValue, webContents);
    } else {
      clipboard.writeText(textValue);
    }
  }
}

function scheduleClipboardRestore(manager, snapshot, delayMs, webContents = null) {
  const setTimeoutFn = manager.deps.setTimeout || setTimeout;
  setTimeoutFn(() => {
    restoreClipboardSnapshot(manager, snapshot, webContents);
    manager.safeLog("🔄 Clipboard restored", {
      delayMs,
      restoredFormats: snapshot?.formats?.length || 0,
    });
  }, delayMs);
}

module.exports = {
  restoreClipboardSnapshot,
  scheduleClipboardRestore,
  snapshotClipboard,
};

