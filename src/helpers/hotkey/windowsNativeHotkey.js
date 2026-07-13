const MODIFIER_TOKENS = new Set([
  "alt",
  "cmd",
  "cmdorctrl",
  "command",
  "commandorcontrol",
  "control",
  "ctrl",
  "fn",
  "meta",
  "option",
  "shift",
  "super",
  "win",
]);

const NATIVE_MAIN_KEYS = new Set([
  "pause",
  "scrolllock",
  "insert",
  "home",
  "end",
  "pageup",
  "pagedown",
  "space",
  "escape",
  "esc",
  "tab",
  "capslock",
  "numlock",
  "rightalt",
  "rightoption",
  "rightcontrol",
  "rightctrl",
  "rightshift",
  "rightsuper",
  "rightwin",
  "rightmeta",
  "rightcommand",
  "rightcmd",
  "backquote",
  "minus",
  "equal",
]);

const NATIVE_PUNCTUATION_KEYS = new Set(["`", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/"]);

function isNativeMainKey(token) {
  const normalized = String(token || "")
    .trim()
    .toLowerCase();
  return (
    NATIVE_MAIN_KEYS.has(normalized) ||
    NATIVE_PUNCTUATION_KEYS.has(normalized) ||
    /^f(?:[1-9]|1\d|2[0-4])$/i.test(normalized) ||
    /^[a-z0-9]$/i.test(normalized)
  );
}

function isWindowsNativeHotkeySupported(hotkey) {
  const value = String(hotkey || "").trim();
  if (!value || value === "GLOBE") return false;

  const tokens = value
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return false;

  const mainKeys = tokens.filter((token) => !MODIFIER_TOKENS.has(token.toLowerCase()));
  if (mainKeys.length > 1) return false;
  if (mainKeys.length === 1) return isNativeMainKey(mainKeys[0]);

  // Fn alone is not observable by the native listener. Other modifier-only combinations are.
  return tokens.some((token) => token.toLowerCase() !== "fn");
}

module.exports = {
  isNativeMainKey,
  isWindowsNativeHotkeySupported,
};
