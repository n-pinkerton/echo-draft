const { screen, BrowserWindow } = require("electron");

const DevServerManager = require("../devServerManager");
const { DEV_SERVER_PORT } = DevServerManager;
const MenuManager = require("../menuManager");
const { MAIN_WINDOW_CONFIG, WINDOW_SIZES, WindowPositionUtil } = require("../windowConfig");

async function createMainWindow(manager) {
  const display = screen.getPrimaryDisplay();
  const position = WindowPositionUtil.getMainWindowPosition(display);

  manager.mainWindow = new BrowserWindow({
    ...MAIN_WINDOW_CONFIG,
    ...position,
  });

  // Main window (dictation overlay) should never appear in dock/taskbar
  // On macOS, users access the app via the menu bar tray icon
  // On Windows/Linux, the control panel stays in the taskbar when minimized
  manager.mainWindow.setSkipTaskbar(true);

  setMainWindowInteractivity(manager, false);
  registerMainWindowEvents(manager);

  // Register load event handlers BEFORE loading to catch all events
  manager.mainWindow.webContents.on(
    "did-fail-load",
    async (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }
      if (
        process.env.NODE_ENV === "development" &&
        validatedURL &&
        validatedURL.includes(`localhost:${DEV_SERVER_PORT}`)
      ) {
        // Retry connection to dev server
        setTimeout(async () => {
          const isReady = await DevServerManager.waitForDevServer();
          if (isReady) {
            manager.mainWindow.reload();
          }
        }, 2000);
      } else {
        manager.showLoadFailureDialog("Dictation panel", errorCode, errorDescription, validatedURL);
      }
    }
  );

  manager.mainWindow.webContents.on("did-finish-load", () => {
    manager.mainWindow.setTitle("Voice Recorder");
    enforceMainWindowOnTop(manager);
  });

  // Now load the window content
  await manager.loadMainWindow();
  await manager.initializeHotkey();
  await manager.initializeClipboardHotkey();
  manager.dragManager.setTargetWindow(manager.mainWindow);
  MenuManager.setupMainMenu();
}

function setMainWindowInteractivity(manager, shouldCapture) {
  if (!manager.mainWindow || manager.mainWindow.isDestroyed()) {
    return;
  }

  if (shouldCapture) {
    manager.mainWindow.setIgnoreMouseEvents(false);
  } else {
    manager.mainWindow.setIgnoreMouseEvents(true, { forward: true });
  }
  manager.isMainWindowInteractive = shouldCapture;
}

function resizeMainWindow(manager, sizeKey) {
  if (!manager.mainWindow || manager.mainWindow.isDestroyed()) {
    return { success: false, message: "Window not available" };
  }

  const newSize = WINDOW_SIZES[sizeKey] || WINDOW_SIZES.BASE;
  const currentBounds = manager.mainWindow.getBounds();

  const bottomRightX = currentBounds.x + currentBounds.width;
  const bottomRightY = currentBounds.y + currentBounds.height;

  const display = screen.getDisplayNearestPoint({ x: bottomRightX, y: bottomRightY });
  const workArea = display.workArea || display.bounds;

  let newX = bottomRightX - newSize.width;
  let newY = bottomRightY - newSize.height;

  newX = Math.max(workArea.x, Math.min(newX, workArea.x + workArea.width - newSize.width));
  newY = Math.max(workArea.y, Math.min(newY, workArea.y + workArea.height - newSize.height));

  manager.mainWindow.setBounds({
    x: newX,
    y: newY,
    width: newSize.width,
    height: newSize.height,
  });

  return { success: true, bounds: { x: newX, y: newY, ...newSize } };
}

function showDictationPanel(manager, options = {}) {
  const { focus = false } = options;
  if (manager.mainWindow && !manager.mainWindow.isDestroyed()) {
    if (!manager.mainWindow.isVisible()) {
      if (typeof manager.mainWindow.showInactive === "function") {
        manager.mainWindow.showInactive();
      } else {
        manager.mainWindow.show();
      }
    }
    if (focus) {
      manager.mainWindow.focus();
    }
  }
}

function hideDictationPanel(manager) {
  if (manager.mainWindow && !manager.mainWindow.isDestroyed()) {
    if (process.platform === "darwin") {
      manager.mainWindow.hide();
    } else {
      manager.mainWindow.minimize();
    }
  }
}

function isDictationPanelVisible(manager) {
  if (!manager.mainWindow || manager.mainWindow.isDestroyed()) {
    return false;
  }

  if (manager.mainWindow.isMinimized && manager.mainWindow.isMinimized()) {
    return false;
  }

  return manager.mainWindow.isVisible();
}

function registerMainWindowEvents(manager) {
  if (!manager.mainWindow) {
    return;
  }

  // Safety timeout: force show the window if ready-to-show doesn't fire within 10 seconds
  const showTimeout = setTimeout(() => {
    if (manager.mainWindow && !manager.mainWindow.isDestroyed() && !manager.mainWindow.isVisible()) {
      if (typeof manager.mainWindow.showInactive === "function") {
        manager.mainWindow.showInactive();
      } else {
        manager.mainWindow.show();
      }
    }
  }, 10000);

  manager.mainWindow.once("ready-to-show", () => {
    clearTimeout(showTimeout);
    enforceMainWindowOnTop(manager);
    if (!manager.mainWindow.isVisible()) {
      if (typeof manager.mainWindow.showInactive === "function") {
        manager.mainWindow.showInactive();
      } else {
        manager.mainWindow.show();
      }
    }
  });

  manager.mainWindow.on("show", () => {
    enforceMainWindowOnTop(manager);
  });

  manager.mainWindow.on("focus", () => {
    enforceMainWindowOnTop(manager);
  });

  manager.mainWindow.on("closed", () => {
    manager.dragManager.cleanup();
    manager.mainWindow = null;
    manager.isMainWindowInteractive = false;
  });
}

function enforceMainWindowOnTop(manager) {
  if (manager.mainWindow && !manager.mainWindow.isDestroyed()) {
    WindowPositionUtil.setupAlwaysOnTop(manager.mainWindow);
  }
}

module.exports = {
  createMainWindow,
  enforceMainWindowOnTop,
  hideDictationPanel,
  isDictationPanelVisible,
  registerMainWindowEvents,
  resizeMainWindow,
  setMainWindowInteractivity,
  showDictationPanel,
};

