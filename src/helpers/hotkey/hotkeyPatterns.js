// Right-side single modifiers are handled by native listeners, not globalShortcut
const RIGHT_SIDE_MODIFIER_PATTERN =
  /^Right(Control|Ctrl|Alt|Option|Shift|Command|Cmd|Super|Meta|Win)$/i;

function isRightSideModifier(hotkey) {
  return RIGHT_SIDE_MODIFIER_PATTERN.test(hotkey);
}

// Modifier-only combos (e.g. "Control+Super") bypass globalShortcut on Windows
// and use the native low-level keyboard hook instead.
const MODIFIER_NAMES = new Set([
  "control",
  "ctrl",
  "alt",
  "option",
  "shift",
  "super",
  "meta",
  "win",
  "command",
  "cmd",
  "commandorcontrol",
  "cmdorctrl",
]);

function isModifierOnlyHotkey(hotkey) {
  if (!hotkey || !hotkey.includes("+")) return false;
  return hotkey.split("+").every((part) => MODIFIER_NAMES.has(part.toLowerCase()));
}

module.exports = {
  isModifierOnlyHotkey,
  isRightSideModifier,
};

