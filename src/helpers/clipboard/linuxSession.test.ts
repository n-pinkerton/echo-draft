import { describe, expect, it } from "vitest";

const { getLinuxSessionInfo } = require("./linuxSession");

describe("linuxSession", () => {
  it("detects Wayland via XDG_SESSION_TYPE/WAYLAND_DISPLAY and XWayland via DISPLAY", () => {
    expect(
      getLinuxSessionInfo({
        XDG_SESSION_TYPE: "wayland",
        WAYLAND_DISPLAY: "wayland-0",
        DISPLAY: ":1",
        XDG_CURRENT_DESKTOP: "sway",
      })
    ).toEqual({
      isWayland: true,
      xwaylandAvailable: true,
      desktopEnv: "sway",
      isGnome: false,
    });
  });

  it("detects GNOME Wayland sessions", () => {
    expect(
      getLinuxSessionInfo({
        XDG_SESSION_TYPE: "wayland",
        DISPLAY: "",
        XDG_CURRENT_DESKTOP: "GNOME",
      })
    ).toEqual({
      isWayland: true,
      xwaylandAvailable: false,
      desktopEnv: "gnome",
      isGnome: true,
    });
  });
});

