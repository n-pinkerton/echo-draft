const { PASTE_DELAYS, RESTORE_DELAYS } = require("../constants");

async function pasteMacOS(manager, originalClipboardSnapshot, options = {}) {
  const { spawn, killProcess } = manager.deps;

  const fastPasteBinary = manager.resolveFastPasteBinary();
  const useFastPaste = Boolean(fastPasteBinary);
  const pasteDelay = options.fromStreaming ? (useFastPaste ? 15 : 50) : PASTE_DELAYS.darwin;

  return await new Promise((resolve, reject) => {
    setTimeout(() => {
      const pasteProcess = useFastPaste
        ? spawn(fastPasteBinary)
        : spawn("osascript", [
            "-e",
            'tell application "System Events" to keystroke "v" using command down',
          ]);

      let hasTimedOut = false;

      pasteProcess.on("close", (code) => {
        if (hasTimedOut) return;
        clearTimeout(timeoutId);
        pasteProcess.removeAllListeners();

        if (code === 0) {
          manager.safeLog(`Text pasted successfully via ${useFastPaste ? "CGEvent" : "osascript"}`);
          manager.scheduleClipboardRestore(originalClipboardSnapshot, RESTORE_DELAYS.darwin);
          resolve();
        } else if (useFastPaste) {
          manager.safeLog(
            code === 2
              ? "CGEvent binary lacks accessibility trust, falling back to osascript"
              : `CGEvent paste failed (code ${code}), falling back to osascript`
          );
          manager.fastPasteChecked = true;
          manager.fastPastePath = null;
          pasteMacOSWithOsascript(manager, originalClipboardSnapshot).then(resolve).catch(reject);
        } else {
          manager.accessibilityCache = { value: null, expiresAt: 0 };
          const errorMsg = `Paste failed (code ${code}). Text is copied to clipboard - please paste manually with Cmd+V.`;
          reject(new Error(errorMsg));
        }
      });

      pasteProcess.on("error", (error) => {
        if (hasTimedOut) return;
        clearTimeout(timeoutId);
        pasteProcess.removeAllListeners();

        if (useFastPaste) {
          manager.safeLog("CGEvent paste error, falling back to osascript");
          manager.fastPasteChecked = true;
          manager.fastPastePath = null;
          pasteMacOSWithOsascript(manager, originalClipboardSnapshot).then(resolve).catch(reject);
        } else {
          const errorMsg = `Paste command failed: ${error.message}. Text is copied to clipboard - please paste manually with Cmd+V.`;
          reject(new Error(errorMsg));
        }
      });

      const timeoutId = setTimeout(() => {
        hasTimedOut = true;
        killProcess(pasteProcess, "SIGKILL");
        pasteProcess.removeAllListeners();
        reject(
          new Error(
            "Paste operation timed out. Text is copied to clipboard - please paste manually with Cmd+V."
          )
        );
      }, 3000);
    }, pasteDelay);
  });
}

async function pasteMacOSWithOsascript(manager, originalClipboardSnapshot) {
  const { spawn, killProcess } = manager.deps;

  return await new Promise((resolve, reject) => {
    setTimeout(() => {
      const pasteProcess = spawn("osascript", [
        "-e",
        'tell application "System Events" to keystroke "v" using command down',
      ]);

      let hasTimedOut = false;

      pasteProcess.on("close", (code) => {
        if (hasTimedOut) return;
        clearTimeout(timeoutId);

        if (code === 0) {
          manager.safeLog("Text pasted successfully via osascript fallback");
          manager.scheduleClipboardRestore(originalClipboardSnapshot, RESTORE_DELAYS.darwin);
          resolve();
        } else {
          manager.accessibilityCache = { value: null, expiresAt: 0 };
          reject(
            new Error(
              "Paste operation failed. Text is copied to clipboard - please paste manually with Cmd+V."
            )
          );
        }
      });

      pasteProcess.on("error", (error) => {
        if (hasTimedOut) return;
        clearTimeout(timeoutId);
        reject(
          new Error(
            `Paste command failed: ${error.message}. Text is copied to clipboard - please paste manually with Cmd+V.`
          )
        );
      });

      const timeoutId = setTimeout(() => {
        hasTimedOut = true;
        killProcess(pasteProcess, "SIGKILL");
        pasteProcess.removeAllListeners();
        reject(
          new Error(
            "Paste operation timed out. Text is copied to clipboard - please paste manually with Cmd+V."
          )
        );
      }, 3000);
    }, 0);
  });
}

module.exports = {
  pasteMacOS,
  pasteMacOSWithOsascript,
};

