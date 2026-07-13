const { app, BrowserWindow, shell, dialog } = require("electron");

const MenuManager = require("../menuManager");
const { CONTROL_PANEL_CONFIG } = require("../windowConfig");
const { shouldSuppressWindowPresentation } = require("./e2eWindowPresentation");
const { loadWindowContent } = require("./windowContentLoader");
const {
  moveWindowToCurrentVirtualDesktop,
  shouldRecreateExistingWindow,
} = require("./windowsVirtualDesktop");
const { isTrustedAppNavigation } = require("../ipc/trustedRenderer");
const { normalizeExternalHttpsUrl } = require("../externalUrl");

function openExternalUrl(url, { showError = true } = {}) {
  let safeUrl;
  try {
    safeUrl = normalizeExternalHttpsUrl(url);
  } catch {
    return false;
  }
  shell.openExternal(safeUrl).catch(() => {
    if (showError) {
      dialog.showErrorBox(
        "Unable to Open Link",
        "EchoDraft could not open that HTTPS link in your default browser."
      );
    }
  });
  return true;
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
  const suppressPresentation = shouldSuppressWindowPresentation();
  if (manager.controlPanelWindow && !manager.controlPanelWindow.isDestroyed()) {
    if (suppressPresentation) {
      return;
    }
    const existingWindow = manager.controlPanelWindow;
    const moveResult = await moveWindowToCurrentVirtualDesktop(existingWindow);
    // Recreate an existing Windows window whenever COM cannot prove it belongs
    // to the active desktop. New windows are created on the active desktop, so
    // the degraded path cannot recurse indefinitely.
    if (shouldRecreateExistingWindow(moveResult)) {
      existingWindow.destroy();
      if (manager.controlPanelWindow === existingWindow) {
        manager.controlPanelWindow = null;
      }
      return createControlPanelWindow(manager);
    }
    if (typeof app.focus === "function") {
      app.focus({ steal: true });
    }
    if (process.platform === "darwin" && app.dock) {
      app.dock.show();
    }
    if (manager.controlPanelWindow.isMinimized()) {
      manager.controlPanelWindow.restore();
    }
    manager.controlPanelWindow.show();
    manager.controlPanelWindow.moveTop();
    manager.controlPanelWindow.focus();
    if (
      moveResult.success &&
      manager.controlPanelWindow &&
      !manager.controlPanelWindow.isDestroyed()
    ) {
      manager.controlPanelWindow.show();
      manager.controlPanelWindow.moveTop();
      manager.controlPanelWindow.focus();
    }
    return;
  }

  manager.controlPanelWindow = new BrowserWindow(CONTROL_PANEL_CONFIG);
  const createdWindow = manager.controlPanelWindow;
  const pinPromise = suppressPresentation
    ? Promise.resolve({ success: true, skipped: true })
    : moveWindowToCurrentVirtualDesktop(createdWindow);
  let recreationPromise = null;
  const ensureActiveDesktop = async () => {
    const moveResult = await pinPromise;
    if (!moveResult.needsRecreate) return { moveResult, recreated: false };
    if (!recreationPromise) {
      recreationPromise = (async () => {
        if (!createdWindow.isDestroyed()) createdWindow.destroy();
        if (manager.controlPanelWindow === createdWindow) manager.controlPanelWindow = null;
        await createControlPanelWindow(manager);
      })();
    }
    await recreationPromise;
    return { moveResult, recreated: true };
  };

  manager.controlPanelWindow.webContents.on("will-navigate", (event, url) => {
    if (isTrustedAppNavigation(manager.controlPanelWindow, url)) return;

    event.preventDefault();
    openExternalUrl(url);
  });

  manager.controlPanelWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });

  const visibilityTimer = suppressPresentation
    ? null
    : setTimeout(() => {
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

  manager.controlPanelWindow.once("ready-to-show", async () => {
    clearVisibilityTimer();
    if (suppressPresentation) {
      return;
    }
    const desktopState = await ensureActiveDesktop();
    if (desktopState.recreated || createdWindow.isDestroyed()) return;
    // Show dock icon on macOS when control panel opens
    if (process.platform === "darwin" && app.dock) {
      app.dock.show();
    }
    createdWindow.show();
    createdWindow.moveTop();
    createdWindow.focus();
    if (desktopState.moveResult.success && !createdWindow.isDestroyed()) {
      createdWindow.show();
      createdWindow.moveTop();
      createdWindow.focus();
    }
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
    if (manager.controlPanelWindow === createdWindow) {
      manager.controlPanelWindow = null;
    }
  });

  // Set up menu for control panel to ensure text input works
  MenuManager.setupControlPanelMenu(manager.controlPanelWindow);

  manager.controlPanelWindow.webContents.on("did-finish-load", () => {
    clearVisibilityTimer();
    manager.controlPanelWindow.setTitle("EchoDraft");
  });

  manager.controlPanelWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }
      clearVisibilityTimer();
      if (!suppressPresentation && process.env.NODE_ENV !== "development") {
        manager.showLoadFailureDialog("Control panel", errorCode, errorDescription, validatedURL);
      }
      if (!suppressPresentation && !manager.controlPanelWindow.isVisible()) {
        manager.controlPanelWindow.show();
        manager.controlPanelWindow.focus();
      }
    }
  );

  await loadControlPanel(manager);
  await ensureActiveDesktop();
}

module.exports = {
  createControlPanelWindow,
  hideControlPanelToTray,
  loadControlPanel,
  openExternalUrl,
};
