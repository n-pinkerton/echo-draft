import { formatHotkeyLabelForPlatform } from "../hotkeys";
import {
  LINUX_EXAMPLES,
  LINUX_RECOMMENDED,
  LINUX_RESERVED_SHORTCUTS,
  MAC_EXAMPLES,
  MAC_RECOMMENDED,
  MAC_RESERVED_SHORTCUTS,
  SPECIAL_KEYS,
  WINDOWS_EXAMPLES,
  WINDOWS_RECOMMENDED,
  WINDOWS_RESERVED_SHORTCUTS,
} from "./constants";
import { isLeftRightMix } from "./leftRightMix";
import { isRightSideModifier, normalizeHotkey, normalizeKeyToken, normalizeModifier } from "./normalization";
import type { Platform, ValidationResult } from "./types";

export function getReservedShortcuts(platform: Platform): readonly string[] {
  switch (platform) {
    case "darwin":
      return MAC_RESERVED_SHORTCUTS;
    case "win32":
      return WINDOWS_RESERVED_SHORTCUTS;
    case "linux":
      return LINUX_RESERVED_SHORTCUTS;
    default:
      return [];
  }
}

export function getRecommendedPatterns(platform: Platform): readonly string[] {
  switch (platform) {
    case "darwin":
      return MAC_RECOMMENDED;
    case "win32":
      return WINDOWS_RECOMMENDED;
    case "linux":
      return LINUX_RECOMMENDED;
    default:
      return [];
  }
}

export function getValidExamples(platform: Platform): readonly string[] {
  switch (platform) {
    case "darwin":
      return MAC_EXAMPLES;
    case "win32":
      return WINDOWS_EXAMPLES;
    case "linux":
      return LINUX_EXAMPLES;
    default:
      return [];
  }
}

export function getValidationMessage(
  hotkey: string,
  platform: Platform,
  existingHotkeys: string[] = []
): string | null {
  const result = validateHotkey(hotkey, platform, existingHotkeys);
  if (result.valid) return null;

  if (result.errorCode === "RESERVED") {
    const label = formatHotkeyLabelForPlatform(hotkey, platform);
    return `${label} is reserved by the system`;
  }

  return result.error || "That shortcut is not supported";
}

export function validateHotkey(
  hotkey: string,
  platform: Platform,
  existingHotkeys: string[] = []
): ValidationResult {
  if (!hotkey || hotkey.trim() === "") {
    return { valid: false, error: "Please enter a valid shortcut." };
  }

  if (hotkey === "GLOBE" || hotkey === "Fn") {
    if (platform !== "darwin") {
      return {
        valid: false,
        error: "The Globe/Fn key is only available on macOS.",
        errorCode: "INVALID_GLOBE",
      };
    }
    return { valid: true };
  }

  const parts = hotkey
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > 3) {
    return {
      valid: false,
      error: "Shortcuts are limited to three keys.",
      errorCode: "TOO_MANY_KEYS",
    };
  }

  if (isLeftRightMix(parts)) {
    return {
      valid: false,
      error: "Do not mix left and right versions of the same modifier in one shortcut.",
      errorCode: "LEFT_RIGHT_MIX",
    };
  }

  let hasModifier = false;
  let hasSpecialKey = false;

  for (const part of parts) {
    const normalizedModifier = normalizeModifier(part, platform);
    if (normalizedModifier) {
      hasModifier = true;
      continue;
    }

    const normalizedKey = normalizeKeyToken(part);
    if (SPECIAL_KEYS.has(normalizedKey)) {
      hasSpecialKey = true;
    }
  }

  if (!hasModifier && !hasSpecialKey) {
    return {
      valid: false,
      error:
        "Shortcuts must include a modifier or a non-alphanumeric key (like arrows, space, or function keys).",
      errorCode: "NO_MODIFIER_OR_SPECIAL",
    };
  }

  // Check for modifier-only hotkeys: require right-side for single modifier, or 2+ modifiers
  const modifierCount = parts.filter((part) => normalizeModifier(part, platform) !== null).length;
  const hasBaseKey = parts.length > modifierCount;

  if (!hasBaseKey && modifierCount === 1) {
    const singleMod = parts[0];
    if (!isRightSideModifier(singleMod)) {
      return {
        valid: false,
        error:
          "Single modifier hotkeys must use the right-side key (e.g., RightOption). Or use two modifiers (e.g., Control+Alt).",
        errorCode: "LEFT_MODIFIER_ONLY",
      };
    }
    // Right-side single modifiers require native listeners (not available on Linux)
    if (platform === "linux") {
      return {
        valid: false,
        error:
          "Right-side single modifier hotkeys are not supported on Linux. Use two modifiers (e.g., Control+Alt) instead.",
        errorCode: "LEFT_MODIFIER_ONLY",
      };
    }
  }

  const normalizedHotkey = normalizeHotkey(hotkey, platform);
  const normalizedExisting = existingHotkeys.map((existing) => normalizeHotkey(existing, platform));

  if (normalizedExisting.includes(normalizedHotkey)) {
    return {
      valid: false,
      error: "That shortcut is already in use.",
      errorCode: "DUPLICATE",
    };
  }

  const reserved = getReservedShortcuts(platform);
  const normalizedReserved = reserved.map((entry) => normalizeHotkey(entry, platform));

  if (normalizedReserved.includes(normalizedHotkey)) {
    return {
      valid: false,
      error: "That shortcut is reserved by your system.",
      errorCode: "RESERVED",
    };
  }

  return { valid: true };
}
