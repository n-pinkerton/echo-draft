const path = require("path");

const ICON_ASSET_PATHS = Object.freeze({
  macos: "src/assets/icon.icns",
  macosTray: "src/assets/iconTemplate@3x.png",
  windows: "src/assets/icon.ico",
  linux: "src/assets/icon.png",
});

const PLATFORM_ICON_ASSET_PATHS = Object.freeze({
  darwin: ICON_ASSET_PATHS.macos,
  linux: ICON_ASSET_PATHS.linux,
  win32: ICON_ASSET_PATHS.windows,
});

function getPlatformIconAssetPath(platform) {
  return PLATFORM_ICON_ASSET_PATHS[platform] || ICON_ASSET_PATHS.linux;
}

function getTrayIconAssetPath(platform) {
  return platform === "darwin" ? ICON_ASSET_PATHS.macosTray : getPlatformIconAssetPath(platform);
}

function resolveProjectPath(projectDir, relativePath) {
  return path.join(projectDir, ...relativePath.split("/"));
}

module.exports = {
  ICON_ASSET_PATHS,
  getPlatformIconAssetPath,
  getTrayIconAssetPath,
  resolveProjectPath,
};
