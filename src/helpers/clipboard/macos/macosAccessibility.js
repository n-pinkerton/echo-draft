const {
  ACCESSIBILITY_DENIED_TTL_MS,
  ACCESSIBILITY_GRANTED_TTL_MS,
} = require("../constants");

function isStuckAccessibilityPermissionError(testError = "") {
  const raw = String(testError || "");
  return (
    raw.includes("not allowed assistive access") || raw.includes("(-1719)") || raw.includes("(-25006)")
  );
}

async function checkAccessibilityPermissions(manager) {
  if (manager.deps.platform !== "darwin") return true;

  const nowFn = manager.deps.now || Date.now;
  const now = nowFn();
  if (now < manager.accessibilityCache.expiresAt && manager.accessibilityCache.value !== null) {
    return manager.accessibilityCache.value;
  }

  const { spawn } = manager.deps;

  return await new Promise((resolve) => {
    const testProcess = spawn("osascript", [
      "-e",
      'tell application "System Events" to get name of first process',
    ]);

    let testError = "";

    testProcess.stderr.on("data", (data) => {
      testError += data.toString();
    });

    testProcess.on("close", (code) => {
      const allowed = code === 0;
      manager.accessibilityCache = {
        value: allowed,
        expiresAt: nowFn() + (allowed ? ACCESSIBILITY_GRANTED_TTL_MS : ACCESSIBILITY_DENIED_TTL_MS),
      };
      if (!allowed) {
        showAccessibilityDialog(manager, testError);
      }
      resolve(allowed);
    });

    testProcess.on("error", () => {
      manager.accessibilityCache = {
        value: false,
        expiresAt: nowFn() + ACCESSIBILITY_DENIED_TTL_MS,
      };
      resolve(false);
    });
  });
}

function showAccessibilityDialog(manager, testError) {
  const isStuckPermission = isStuckAccessibilityPermissionError(testError);

  let dialogMessage;
  if (isStuckPermission) {
    dialogMessage = `🔒 EchoDraft needs Accessibility permissions, but it looks like you may have OLD PERMISSIONS from a previous version.

❗ COMMON ISSUE: If you've rebuilt/reinstalled EchoDraft, the old permissions may be "stuck" and preventing new ones.

🔧 To fix this:
1. Open System Settings → Privacy & Security → Accessibility
2. Look for ANY old "EchoDraft" entries and REMOVE them (click the - button)
3. Also remove any entries that say "Electron" or have unclear names
4. Click the + button and manually add the NEW EchoDraft app
5. Make sure the checkbox is enabled
6. Restart EchoDraft

⚠️ This is especially common during development when rebuilding the app.

📝 Without this permission, text will only copy to clipboard (no automatic pasting).

Would you like to open System Settings now?`;
  } else {
    dialogMessage = `🔒 EchoDraft needs Accessibility permissions to paste text into other applications.

📋 Current status: Clipboard copy works, but pasting (Cmd+V simulation) fails.

🔧 To fix this:
1. Open System Settings (or System Preferences on older macOS)
2. Go to Privacy & Security → Accessibility
3. Click the lock icon and enter your password
4. Add EchoDraft to the list and check the box
5. Restart EchoDraft

⚠️ Without this permission, dictated text will only be copied to clipboard but won't paste automatically.

💡 In production builds, this permission is required for full functionality.

Would you like to open System Settings now?`;
  }

  const { spawn } = manager.deps;
  const permissionDialog = spawn("osascript", [
    "-e",
    `display dialog "${dialogMessage}" buttons {"Cancel", "Open System Settings"} default button "Open System Settings"`,
  ]);

  permissionDialog.on("close", (dialogCode) => {
    if (dialogCode === 0) {
      openSystemSettings(manager);
    }
  });

  permissionDialog.on("error", () => {});
}

function openSystemSettings(manager) {
  const { spawn } = manager.deps;
  const settingsCommands = [
    ["open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"]],
    ["open", ["-b", "com.apple.systempreferences"]],
    ["open", ["/System/Library/PreferencePanes/Security.prefPane"]],
  ];

  let commandIndex = 0;
  const tryNextCommand = () => {
    if (commandIndex < settingsCommands.length) {
      const [cmd, args] = settingsCommands[commandIndex];
      const settingsProcess = spawn(cmd, args);

      settingsProcess.on("error", () => {
        commandIndex += 1;
        tryNextCommand();
      });

      settingsProcess.on("close", (settingsCode) => {
        if (settingsCode !== 0) {
          commandIndex += 1;
          tryNextCommand();
        }
      });
    } else {
      spawn("open", ["-a", "System Preferences"]).on("error", () => {
        spawn("open", ["-a", "System Settings"]).on("error", () => {});
      });
    }
  };

  tryNextCommand();
}

function preWarmAccessibility(manager) {
  if (manager.deps.platform !== "darwin") return;
  checkAccessibilityPermissions(manager).catch(() => {});
  manager.resolveFastPasteBinary?.();
}

module.exports = {
  checkAccessibilityPermissions,
  isStuckAccessibilityPermissionError,
  openSystemSettings,
  preWarmAccessibility,
  showAccessibilityDialog,
};

