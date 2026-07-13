const { accelerator: CONTROL_PANEL_ACCELERATOR } = require("../../shared/controlPanelShortcut.json");

const normalizeAccelerator = (value) =>
  String(value || "")
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("+");

const NORMALIZED_CONTROL_PANEL_ACCELERATOR = normalizeAccelerator(CONTROL_PANEL_ACCELERATOR);

function isControlPanelShortcut(value) {
  return normalizeAccelerator(value) === NORMALIZED_CONTROL_PANEL_ACCELERATOR;
}

function getControlPanelShortcutConflict() {
  return {
    success: false,
    error: `"${CONTROL_PANEL_ACCELERATOR}" is reserved for opening the EchoDraft control panel.`,
    message: `"${CONTROL_PANEL_ACCELERATOR}" is reserved for opening the EchoDraft control panel.`,
    reason: "reserved-by-echodraft",
    suggestions: ["F8", "F9", "Control+Shift+Space"],
  };
}

module.exports = {
  CONTROL_PANEL_ACCELERATOR,
  getControlPanelShortcutConflict,
  isControlPanelShortcut,
  normalizeAccelerator,
};
