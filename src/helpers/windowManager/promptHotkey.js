function derivePromptHotkey(hotkey) {
  const parts = String(hotkey || "")
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part.toUpperCase() === "GLOBE")) {
    return null;
  }

  const normalizedParts = parts.map((part) => part.toLowerCase());
  if (normalizedParts.some((part) => part.includes("alt") || part === "option")) {
    return null;
  }

  const modifierNames = new Set([
    "command",
    "cmd",
    "commandorcontrol",
    "control",
    "ctrl",
    "fn",
    "meta",
    "shift",
    "super",
  ]);
  if (normalizedParts.every((part) => modifierNames.has(part))) {
    return null;
  }

  return ["Alt", ...parts].join("+");
}

module.exports = { derivePromptHotkey };
