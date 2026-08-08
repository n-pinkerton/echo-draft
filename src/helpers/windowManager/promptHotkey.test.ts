import { describe, expect, it } from "vitest";

import promptHotkey from "./promptHotkey.js";

const { derivePromptHotkey } = promptHotkey as {
  derivePromptHotkey: (hotkey: string) => string | null;
};

describe("derivePromptHotkey", () => {
  it("adds Alt to an ordinary dictation shortcut", () => {
    expect(derivePromptHotkey("F10")).toBe("Alt+F10");
    expect(derivePromptHotkey("Control+Space")).toBe("Alt+Control+Space");
  });

  it("does not derive an ambiguous Alt, Globe, or modifier-only shortcut", () => {
    expect(derivePromptHotkey("Alt+F10")).toBeNull();
    expect(derivePromptHotkey("GLOBE")).toBeNull();
    expect(derivePromptHotkey("Control+Shift")).toBeNull();
  });

});
