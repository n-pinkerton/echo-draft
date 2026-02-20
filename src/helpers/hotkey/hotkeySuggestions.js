// Suggested alternative hotkeys when registration fails
const SUGGESTED_HOTKEYS = {
  single: ["F8", "F9", "F10", "Pause", "ScrollLock"],
  compound: ["Control+Super", "Control+Alt", "Control+Shift+Space", "Alt+F7"],
};

function getSuggestions(failedHotkey, platform = process.platform) {
  const isCompound = String(failedHotkey || "").includes("+");
  let suggestions = isCompound ? [...SUGGESTED_HOTKEYS.compound] : [...SUGGESTED_HOTKEYS.single];

  if (platform === "darwin" && isCompound) {
    suggestions = ["Control+Alt", "Alt+Command", "Command+Shift+Space"];
  } else if (platform === "win32" && isCompound) {
    suggestions = ["Control+Super", "Control+Alt", "Control+Shift+K"];
  } else if (platform === "linux" && isCompound) {
    suggestions = ["Control+Super", "Control+Shift+K", "Super+Shift+R"];
  }

  return suggestions.filter((s) => s !== failedHotkey).slice(0, 3);
}

module.exports = {
  getSuggestions,
};

