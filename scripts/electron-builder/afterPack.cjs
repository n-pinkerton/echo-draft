const fs = require("fs");
const path = require("path");
const ResEdit = require("resedit");
const { ICON_ASSET_PATHS, resolveProjectPath } = require("../../src/config/iconPaths.cjs");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = resolveProjectPath(context.packager.projectDir, ICON_ASSET_PATHS.windows);

  if (!fs.existsSync(exePath)) {
    console.warn(`[afterPack] Skipping icon patch; EXE not found at ${exePath}`);
    return;
  }

  if (!fs.existsSync(iconPath)) {
    console.warn(`[afterPack] Skipping icon patch; icon not found at ${iconPath}`);
    return;
  }

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const resources = ResEdit.NtExecutableResource.from(exe);
  const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);

  if (!Array.isArray(iconGroups) || iconGroups.length === 0) {
    console.warn(`[afterPack] Skipping icon patch; no icon groups found in ${exeName}`);
    return;
  }

  const replacementIcons = iconFile.icons.map((item) => item.data);

  for (const iconGroup of iconGroups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      resources.entries,
      iconGroup.id,
      iconGroup.lang,
      replacementIcons
    );
  }

  resources.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`[afterPack] Patched Windows EXE icon for ${exeName}`);
};
