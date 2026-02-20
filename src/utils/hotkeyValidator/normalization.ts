import { MODIFIER_ORDER, RIGHT_SIDE_MODIFIERS } from "./constants";
import type { Platform } from "./types";

export function isRightSideModifier(part: string): boolean {
  const normalized = part.replace(/[-_ ]/g, "").toLowerCase();
  return RIGHT_SIDE_MODIFIERS.has(normalized);
}

export function normalizeModifier(part: string, platform: Platform): string | null {
  const trimmed = part.replace(/\s+/g, "");
  const lowered = trimmed.toLowerCase();

  if (lowered === "commandorcontrol" || lowered === "cmdorctrl") {
    return platform === "darwin" ? "Command" : "Control";
  }

  if (lowered === "command" || lowered === "cmd") {
    return "Command";
  }

  if (lowered === "control" || lowered === "ctrl") {
    return "Control";
  }

  if (lowered === "alt" || lowered === "option") {
    return "Alt";
  }

  if (lowered === "shift") {
    return "Shift";
  }

  if (lowered === "super" || lowered === "win" || lowered === "meta") {
    return platform === "darwin" ? "Command" : "Super";
  }

  if (lowered === "fn") {
    return "Fn";
  }

  // Handle right-side modifiers (e.g., RightControl, RightOption)
  // These are valid modifiers but we preserve their "Right" prefix for single-modifier validation
  if (isRightSideModifier(part)) {
    if (lowered.includes("control") || lowered.includes("ctrl")) return "RightControl";
    if (lowered.includes("alt") || lowered.includes("option"))
      return platform === "darwin" ? "RightOption" : "RightAlt";
    if (lowered.includes("shift")) return "RightShift";
    if (lowered.includes("command") || lowered.includes("cmd")) return "RightCommand";
    if (lowered.includes("super") || lowered.includes("meta") || lowered.includes("win")) {
      return platform === "darwin" ? "RightCommand" : "RightSuper";
    }
  }

  return null;
}

export function normalizeKeyToken(part: string): string {
  const trimmed = part.replace(/\s+/g, "");
  const lowered = trimmed.toLowerCase();

  if (lowered === "arrowleft") return "Left";
  if (lowered === "arrowright") return "Right";
  if (lowered === "arrowup") return "Up";
  if (lowered === "arrowdown") return "Down";
  if (lowered === "escape" || lowered === "esc") return "Esc";
  if (lowered === "printscreen" || lowered === "print") return "PrintScreen";
  if (lowered === "pageup" || lowered === "pgup") return "PageUp";
  if (lowered === "pagedown" || lowered === "pgdown") return "PageDown";
  if (lowered === "scrolllock") return "ScrollLock";
  if (lowered === "numlock") return "NumLock";
  if (lowered === "delete" || lowered === "del") return "Delete";
  if (lowered === "insert" || lowered === "ins") return "Insert";
  if (lowered === "space") return "Space";
  if (lowered === "tab") return "Tab";
  if (lowered === "home") return "Home";
  if (lowered === "end") return "End";
  if (lowered === "backspace") return "Backspace";
  if (lowered === "globe") return "GLOBE";
  if (lowered === "fn") return "Fn";

  const functionMatch = lowered.match(/^f(\d{1,2})$/);
  if (functionMatch) {
    return `F${functionMatch[1]}`;
  }

  if (trimmed.length === 1) {
    return trimmed.toUpperCase();
  }

  return trimmed;
}

export function normalizeHotkey(hotkey: string, platform: Platform): string {
  if (!hotkey) return "";

  const parts = hotkey
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  const modifiers: string[] = [];
  const keys: string[] = [];

  for (const part of parts) {
    const normalizedModifier = normalizeModifier(part, platform);
    if (normalizedModifier) {
      modifiers.push(normalizedModifier);
      continue;
    }

    keys.push(normalizeKeyToken(part));
  }

  modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a as any) - MODIFIER_ORDER.indexOf(b as any));

  return [...modifiers, ...keys].join("+");
}
