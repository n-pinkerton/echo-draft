const { app, BrowserWindow, shell, dialog } = require("electron");

const MenuManager = require("../menuManager");
const DevServerManager = require("../devServerManager");
const { CONTROL_PANEL_CONFIG } = require("../windowConfig");
const { loadWindowContent } = require("./windowContentLoader");

function openExternalUrl(url, { showError = true } = {}) {
  shell.openExternal(url).catch((error) => {
    if (showError) {
      dialog.showErrorBox(
        "Unable to Open Link",
        `Failed to open the link in your browser:\n${url}\n\nError: ${error.message}`
      );
    }
  });
}

function hideControlPanelToTray(manager) {
  if (!manager?.controlPanelWindow || manager.controlPanelWindow.isDestroyed()) {
    return;
  }

  manager.controlPanelWindow.hide();

  // Hide dock icon on macOS when control panel is hidden
  if (process.platform === "darwin" && app.dock) {
    app.dock.hide();
  }
}

async function loadControlPanel(manager) {
  await loadWindowContent({ window: manager.controlPanelWindow, isControlPanel: true });
}

async function createControlPanelWindow(manager) {
  if (manager.controlPanelWindow && !manager.controlPanelWindow.isDestroyed()) {
    if (manager.controlPanelWindow.isMinimized()) {
      manager.controlPanelWindow.restore();
    }
    if (!manager.controlPanelWindow.isVisible()) {
      manager.controlPanelWindow.show();
    }
    manager.controlPanelWindow.focus();
    return;
  }

  manager.controlPanelWindow = new BrowserWindow(CONTROL_PANEL_CONFIG);

  manager.controlPanelWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file://") || url.startsWith("devtools://") || url.startsWith("about:"))
      return;

    const appUrl = DevServerManager.getAppUrl(true);
    if (appUrl) {
      try {
        const allowedOrigin = new URL(appUrl).origin;
        const targetOrigin = new URL(url).origin;
        if (targetOrigin === allowedOrigin) return;
      } catch {
        // If URL parsing fails, treat it as external.
      }
    }

    event.preventDefault();
    openExternalUrl(url);
  });

  manager.controlPanelWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });

  manager.controlPanelWindow.webContents.on("did-create-window", (childWindow, details) => {
    childWindow.close();
    if (details.url && !details.url.startsWith("devtools://")) {
      openExternalUrl(details.url, { showError: false });
    }
  });

  const visibilityTimer = setTimeout(() => {
    if (!manager.controlPanelWindow || manager.controlPanelWindow.isDestroyed()) {
      return;
    }
    if (!manager.controlPanelWindow.isVisible()) {
      manager.controlPanelWindow.show();
      manager.controlPanelWindow.focus();
    }
  }, 10000);

  const clearVisibilityTimer = () => {
    clearTimeout(visibilityTimer);
  };

  manager.controlPanelWindow.once("ready-to-show", () => {
    clearVisibilityTimer();
    // Show dock icon on macOS when control panel opens
    if (process.platform === "darwin" && app.dock) {
      app.dock.show();
    }
    manager.controlPanelWindow.show();
    manager.controlPanelWindow.focus();
  });

  manager.controlPanelWindow.on("close", (event) => {
    if (!manager.isQuitting) {
      event.preventDefault();
      if (process.platform === "darwin") {
        hideControlPanelToTray(manager);
      } else {
        manager.controlPanelWindow.minimize();
      }
    }
  });

  manager.controlPanelWindow.on("closed", () => {
    clearVisibilityTimer();
    manager.controlPanelWindow = null;
  });

  // Set up menu for control panel to ensure text input works
  MenuManager.setupControlPanelMenu(manager.controlPanelWindow);

  manager.controlPanelWindow.webContents.on("did-finish-load", () => {
    clearVisibilityTimer();
    manager.controlPanelWindow.setTitle("Control Panel");
  });

  manager.controlPanelWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }
      clearVisibilityTimer();
      if (process.env.NODE_ENV !== "development") {
        manager.showLoadFailureDialog("Control panel", errorCode, errorDescription, validatedURL);
      }
      if (!manager.controlPanelWindow.isVisible()) {
        manager.controlPanelWindow.show();
        manager.controlPanelWindow.focus();
      }
    }
  );

  await loadControlPanel(manager);
}

module.exports = {
  createControlPanelWindow,
  hideControlPanelToTray,
  loadControlPanel,
  openExternalUrl,
};

