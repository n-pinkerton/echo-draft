import { describe, expect, it, vi } from "vitest";

import { focusSettingsTarget } from "./settingsTarget";

describe("focusSettingsTarget", () => {
  it("scrolls to and focuses the requested settings control", () => {
    const target = document.createElement("section");
    target.id = "microphone-settings";
    target.tabIndex = -1;
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);

    expect(focusSettingsTarget("microphone-settings")).toBe(true);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(document.activeElement).toBe(target);

    target.remove();
  });

  it("does nothing when the requested target is absent", () => {
    expect(focusSettingsTarget("missing-settings-target")).toBe(false);
  });
});
