import { describe, expect, it } from "vitest";

import { buildModifierOnlyHotkey } from "./modifierOnlyHotkey";

describe("buildModifierOnlyHotkey", () => {
  it("supports right-side single modifiers", () => {
    const win = buildModifierOnlyHotkey(
      { ctrl: false, meta: false, alt: true, shift: false },
      { alt: "AltRight" },
      { isMac: false }
    );
    expect(win).toBe("RightAlt");

    const mac = buildModifierOnlyHotkey(
      { ctrl: false, meta: false, alt: true, shift: false },
      { alt: "AltRight" },
      { isMac: true }
    );
    expect(mac).toBe("RightOption");
  });

  it("requires at least two modifiers when not using a right-side single modifier", () => {
    const oneMod = buildModifierOnlyHotkey(
      { ctrl: true, meta: false, alt: false, shift: false },
      { ctrl: "ControlLeft" },
      { isMac: false }
    );
    expect(oneMod).toBe(null);

    const twoMods = buildModifierOnlyHotkey(
      { ctrl: true, meta: false, alt: true, shift: false },
      { ctrl: "ControlLeft", alt: "AltLeft" },
      { isMac: false }
    );
    expect(twoMods).toBe("Control+Alt");
  });
});

