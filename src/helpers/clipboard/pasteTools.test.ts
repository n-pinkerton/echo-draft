import { describe, expect, it, vi } from "vitest";

const { checkPasteTools } = require("./pasteTools");

describe("pasteTools", () => {
  it("reports linux recommended installs when no tools are found", () => {
    const manager = {
      deps: { platform: "linux", env: { XDG_SESSION_TYPE: "x11" } },
      resolveFastPasteBinary: vi.fn(),
      commandExists: vi.fn(() => false),
    };

    expect(checkPasteTools(manager)).toMatchObject({
      platform: "linux",
      available: false,
      recommendedInstall: "xdotool",
    });
  });

  it("reports macOS methods based on fast paste availability", () => {
    const manager = {
      deps: { platform: "darwin" },
      resolveFastPasteBinary: vi.fn(() => "/bin/macos-fast-paste"),
      commandExists: vi.fn(),
    };

    expect(checkPasteTools(manager)).toMatchObject({
      platform: "darwin",
      method: "cgevent",
      requiresPermission: true,
    });
  });
});

