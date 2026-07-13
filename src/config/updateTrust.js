// Windows update installation must remain disabled until releases are code-signed
// and electron-builder is configured with the exact trusted certificate publisher(s).
// Keeping both values in source makes enabling the trust boundary an explicit,
// reviewable release-engineering change rather than an environment-variable bypass.
const WINDOWS_CODE_SIGNING_ENABLED = false;
const WINDOWS_UPDATE_PUBLISHERS = Object.freeze([]);

function areAutomaticUpdatesTrusted({
  platform = process.platform,
  windowsCodeSigningEnabled = WINDOWS_CODE_SIGNING_ENABLED,
  windowsPublishers = WINDOWS_UPDATE_PUBLISHERS,
} = {}) {
  if (platform === "darwin") return true;
  if (platform !== "win32") return false;
  return (
    windowsCodeSigningEnabled === true &&
    Array.isArray(windowsPublishers) &&
    windowsPublishers.length > 0 &&
    windowsPublishers.every(
      (publisher) =>
        typeof publisher === "string" &&
        publisher.trim().length > 0 &&
        publisher.length <= 256 &&
        !/[\r\n\0]/.test(publisher)
    )
  );
}

module.exports = {
  WINDOWS_CODE_SIGNING_ENABLED,
  WINDOWS_UPDATE_PUBLISHERS,
  areAutomaticUpdatesTrusted,
};
