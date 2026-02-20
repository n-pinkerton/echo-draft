const path = require("path");

const { isTruthyFlag } = require("../utils/flags");

const BASE_WINDOWS_APP_ID = "com.herotools.openwispr";

function configureChannelUserDataPath({ app, channel, env = process.env } = {}) {
  if (!app) {
    throw new Error("configureChannelUserDataPath requires an Electron app instance");
  }

  if (channel === "production") {
    return;
  }

  const e2eRunId = (env.OPENWHISPR_E2E_RUN_ID || "").trim();
  const e2eSuffix = isTruthyFlag(env.OPENWHISPR_E2E)
    ? `-e2e${e2eRunId ? `-${e2eRunId}` : ""}`
    : "";

  const isolatedPath = path.join(app.getPath("appData"), `EchoDraft-${channel}${e2eSuffix}`);
  app.setPath("userData", isolatedPath);
}

function applyLinuxWindowFixes(app) {
  // Fix transparent window flickering on Linux: --enable-transparent-visuals requires
  // the compositor to set up an ARGB visual before any windows are created.
  // --disable-gpu-compositing prevents GPU compositing conflicts with the compositor.
  app.commandLine.appendSwitch("enable-transparent-visuals");
  app.commandLine.appendSwitch("disable-gpu-compositing");
}

function applyWaylandFlags(app, env = process.env) {
  // Enable native Wayland support: Ozone platform for native rendering,
  // and GlobalShortcutsPortal for global shortcuts via xdg-desktop-portal
  if (env.XDG_SESSION_TYPE !== "wayland") {
    return;
  }
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
  app.commandLine.appendSwitch(
    "enable-features",
    "UseOzonePlatform,WaylandWindowDecorations,GlobalShortcutsPortal"
  );
}

function applyWindowsAppUserModelId({ app, channel } = {}) {
  if (!app) {
    throw new Error("applyWindowsAppUserModelId requires an Electron app instance");
  }

  const windowsAppId =
    channel === "production" ? BASE_WINDOWS_APP_ID : `${BASE_WINDOWS_APP_ID}.${channel}`;
  app.setAppUserModelId(windowsAppId);
}

function applyPlatformPreReadySetup({ app, channel, env = process.env, platform = process.platform } = {}) {
  if (!app) {
    throw new Error("applyPlatformPreReadySetup requires an Electron app instance");
  }

  configureChannelUserDataPath({ app, channel, env });

  if (platform === "linux") {
    applyLinuxWindowFixes(app);
    applyWaylandFlags(app, env);
  }

  if (platform === "win32") {
    applyWindowsAppUserModelId({ app, channel });
  }
}

module.exports = {
  BASE_WINDOWS_APP_ID,
  applyLinuxWindowFixes,
  applyPlatformPreReadySetup,
  applyWaylandFlags,
  applyWindowsAppUserModelId,
  configureChannelUserDataPath,
};

