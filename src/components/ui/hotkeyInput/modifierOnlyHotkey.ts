export type HeldModifiers = { ctrl: boolean; meta: boolean; alt: boolean; shift: boolean };
export type ModifierCodes = { ctrl?: string; meta?: string; alt?: string; shift?: string };

export function buildModifierOnlyHotkey(
  modifiers: HeldModifiers,
  codes: ModifierCodes,
  { isMac }: { isMac: boolean }
): string | null {
  // Check for right-side single modifier first
  const rightSidePressed: string[] = [];
  if (codes.ctrl === "ControlRight") rightSidePressed.push("RightControl");
  if (codes.meta === "MetaRight") rightSidePressed.push(isMac ? "RightCommand" : "RightSuper");
  if (codes.alt === "AltRight") rightSidePressed.push(isMac ? "RightOption" : "RightAlt");
  if (codes.shift === "ShiftRight") rightSidePressed.push("RightShift");

  // If exactly one right-side modifier, allow it as single-key hotkey
  if (rightSidePressed.length === 1) {
    const activeCount = [modifiers.ctrl, modifiers.meta, modifiers.alt, modifiers.shift].filter(Boolean).length;
    if (activeCount === 1) {
      return rightSidePressed[0];
    }
  }

  // Otherwise require 2+ modifiers (existing logic)
  const parts: string[] = [];
  if (modifiers.ctrl) parts.push("Control");
  if (modifiers.meta) parts.push(isMac ? "Command" : "Super");
  if (modifiers.alt) parts.push("Alt");
  if (modifiers.shift) parts.push("Shift");

  if (parts.length >= 2) {
    return parts.join("+");
  }
  return null;
}

