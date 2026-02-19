const { getLinuxSessionInfo } = require("./linuxSession");

function checkPasteTools(manager) {
  const platform = manager.deps.platform;

  if (platform === "darwin") {
    const fastPaste = manager.resolveFastPasteBinary();
    return {
      platform: "darwin",
      available: true,
      method: fastPaste ? "cgevent" : "applescript",
      requiresPermission: true,
      tools: [],
    };
  }

  if (platform === "win32") {
    return {
      platform: "win32",
      available: true,
      method: "powershell",
      requiresPermission: false,
      tools: [],
    };
  }

  const { isWayland, xwaylandAvailable, isGnome } = getLinuxSessionInfo(manager.deps.env || process.env);
  const tools = [];
  const canUseWtype = isWayland && !isGnome;
  const canUseYdotool = isWayland;
  const canUseXdotool = !isWayland || xwaylandAvailable;

  if (canUseWtype && manager.commandExists("wtype")) {
    tools.push("wtype");
  }
  if (canUseXdotool && manager.commandExists("xdotool")) {
    tools.push("xdotool");
  }
  if (canUseYdotool && manager.commandExists("ydotool")) {
    tools.push("ydotool");
  }

  const available = tools.length > 0;
  let recommendedInstall;
  if (!available) {
    if (!isWayland) {
      recommendedInstall = "xdotool";
    } else if (isGnome) {
      recommendedInstall = xwaylandAvailable ? "xdotool" : undefined;
    } else {
      recommendedInstall = xwaylandAvailable ? "xdotool" : "wtype or xdotool";
    }
  }

  return {
    platform: "linux",
    available,
    method: available ? tools[0] : null,
    requiresPermission: false,
    isWayland,
    xwaylandAvailable,
    tools,
    recommendedInstall,
  };
}

module.exports = {
  checkPasteTools,
};

