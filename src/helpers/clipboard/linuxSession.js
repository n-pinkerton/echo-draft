const getLinuxDesktopEnv = (env = process.env) =>
  [env.XDG_CURRENT_DESKTOP, env.XDG_SESSION_DESKTOP, env.DESKTOP_SESSION]
    .filter(Boolean)
    .join(":")
    .toLowerCase();

const isGnomeDesktop = (desktopEnv = "") => desktopEnv.includes("gnome");

const getLinuxSessionInfo = (env = process.env) => {
  const isWayland =
    (env.XDG_SESSION_TYPE || "").toLowerCase() === "wayland" || Boolean(env.WAYLAND_DISPLAY);
  const xwaylandAvailable = isWayland && Boolean(env.DISPLAY);
  const desktopEnv = getLinuxDesktopEnv(env);
  const isGnome = isWayland && isGnomeDesktop(desktopEnv);

  return { isWayland, xwaylandAvailable, desktopEnv, isGnome };
};

module.exports = {
  getLinuxDesktopEnv,
  getLinuxSessionInfo,
  isGnomeDesktop,
};

