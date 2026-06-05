const fs = require("fs");
const path = require("path");
const ResEdit = require("resedit");
const { ICON_ASSET_PATHS, resolveProjectPath } = require("../../src/config/iconPaths.cjs");

const VERSION_LANG = 1033;
const VERSION_CODEPAGE = 1200;

function parseVersionParts(version) {
  const numericParts = String(version || "")
    .split(/[.+-]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isInteger(part) && part >= 0);

  return [numericParts[0] || 0, numericParts[1] || 0, numericParts[2] || 0, numericParts[3] || 0];
}

function patchVersionInfo(resources, metadata) {
  const viList = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  const vi = viList[0];

  if (!vi) {
    console.warn("[afterPack] Skipping VERSIONINFO patch; no version resource found");
    return;
  }

  const [major, minor, patch, build] = parseVersionParts(metadata.version);
  vi.setFileVersion(major, minor, patch, build, VERSION_LANG);
  vi.setProductVersion(major, minor, patch, build, VERSION_LANG);
  vi.setStringValues(
    { lang: VERSION_LANG, codepage: VERSION_CODEPAGE },
    {
      CompanyName: metadata.companyName,
      FileDescription: metadata.productName,
      FileVersion: metadata.version,
      InternalName: metadata.exeName,
      LegalCopyright: metadata.copyright,
      OriginalFilename: metadata.exeName,
      ProductName: metadata.productName,
      ProductVersion: metadata.version,
    }
  );
  vi.outputToResourceEntries(resources.entries);
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = resolveProjectPath(context.packager.projectDir, ICON_ASSET_PATHS.windows);
  const appInfo = context.packager.appInfo;
  const companyName = appInfo.companyName || appInfo.author || "EchoDraft Team";
  const copyright =
    appInfo.copyright || `Copyright (c) ${new Date().getFullYear()} ${companyName}`;

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
  patchVersionInfo(resources, {
    companyName,
    copyright,
    exeName,
    productName: appInfo.productName || "EchoDraft",
    version: appInfo.version,
  });

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
  console.log(`[afterPack] Patched Windows EXE metadata and icon for ${exeName}`);
};
