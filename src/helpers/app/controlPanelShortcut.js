const debugLogger = require("../debugLogger");
const { CONTROL_PANEL_ACCELERATOR } = require("../../shared/controlPanelShortcut");

function registerControlPanelShortcut(
  { globalShortcut },
  { windowManager, logger = debugLogger, accelerator = CONTROL_PANEL_ACCELERATOR }
) {
  let opening = false;
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

  const registered = Boolean(globalShortcut?.register?.(accelerator, openControlPanel));
  if (registered) {
    logger?.info?.("Control panel shortcut registered", { accelerator });
  } else {
    logger?.warn?.("Control panel shortcut registration failed", { accelerator });
  }

  return {
    accelerator,
    registered,
    dispose() {
      if (registered) globalShortcut?.unregister?.(accelerator);
    },
  };
}

module.exports = { registerControlPanelShortcut };
