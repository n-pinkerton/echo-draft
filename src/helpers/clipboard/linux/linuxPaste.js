const { PASTE_DELAYS, RESTORE_DELAYS } = require("../constants");
const { getLinuxSessionInfo } = require("../linuxSession");

async function pasteLinux(manager, originalClipboardSnapshot, options = {}) {
  const env = manager.deps.env || process.env;
  const { isWayland, xwaylandAvailable, isGnome } = getLinuxSessionInfo(env);
  const webContents = options.webContents;
  const xdotoolExists = manager.commandExists("xdotool");
  const wtypeExists = manager.commandExists("wtype");
  const ydotoolExists = manager.commandExists("ydotool");

  const { debugLogger, spawn, spawnSync, killProcess, clipboard } = manager.deps;

  debugLogger.debug(
    "Linux paste environment",
    {
      isWayland,
      xwaylandAvailable,
      isGnome,
      xdotoolExists,
      wtypeExists,
      ydotoolExists,
      display: env.DISPLAY,
      waylandDisplay: env.WAYLAND_DISPLAY,
      xdgSessionType: env.XDG_SESSION_TYPE,
      xdgCurrentDesktop: env.XDG_CURRENT_DESKTOP,
    },
    "clipboard"
  );

  // Capture target window before our window takes focus
  const getXdotoolActiveWindow = () => {
    if (!xdotoolExists || (isWayland && !xwaylandAvailable)) {
      return null;
    }
    try {
      const result = spawnSync("xdotool", ["getactivewindow"]);
      if (result.status !== 0) {
        return null;
      }
      return result.stdout.toString().trim() || null;
    } catch {
      return null;
    }
  };

  const getXdotoolWindowClass = (windowId) => {
    if (!xdotoolExists || (isWayland && !xwaylandAvailable)) {
      return null;
    }
    try {
      const args = windowId ? ["getwindowclassname", windowId] : ["getactivewindow", "getwindowclassname"];
      const result = spawnSync("xdotool", args);
      if (result.status !== 0) {
        return null;
      }
      const className = result.stdout.toString().toLowerCase().trim();
      return className || null;
    } catch {
      return null;
    }
  };

  const targetWindowId = getXdotoolActiveWindow();
  const xdotoolWindowClass = getXdotoolWindowClass(targetWindowId);

  // Terminals use Ctrl+Shift+V instead of Ctrl+V
  const isTerminal = () => {
    const terminalClasses = [
      "konsole",
      "gnome-terminal",
      "terminal",
      "kitty",
      "alacritty",
      "terminator",
      "xterm",
      "urxvt",
      "rxvt",
      "tilix",
      "terminology",
      "wezterm",
      "foot",
      "st",
      "yakuake",
    ];

    if (xdotoolWindowClass) {
      const isTerminalWindow = terminalClasses.some((term) => xdotoolWindowClass.includes(term));
      if (isTerminalWindow) {
        manager.safeLog(`🖥️ Terminal detected via xdotool: ${xdotoolWindowClass}`);
      }
      return isTerminalWindow;
    }

    try {
      if (manager.commandExists("kdotool")) {
        const windowIdResult = spawnSync("kdotool", ["getactivewindow"]);
        if (windowIdResult.status === 0) {
          const windowId = windowIdResult.stdout.toString().trim();
          const classResult = spawnSync("kdotool", ["getwindowclassname", windowId]);
          if (classResult.status === 0) {
            const className = classResult.stdout.toString().toLowerCase().trim();
            const isTerminalWindow = terminalClasses.some((term) => className.includes(term));
            if (isTerminalWindow) {
              manager.safeLog(`🖥️ Terminal detected via kdotool: ${className}`);
            }
            return isTerminalWindow;
          }
        }
      }
    } catch {
      // Detection failed, assume non-terminal
    }
    return false;
  };

  const inTerminal = isTerminal();
  const pasteKeys = inTerminal ? "ctrl+shift+v" : "ctrl+v";

  const canUseWtype = isWayland && !isGnome;
  const canUseYdotool = isWayland;
  const canUseXdotool = isWayland ? xwaylandAvailable && xdotoolExists : xdotoolExists;

  // windowactivate ensures the target window (not ours) receives the keystroke
  const xdotoolArgs = targetWindowId
    ? ["windowactivate", "--sync", targetWindowId, "key", pasteKeys]
    : ["key", pasteKeys];

  if (targetWindowId) {
    manager.safeLog(`🎯 Targeting window ID ${targetWindowId} for paste (class: ${xdotoolWindowClass})`);
  }

  // ydotool key codes: 29=Ctrl, 42=Shift, 47=V; :1=press, :0=release
  const ydotoolArgs = inTerminal
    ? ["key", "29:1", "42:1", "47:1", "47:0", "42:0", "29:0"]
    : ["key", "29:1", "47:1", "47:0", "29:0"];

  const candidates = [
    ...(canUseWtype
      ? [
          inTerminal
            ? {
                cmd: "wtype",
                args: ["-M", "ctrl", "-M", "shift", "-k", "v", "-m", "shift", "-m", "ctrl"],
              }
            : { cmd: "wtype", args: ["-M", "ctrl", "-k", "v", "-m", "ctrl"] },
        ]
      : []),
    ...(canUseXdotool ? [{ cmd: "xdotool", args: xdotoolArgs }] : []),
    ...(canUseYdotool ? [{ cmd: "ydotool", args: ydotoolArgs }] : []),
  ];

  const available = candidates.filter((c) => manager.commandExists(c.cmd));

  debugLogger.debug(
    "Available paste tools",
    {
      candidateTools: candidates.map((c) => c.cmd),
      availableTools: available.map((c) => c.cmd),
      targetWindowId,
      xdotoolWindowClass,
      inTerminal,
      pasteKeys,
    },
    "clipboard"
  );

  const pasteWith = (tool) =>
    new Promise((resolve, reject) => {
      const delay = isWayland ? 0 : PASTE_DELAYS.linux;

      setTimeout(() => {
        debugLogger.debug(
          "Attempting paste",
          {
            cmd: tool.cmd,
            args: tool.args,
            delay,
            isWayland,
          },
          "clipboard"
        );

        const proc = spawn(tool.cmd, tool.args);
        let stderr = "";
        let stdout = "";

        proc.stderr?.on("data", (data) => {
          stderr += data.toString();
        });

        proc.stdout?.on("data", (data) => {
          stdout += data.toString();
        });

        let timedOut = false;
        const timeoutId = setTimeout(() => {
          timedOut = true;
          killProcess(proc, "SIGKILL");
          debugLogger.warn(
            "Paste tool timed out",
            {
              cmd: tool.cmd,
              timeoutMs: 2000,
            },
            "clipboard"
          );
        }, 2000);

        proc.on("close", (code) => {
          if (timedOut) return reject(new Error(`Paste with ${tool.cmd} timed out`));
          clearTimeout(timeoutId);

          if (code === 0) {
            debugLogger.debug("Paste successful", { cmd: tool.cmd }, "clipboard");
            manager.scheduleClipboardRestore(originalClipboardSnapshot, RESTORE_DELAYS.linux, webContents);
            resolve();
          } else {
            debugLogger.error(
              "Paste command failed",
              {
                cmd: tool.cmd,
                args: tool.args,
                exitCode: code,
                stderr: stderr.trim(),
                stdout: stdout.trim(),
              },
              "clipboard"
            );
            reject(
              new Error(`${tool.cmd} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`)
            );
          }
        });

        proc.on("error", (error) => {
          if (timedOut) return;
          clearTimeout(timeoutId);
          debugLogger.error(
            "Paste command spawn error",
            {
              cmd: tool.cmd,
              error: error.message,
              code: error.code,
            },
            "clipboard"
          );
          reject(error);
        });
      }, delay);
    });

  const failedAttempts = [];
  for (const tool of available) {
    try {
      await pasteWith(tool);
      manager.safeLog(`✅ Paste successful using ${tool.cmd}`);
      debugLogger.info("Paste successful", { tool: tool.cmd }, "clipboard");
      return; // Success!
    } catch (error) {
      const failureInfo = {
        tool: tool.cmd,
        args: tool.args,
        error: error?.message || String(error),
      };
      failedAttempts.push(failureInfo);
      manager.safeLog(`⚠️ Paste with ${tool.cmd} failed:`, error?.message || error);
      debugLogger.warn("Paste tool failed, trying next", failureInfo, "clipboard");
      // Continue to next tool
    }
  }

  debugLogger.error("All paste tools failed", { failedAttempts }, "clipboard");

  // xdotool type fallback for terminals where Ctrl+Shift+V simulation fails
  if (inTerminal && xdotoolExists && !isWayland) {
    debugLogger.debug(
      "Trying xdotool type fallback for terminal",
      {
        textLength: clipboard.readText().length,
        targetWindowId,
      },
      "clipboard"
    );
    manager.safeLog("🔄 Trying xdotool type fallback for terminal...");
    const textToType = clipboard.readText(); // Read what we put in clipboard
    const typeArgs = targetWindowId
      ? ["windowactivate", "--sync", targetWindowId, "type", "--clearmodifiers", "--", textToType]
      : ["type", "--clearmodifiers", "--", textToType];

    try {
      await pasteWith({ cmd: "xdotool", args: typeArgs });
      manager.safeLog("✅ Paste successful using xdotool type fallback");
      debugLogger.info("Terminal paste successful via xdotool type", {}, "clipboard");
      return;
    } catch (error) {
      const fallbackFailure = {
        tool: "xdotool type",
        args: typeArgs,
        error: error?.message || String(error),
      };
      failedAttempts.push(fallbackFailure);
      manager.safeLog(`⚠️ xdotool type fallback failed:`, error?.message || error);
      debugLogger.warn("xdotool type fallback failed", fallbackFailure, "clipboard");
    }
  }

  const failureSummary =
    failedAttempts.length > 0
      ? `\n\nAttempted tools: ${failedAttempts.map((f) => `${f.tool} (${f.error})`).join(", ")}`
      : "";

  let errorMsg;
  if (isWayland) {
    if (isGnome) {
      if (!xwaylandAvailable) {
        errorMsg =
          "Clipboard copied, but GNOME Wayland blocks automatic pasting. Please paste manually with Ctrl+V.";
      } else if (!xdotoolExists) {
        errorMsg =
          "Clipboard copied, but automatic pasting on GNOME Wayland requires xdotool for XWayland apps. Please install xdotool or paste manually with Ctrl+V.";
      } else if (!xdotoolWindowClass) {
        errorMsg =
          "Clipboard copied, but the active app isn't running under XWayland. Please paste manually with Ctrl+V.";
      } else {
        errorMsg =
          "Clipboard copied, but paste simulation failed via XWayland. Please paste manually with Ctrl+V.";
      }
    } else if (!wtypeExists && !xdotoolExists) {
      if (!xwaylandAvailable) {
        errorMsg =
          "Clipboard copied, but automatic pasting on Wayland requires wtype or xdotool. Please install one or paste manually with Ctrl+V.";
      } else {
        errorMsg =
          "Clipboard copied, but automatic pasting on Wayland requires xdotool (recommended for Electron/XWayland apps) or wtype. Please install one or paste manually with Ctrl+V.";
      }
    } else {
      const xdotoolNote =
        xwaylandAvailable && !xdotoolExists
          ? " Consider installing xdotool, which works well with Electron apps running under XWayland."
          : "";
      errorMsg =
        "Clipboard copied, but paste simulation failed on Wayland. Your compositor may not support the virtual keyboard protocol." +
        xdotoolNote +
        " Alternatively, paste manually with Ctrl+V.";
    }
  } else {
    errorMsg =
      "Clipboard copied, but paste simulation failed on X11. Please install xdotool or paste manually with Ctrl+V.";
  }

  const err = new Error(errorMsg + failureSummary);
  err.code = "PASTE_SIMULATION_FAILED";
  err.failedAttempts = failedAttempts;
  debugLogger.error(
    "Throwing paste simulation failed error",
    {
      errorMsg,
      failedAttempts,
      isWayland,
      isGnome,
    },
    "clipboard"
  );
  throw err;
}

module.exports = {
  pasteLinux,
};

