function resolveFastPasteBinary(manager) {
  if (manager.fastPasteChecked) {
    return manager.fastPastePath;
  }
  manager.fastPasteChecked = true;

  if (manager.deps.platform !== "darwin") {
    return null;
  }

  const { path, fs, resourcesPath, helpersDir } = manager.deps;

  const candidates = new Set([
    helpersDir ? path.join(helpersDir, "..", "..", "resources", "bin", "macos-fast-paste") : null,
    helpersDir ? path.join(helpersDir, "..", "..", "resources", "macos-fast-paste") : null,
  ]);

  if (typeof resourcesPath === "string" && resourcesPath) {
    [
      path.join(resourcesPath, "macos-fast-paste"),
      path.join(resourcesPath, "bin", "macos-fast-paste"),
      path.join(resourcesPath, "resources", "macos-fast-paste"),
      path.join(resourcesPath, "resources", "bin", "macos-fast-paste"),
      path.join(resourcesPath, "app.asar.unpacked", "resources", "macos-fast-paste"),
      path.join(resourcesPath, "app.asar.unpacked", "resources", "bin", "macos-fast-paste"),
    ].forEach((candidate) => candidates.add(candidate));
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const stats = fs.statSync(candidate);
      if (stats.isFile()) {
        fs.accessSync(candidate, fs.constants.X_OK);
        manager.fastPastePath = candidate;
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return null;
}

module.exports = {
  resolveFastPasteBinary,
};

